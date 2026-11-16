import { deepEqual, equal, ok, rejects } from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { runner } from "node-pg-migrate";
import { Client, type PoolClient } from "pg";
import { readDatabaseConfig } from "../../../config/database.js";
import { createDatabasePool } from "../../../infrastructure/database/pool.js";
import { JsonBusinessProfileReader } from "../../business-profile/infrastructure/json-business-profile-reader.js";
import { recoverExpiredJobs } from "../../jobs/application/recover-expired-jobs.js";
import { PostgresJobQueue } from "../../jobs/infrastructure/postgres-job-queue.js";
import type { ResponsePlanPreparation } from "../application/message-response-plan-store.js";
import { prepareMessageResponsePlan } from "../application/prepare-message-response-plan.js";
import { PostgresMessageProcessingContextReader } from "./postgres-message-processing-context-reader.js";
import { PostgresMessageResponsePlanStore } from "./postgres-message-response-plan-store.js";

test("preparação de planos em PostgreSQL descartável", { timeout: 60000 }, async (t) => {
  const config = readDatabaseConfig(process.env);
  if (!["127.0.0.1", "localhost", "::1"].includes(config.host)) {
    throw new Error("O teste de integração exige um PostgreSQL local.");
  }
  const temporaryDatabase = `copilot_plan_store_test_${randomUUID().replaceAll("-", "")}`;
  const admin = new Client({ ...config, connectionTimeoutMillis: 5000 });
  const testConfig = { ...config, database: temporaryDatabase };
  const pool = createDatabasePool(testConfig);
  const store = new PostgresMessageResponsePlanStore(pool);
  const queue = new PostgresJobQueue(pool);
  let databaseCreated = false;
  let phoneSequence = 0;

  async function fixture(conversationId?: string): Promise<ResponsePlanPreparation> {
    if (conversationId === undefined) {
      const contacts = await pool.query<{ id: string }>(
        "INSERT INTO public.contacts (phone) VALUES ($1) RETURNING id;",
        [`+1555${String(++phoneSequence).padStart(7, "0")}`]);
      ok(contacts.rows[0]);
      const conversations = await pool.query<{ id: string }>(
        "INSERT INTO public.conversations (contact_id) VALUES ($1) RETURNING id;", [contacts.rows[0].id]);
      ok(conversations.rows[0]);
      conversationId = conversations.rows[0].id;
    }
    const messages = await pool.query<{ id: string; created_at: Date }>(`
      INSERT INTO public.messages (conversation_id, provider, external_id, direction, sender_type, kind, body)
      VALUES ($1, 'simulador', $2, 'entrada', 'contato', 'texto', 'Texto sintético') RETURNING id, created_at;
    `, [conversationId, randomUUID()]);
    const message = messages.rows[0];
    ok(message);
    const jobs = await pool.query<{ id: string }>(`
      INSERT INTO public.jobs (type, message_id, status, attempts, locked_at)
      VALUES ('processar_mensagem', $1, 'processando', 1, CURRENT_TIMESTAMP) RETURNING id;
    `, [message.id]);
    ok(jobs.rows[0]);
    return {
      attempt: { id: jobs.rows[0].id, attempts: 1 },
      draft: {
        messageId: message.id, conversationId, expectedStatus: "aguardando_menu",
        decision: { action: "enviar_abertura", nextStatus: "aguardando_menu" },
        referenceAt: message.created_at,
        blocks: [{ position: 1, text: "  Olá sintético\n" }, { position: 2, text: "Menu sintético" }],
      },
    };
  }
  async function sourceSnapshot() {
    const result = await pool.query(`
      SELECT (SELECT jsonb_agg(t ORDER BY id) FROM public.contacts t) AS contacts,
             (SELECT jsonb_agg(t ORDER BY id) FROM public.conversations t) AS conversations,
             (SELECT jsonb_agg(t ORDER BY id) FROM public.messages t) AS messages,
             (SELECT jsonb_agg(t ORDER BY id) FROM public.jobs t) AS jobs;
    `);
    return result.rows;
  }
  async function planSnapshot() {
    return (await pool.query(`
      SELECT (SELECT jsonb_agg(t ORDER BY id) FROM public.response_plans t) AS plans,
             (SELECT jsonb_agg(t ORDER BY plan_id, position) FROM public.response_blocks t) AS blocks;
    `)).rows;
  }
  async function noPlans() {
    const result = await pool.query<{ plans: string; blocks: string }>(`
      SELECT (SELECT count(*) FROM public.response_plans) AS plans,
             (SELECT count(*) FROM public.response_blocks) AS blocks;
    `);
    deepEqual(result.rows, [{ plans: "0", blocks: "0" }]);
  }
  async function prepare(command: ResponsePlanPreparation) {
    const result = await store.prepare(command);
    ok(result.status === "preparado");
    return result.planId;
  }
  async function finishPlan(planId: string, status: "enviado" | "cancelado") {
    // Fixture da operação futura, exclusiva deste banco. Não testa seu executor.
    const client = await pool.connect();
    try {
      await client.query("BEGIN;");
      const blocks = await client.query<{ conversation_id: string; position: number; text: string }>(
        "SELECT conversation_id, position, text FROM public.response_blocks WHERE plan_id = $1 ORDER BY position;", [planId]);
      for (const block of blocks.rows) {
        if (status === "cancelado") {
          await client.query("UPDATE public.response_blocks SET status = 'cancelado' WHERE plan_id = $1 AND position = $2;",
            [planId, block.position]);
        } else {
          const sent = await client.query<{ id: string }>(`
            INSERT INTO public.messages (conversation_id, provider, external_id, direction, sender_type, kind, body)
            VALUES ($1, 'simulador', $2, 'saida', 'bot', 'texto', $3) RETURNING id;
          `, [block.conversation_id, randomUUID(), block.text]);
          ok(sent.rows[0]);
          await client.query(`UPDATE public.response_blocks SET status = 'enviado', sent_message_id = $3, sent_at = now()
            WHERE plan_id = $1 AND position = $2;`, [planId, block.position, sent.rows[0].id]);
        }
      }
      await client.query("UPDATE public.response_plans SET status = $2, finished_at = now() WHERE id = $1;", [planId, status]);
      await client.query("COMMIT;");
    } catch (error) {
      await client.query("ROLLBACK;");
      throw error;
    } finally { client.release(); }
  }
  async function openingSent(conversationId: string) {
    const opening = await fixture(conversationId);
    const id = await prepare(opening);
    await finishPlan(id, "enviado");
    return id;
  }
  function menu(command: ResponsePlanPreparation) {
    command.draft.decision = { action: "informar_servicos", nextStatus: "aguardando_detalhes" };
    return command;
  }
  async function lockConversation(command: ResponsePlanPreparation) {
    const client = await pool.connect();
    try {
      await client.query("BEGIN;");
      await client.query("SELECT id FROM public.conversations WHERE id = $1 FOR UPDATE;", [command.draft.conversationId]);
      return client;
    } catch (error) { client.release(true); throw error; }
  }
  async function waitForBlocked(client: PoolClient, count = 1) {
    const pid = (await client.query<{ pid: number }>("SELECT pg_backend_pid() AS pid;")).rows[0]?.pid;
    ok(pid);
    // Barreira observável do PostgreSQL: a operação realmente chegou ao lock.
    // Não usar sleep nem assumir que uma Promise já começou a executar SQL.
    for (let observation = 0; observation < 2000; observation++) {
      const result = await pool.query<{ count: string }>(`
        WITH RECURSIVE waiting AS (
          SELECT pid, pg_blocking_pids(pid) AS blockers FROM pg_stat_activity WHERE datname = current_database()
        ), blocked(pid) AS (
          SELECT pid FROM waiting WHERE $1::integer = ANY(blockers)
          UNION
          SELECT waiting.pid FROM waiting INNER JOIN blocked ON blocked.pid = ANY(waiting.blockers)
        ) SELECT count(*) FROM blocked;
      `, [pid]);
      if (Number(result.rows[0]?.count) >= count) return;
    }
    throw new Error("As operações não atingiram a barreira de bloqueio do teste.");
  }
  t.beforeEach(async () => {
    await pool.query("TRUNCATE public.leads, public.response_blocks, public.response_plans, public.jobs, public.messages, public.conversations, public.contacts;");
  });

  try {
    await admin.connect();
    await admin.query(`CREATE DATABASE "${temporaryDatabase}" TEMPLATE template0;`);
    databaseCreated = true;
    const migrationClient = new Client({ ...testConfig, connectionTimeoutMillis: 5000 });
    try {
      await migrationClient.connect();
      await runner({
        dbClient: migrationClient, dir: fileURLToPath(new URL("../../../../migrations/", import.meta.url)),
        direction: "up", schema: "public", migrationsTable: "pgmigrations", checkOrder: true, singleTransaction: true,
        logger: { info: () => {}, warn: () => {}, error: () => {} },
      });
    } finally { await migrationClient.end(); }

    await t.test("grava snapshot e todos os blocos sem alterar origens, conversa ou job", async () => {
      const command = await fixture();
      const before = await sourceSnapshot();
      const id = await prepare({
        attempt: { ...command.attempt, id: command.attempt.id.toUpperCase() },
        draft: { ...command.draft, messageId: command.draft.messageId.toUpperCase(),
          conversationId: command.draft.conversationId.toUpperCase() },
      });
      const plans = await pool.query("SELECT * FROM public.response_plans WHERE id = $1;", [id]);
      const plan = plans.rows[0];
      ok(plan);
      deepEqual({ ...plan, id: undefined, created_at: undefined }, {
        id: undefined, conversation_id: command.draft.conversationId, source_message_id: command.draft.messageId,
        source_job_id: command.attempt.id, action: "enviar_abertura", expected_status: "aguardando_menu",
        next_status: "aguardando_menu", reference_at: command.draft.referenceAt,
        status: "pendente", created_at: undefined, finished_at: null,
      });
      const blocks = await pool.query("SELECT position, text, status, sent_message_id, sent_at FROM public.response_blocks WHERE plan_id = $1 ORDER BY position;", [id]);
      deepEqual(blocks.rows, command.draft.blocks.map((block) => ({ ...block, status: "pendente", sent_message_id: null, sent_at: null })));
      deepEqual(await sourceSnapshot(), before);
    });

    await t.test("caso de uso e compositor usam o adapter e preservam o perfil original na retomada", async () => {
      const command = await fixture();
      const context = await new PostgresMessageProcessingContextReader(pool).findByMessageId(command.draft.messageId);
      ok(context);
      const job = {
        id: command.attempt.id, attempts: 1, maxAttempts: 3, type: "processar_mensagem" as const,
        messageId: command.draft.messageId, status: "processando" as const, lockedAt: new Date(),
      };
      const profile = await new JsonBusinessProfileReader().read();
      const result = await prepareMessageResponsePlan({ job, context, profile, decision: command.draft.decision }, store);
      ok(result.status === "preparado");
      const before = await planSnapshot();
      profile.name = "Outro nome sintético";
      profile.messages.greeting = "Outro texto sintético";
      deepEqual(await prepareMessageResponsePlan({ job, context, profile, decision: command.draft.decision }, store),
        { status: "existente", planId: result.planId });
      deepEqual(await planSnapshot(), before);
    });

    await t.test("retomada devolve o original antes de exigir o estado para um plano novo", async () => {
      for (const status of ["aguardando_detalhes", "qualificando", "aguardando_humano", "em_atendimento_humano", "encerrada"]) {
        const command = await fixture();
        const id = await prepare(command);
        await finishPlan(id, "enviado");
        await pool.query(`UPDATE public.conversations SET status = $2,
          closed_at = CASE WHEN $2 = 'encerrada' THEN now() ELSE NULL END WHERE id = $1;`, [command.draft.conversationId, status]);
        const before = await planSnapshot();
        command.draft.blocks = [{ position: 1, text: "Não substituir" }];
        command.draft.referenceAt = new Date("2020-01-01T00:00:00Z");
        menu(command);
        deepEqual(await store.prepare(command), { status: "existente", planId: id });
        deepEqual(await planSnapshot(), before);
      }
    });

    await t.test("plano cancelado também mantém sua identidade e conteúdo na retomada", async () => {
      const command = await fixture();
      const id = await prepare(command);
      await finishPlan(id, "cancelado");
      const before = await planSnapshot();
      deepEqual(await store.prepare(command), { status: "existente", planId: id });
      deepEqual(await planSnapshot(), before);
    });

    await t.test("valida comando inteiro antes de adquirir conexão e não expõe entradas no erro", async () => {
      const command = await fixture();
      const invalid: unknown[] = [null, { ...command, extra: "segredo_sintetico" },
        ...[0, -1, NaN, Infinity, 1.5, Number.MAX_SAFE_INTEGER + 1].map((attempts) => ({ ...command, attempt: { ...command.attempt, attempts } })),
        { ...command, attempt: { id: "segredo_sintetico", attempts: 1 } },
        ...[
          { messageId: "inválido" }, { conversationId: "inválido" }, { referenceAt: new Date(NaN) },
          { expectedStatus: "qualificando" }, { decision: { action: "solicitar_recepcao", nextStatus: "aguardando_humano" } },
          { blocks: [] }, { blocks: [{ position: 1, text: " \n\t" }] },
          { blocks: [{ position: 2, text: "Lacuna" }] }, { blocks: [{ position: 1, text: "A" }, { position: 1, text: "B" }] },
        ].map((patch) => ({ ...command, draft: { ...command.draft, ...patch } })),
      ];
      const before = await sourceSnapshot();
      const connect = t.mock.method(pool, "connect");
      try {
        for (const input of invalid) {
          await rejects(store.prepare(input as ResponsePlanPreparation), {
            name: "TypeError", message: "Os dados de preparação do plano de resposta são inválidos.",
          });
        }
        equal(connect.mock.callCount(), 0);
      } finally { connect.mock.restore(); }
      await noPlans();
      deepEqual(await sourceSnapshot(), before);
    });

    await t.test("ID ausente, contador antigo e job fora de processamento não preparam", async () => {
      const command = await fixture();
      const before = await sourceSnapshot();
      for (const attempt of [{ id: randomUUID(), attempts: 1 }, { ...command.attempt, attempts: 2 }]) {
        deepEqual(await store.prepare({ ...command, attempt }), { status: "reserva_desatualizada" });
      }
      deepEqual(await sourceSnapshot(), before);
      for (const status of ["pendente", "concluido", "falhou"]) {
        await pool.query("UPDATE public.jobs SET status = $2, locked_at = NULL WHERE id = $1;", [command.attempt.id, status]);
        const snapshot = await sourceSnapshot();
        deepEqual(await store.prepare(command), { status: "reserva_desatualizada" });
        deepEqual(await sourceSnapshot(), snapshot);
      }
      await noPlans();
    });

    await t.test("vínculos e tipo do job são conferidos inclusive antes de devolver existente", async () => {
      const first = await fixture();
      const second = await fixture();
      await prepare(first);
      const before = await planSnapshot();
      const commands = [
        { ...first, attempt: second.attempt },
        { ...first, draft: { ...first.draft, conversationId: second.draft.conversationId } },
        { ...first, draft: { ...first.draft, conversationId: randomUUID() } },
        { ...first, draft: { ...first.draft, messageId: randomUUID() } },
      ];
      for (const command of commands) deepEqual(await store.prepare(command), { status: "contexto_desatualizado" });
      await pool.query("UPDATE public.jobs SET type = 'outro_tipo_sintetico' WHERE id = $1;", [first.attempt.id]);
      deepEqual(await store.prepare(first), { status: "contexto_desatualizado" });
      deepEqual(await planSnapshot(), before);
    });

    await t.test("recusa novas preparações nos demais estados da conversa", async () => {
      for (const status of ["aguardando_detalhes", "qualificando", "aguardando_humano", "em_atendimento_humano", "encerrada"]) {
        const command = await fixture();
        await pool.query(`UPDATE public.conversations SET status = $2,
          closed_at = CASE WHEN $2 = 'encerrada' THEN now() ELSE NULL END WHERE id = $1;`, [command.draft.conversationId, status]);
        const before = await sourceSnapshot();
        deepEqual(await store.prepare(command), { status: "contexto_desatualizado" });
        deepEqual(await sourceSnapshot(), before);
      }
      await noPlans();
    });

    await t.test("confere elegibilidade persistida e referência temporal para planos novos", async () => {
      for (const [column, value] of [
        ["direction", "saida"], ["sender_type", "bot"], ["sender_type", "atendente"],
        ["kind", "audio"], ["kind", "outro"], ["body", null], ["body", " \n\t"],
      ] as const) {
        const command = await fixture();
        await pool.query(`UPDATE public.messages SET ${column} = $2 WHERE id = $1;`, [command.draft.messageId, value]);
        const before = await sourceSnapshot();
        deepEqual(await store.prepare(command), { status: "contexto_desatualizado" });
        deepEqual(await sourceSnapshot(), before);
      }
      const command = await fixture();
      command.draft.referenceAt = new Date("2020-01-01T00:00:00Z");
      deepEqual(await store.prepare(command), { status: "contexto_desatualizado" });
      await noPlans();
    });

    await t.test("menu exige abertura enviada; abertura pendente adia e cancelada não é recriada", async () => {
      const opening = await fixture();
      const next = menu(await fixture(opening.draft.conversationId));
      deepEqual(await store.prepare(next), { status: "contexto_desatualizado" });
      const openingId = await prepare(opening);
      const pending = await planSnapshot();
      deepEqual(await store.prepare(next), { status: "adiado", reason: "abertura_pendente" });
      deepEqual(await store.prepare({ ...next, draft: { ...next.draft, decision: opening.draft.decision } }),
        { status: "adiado", reason: "abertura_pendente" });
      deepEqual(await planSnapshot(), pending);
      await finishPlan(openingId, "cancelado");
      deepEqual(await store.prepare(next), { status: "contexto_desatualizado" });
      deepEqual(await store.prepare({ ...next, draft: { ...next.draft, decision: opening.draft.decision } }),
        { status: "contexto_desatualizado" });
    });

    await t.test("abertura parcial ainda adia outra mensagem sem avançar a conversa", async () => {
      const opening = await fixture();
      const openingId = await prepare(opening);
      const sent = await pool.query<{ id: string }>(`
        INSERT INTO public.messages (conversation_id, provider, external_id, direction, sender_type, kind, body)
        VALUES ($1, 'simulador', $2, 'saida', 'bot', 'texto', 'Primeiro bloco sintético') RETURNING id;
      `, [opening.draft.conversationId, randomUUID()]);
      ok(sent.rows[0]);
      await pool.query(`UPDATE public.response_blocks SET status = 'enviado', sent_message_id = $2, sent_at = now()
        WHERE plan_id = $1 AND position = 1;`, [openingId, sent.rows[0].id]);
      const next = menu(await fixture(opening.draft.conversationId));
      const before = await planSnapshot();
      deepEqual(await store.prepare(next), { status: "adiado", reason: "abertura_pendente" });
      deepEqual(await planSnapshot(), before);
      equal((await pool.query("SELECT status FROM public.conversations WHERE id = $1;", [opening.draft.conversationId])).rows[0]?.status,
        "aguardando_menu");
    });

    await t.test("abertura enviada permite três ações de menu e impede segunda abertura", async () => {
      for (const decision of [
        { action: "reapresentar_menu", nextStatus: "aguardando_menu" },
        { action: "informar_servicos", nextStatus: "aguardando_detalhes" },
        { action: "informar_valores_horarios", nextStatus: "aguardando_detalhes" },
      ] as const) {
        const command = await fixture();
        await openingSent(command.draft.conversationId);
        deepEqual(await store.prepare(command), { status: "contexto_desatualizado" });
        command.draft.decision = decision;
        await prepare(command);
      }
    });

    await t.test("resposta anterior pendente adia; término permite preparar a próxima", async () => {
      const first = menu(await fixture());
      await openingSent(first.draft.conversationId);
      const firstId = await prepare(first);
      const next = menu(await fixture(first.draft.conversationId));
      const before = await planSnapshot();
      deepEqual(await store.prepare(next), { status: "adiado", reason: "resposta_anterior_pendente" });
      deepEqual(await planSnapshot(), before);
      await finishPlan(firstId, "enviado");
      const nextId = await prepare(next);
      const third = menu(await fixture(first.draft.conversationId));
      await finishPlan(nextId, "cancelado");
      await prepare(third);
    });

    await t.test("prazo expirado sozinho permite preparar, mas recuperação revoga a tentativa", async () => {
      const command = await fixture();
      await pool.query("UPDATE public.jobs SET locked_at = CURRENT_TIMESTAMP - INTERVAL '121 seconds' WHERE id = $1;", [command.attempt.id]);
      const id = await prepare(command);
      deepEqual(await recoverExpiredJobs(queue), { requeued: 1, failed: 0 });
      const before = await planSnapshot();
      deepEqual(await store.prepare(command), { status: "reserva_desatualizada" });
      const current = await queue.claimNext("processar_mensagem");
      ok(current);
      equal(current.attempts, 2);
      deepEqual(await store.prepare({ ...command, attempt: current }),
        { status: "existente", planId: id });
      deepEqual(await store.prepare(command), { status: "reserva_desatualizada" });
      deepEqual(await planSnapshot(), before);
    });

    await t.test("recuperação anterior à primeira preparação impede gravação da tentativa antiga", async () => {
      const command = await fixture();
      await pool.query("UPDATE public.jobs SET locked_at = CURRENT_TIMESTAMP - INTERVAL '121 seconds' WHERE id = $1;", [command.attempt.id]);
      await recoverExpiredJobs(queue);
      deepEqual(await store.prepare(command), { status: "reserva_desatualizada" });
      await noPlans();
      const current = await queue.claimNext("processar_mensagem");
      ok(current);
      await prepare({ ...command, attempt: { id: current.id, attempts: current.attempts } });
    });

    await t.test("falha no segundo bloco desfaz o plano e o primeiro bloco; repetição funciona", async () => {
      const command = await fixture();
      const before = await sourceSnapshot();
      await pool.query(`CREATE FUNCTION public.reject_test_block() RETURNS trigger LANGUAGE plpgsql AS $$
        BEGIN IF NEW.position = 2 THEN RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'falha_sintetica'; END IF;
        RETURN NEW; END; $$;
        CREATE TRIGGER reject_test_block AFTER INSERT ON public.response_blocks
        FOR EACH ROW EXECUTE FUNCTION public.reject_test_block();`);
      try {
        await rejects(store.prepare(command), { code: "P0001" });
        await noPlans();
        deepEqual(await sourceSnapshot(), before);
      } finally {
        await pool.query("DROP TRIGGER reject_test_block ON public.response_blocks; DROP FUNCTION public.reject_test_block();");
      }
      await prepare(command);
    });

    await t.test("duas chamadas da mesma origem convergem para o mesmo plano", async () => {
      const command = await fixture();
      const results = await Promise.all([store.prepare(command), store.prepare(command)]);
      equal(results.filter((result) => result.status === "preparado").length, 1);
      equal(results.filter((result) => result.status === "existente").length, 1);
      ok(results[0] && "planId" in results[0]);
      ok(results[1] && "planId" in results[1]);
      equal(results[0].planId, results[1].planId);
      equal((await pool.query("SELECT * FROM public.response_plans;")).rowCount, 1);
      equal((await pool.query("SELECT * FROM public.response_blocks;")).rowCount, 2);
    });

    await t.test("aberturas de duas mensagens concorrentes elegem uma e adiam a outra", async () => {
      const first = await fixture();
      const second = await fixture(first.draft.conversationId);
      const blocker = await lockConversation(first);
      const operations = [store.prepare(first), store.prepare(second)];
      const results = Promise.all(operations);
      void results.catch(() => {}); // Também observar rejeições durante a espera pela barreira.
      try {
        await waitForBlocked(blocker, 2);
        await blocker.query("COMMIT;");
        const values = await results;
        equal(values.filter((value) => value.status === "preparado").length, 1);
        deepEqual(values.find((value) => value.status !== "preparado"), { status: "adiado", reason: "abertura_pendente" });
        equal((await pool.query("SELECT * FROM public.response_plans;")).rowCount, 1);
      } finally {
        await blocker.query("ROLLBACK;");
        blocker.release();
        await Promise.allSettled(operations);
      }
    });

    await t.test("menus concorrentes na mesma conversa adiam um; outra conversa é independente", async () => {
      const first = menu(await fixture());
      await openingSent(first.draft.conversationId);
      const second = menu(await fixture(first.draft.conversationId));
      const other = await fixture();
      const blocker = await lockConversation(first);
      const operations = [store.prepare(first), store.prepare(second)];
      const results = Promise.all(operations);
      void results.catch(() => {});
      try {
        await waitForBlocked(blocker, 2);
        await prepare(other);
        await blocker.query("COMMIT;");
        const values = await results;
        equal(values.filter((value) => value.status === "preparado").length, 1);
        deepEqual(values.find((value) => value.status !== "preparado"), { status: "adiado", reason: "resposta_anterior_pendente" });
      } finally {
        await blocker.query("ROLLBACK;");
        blocker.release();
        await Promise.allSettled(operations);
      }
    });

    await t.test("releitura após bloqueio respeita mudança concorrente de estado e protege o job", async () => {
      const command = await fixture();
      await pool.query("UPDATE public.jobs SET locked_at = CURRENT_TIMESTAMP - INTERVAL '121 seconds' WHERE id = $1;", [command.attempt.id]);
      const blocker = await lockConversation(command);
      const operation = store.prepare(command);
      try {
        await waitForBlocked(blocker);
        // O store mantém o job bloqueado enquanto espera pela conversa.
        deepEqual(await recoverExpiredJobs(queue), { requeued: 0, failed: 0 });
        await blocker.query("UPDATE public.conversations SET status = 'aguardando_humano' WHERE id = $1;", [command.draft.conversationId]);
        await blocker.query("COMMIT;");
        deepEqual(await operation, { status: "contexto_desatualizado" });
        await noPlans();
      } finally {
        await blocker.query("ROLLBACK;");
        blocker.release();
        await Promise.allSettled([operation]);
      }
    });

    await t.test("finalização concorrente anterior ao bloqueio do job revoga a preparação", async () => {
      const command = await fixture();
      const blocker = await pool.connect();
      let operation: ReturnType<typeof store.prepare> | undefined;
      try {
        await blocker.query("BEGIN;");
        await blocker.query("UPDATE public.jobs SET status = 'concluido', locked_at = NULL WHERE id = $1;", [command.attempt.id]);
        operation = store.prepare(command);
        await waitForBlocked(blocker);
        await blocker.query("COMMIT;");
        deepEqual(await operation, { status: "reserva_desatualizada" });
        await noPlans();
      } finally {
        await blocker.query("ROLLBACK;");
        blocker.release();
        if (operation !== undefined) await Promise.allSettled([operation]);
      }
    });

    await t.test("releitura da mensagem recusa elegibilidade e vínculo alterados enquanto esperava", async () => {
      for (const change of ["texto_vazio", "outra_conversa"]) {
        const command = await fixture();
        const other = await fixture();
        const blocker = await lockConversation(command);
        const operation = store.prepare(command);
        try {
          await waitForBlocked(blocker);
          if (change === "texto_vazio") {
            await blocker.query("UPDATE public.messages SET body = ' ' WHERE id = $1;", [command.draft.messageId]);
          } else {
            await blocker.query("UPDATE public.messages SET conversation_id = $2 WHERE id = $1;",
              [command.draft.messageId, other.draft.conversationId]);
          }
          await blocker.query("COMMIT;");
          deepEqual(await operation, { status: "contexto_desatualizado" });
          await noPlans();
        } finally {
          await blocker.query("ROLLBACK;");
          blocker.release();
          await Promise.allSettled([operation]);
        }
      }
    });

    await t.test("snapshot não muda quando o chamador altera o comando durante a espera", async () => {
      const command = await fixture();
      const original = structuredClone(command);
      const blocker = await lockConversation(command);
      const operation = store.prepare(command);
      try {
        await waitForBlocked(blocker);
        command.draft.referenceAt.setTime(0);
        command.draft.blocks[0]!.text = "Não gravar";
        command.draft.decision = { action: "informar_servicos", nextStatus: "aguardando_detalhes" };
        await blocker.query("COMMIT;");
        const result = await operation;
        ok(result.status === "preparado");
        const plans = await pool.query("SELECT reference_at, action FROM public.response_plans WHERE id = $1;", [result.planId]);
        deepEqual(plans.rows, [{ reference_at: original.draft.referenceAt, action: original.draft.decision.action }]);
        const blocks = await pool.query("SELECT position, text FROM public.response_blocks WHERE plan_id = $1 ORDER BY position;", [result.planId]);
        deepEqual(blocks.rows, original.draft.blocks);
      } finally {
        await blocker.query("ROLLBACK;");
        blocker.release();
        await Promise.allSettled([operation]);
      }
    });
  } finally {
    try {
      await pool.end();
      if (databaseCreated) await admin.query(`DROP DATABASE "${temporaryDatabase}" WITH (FORCE);`);
    } finally { await admin.end(); }
  }
});
