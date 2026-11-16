import { deepEqual, equal, ok, rejects } from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { runner } from "node-pg-migrate";
import { Client, type PoolClient } from "pg";
import { readDatabaseConfig } from "../../../config/database.js";
import { createDatabasePool } from "../../../infrastructure/database/pool.js";
import { loadMessageResponsePlan } from "../application/load-message-response-plan.js";
import type { ResponsePlanPreparation } from "../application/message-response-plan-store.js";
import type { MessageResponsePlanDraft } from "../contracts/message-response-plan.js";
import { PostgresMessageResponsePlanReader } from "./postgres-message-response-plan-reader.js";
import { PostgresMessageResponsePlanStore } from "./postgres-message-response-plan-store.js";

test("leitura de planos em PostgreSQL descartável", { timeout: 60000 }, async (t) => {
  const config = readDatabaseConfig(process.env);
  if (!["127.0.0.1", "localhost", "::1"].includes(config.host)) {
    throw new Error("O teste de integração exige um PostgreSQL local.");
  }
  const temporaryDatabase = `copilot_plan_read_test_${randomUUID().replaceAll("-", "")}`;
  const admin = new Client({ ...config, connectionTimeoutMillis: 5000 });
  const testConfig = { ...config, database: temporaryDatabase };
  const pool = createDatabasePool(testConfig);
  const reader = new PostgresMessageResponsePlanReader(pool);
  const store = new PostgresMessageResponsePlanStore(pool);
  let databaseCreated = false;
  let phoneSequence = 0;

  async function message(conversationId: string): Promise<ResponsePlanPreparation> {
    const messages = await pool.query<{ id: string; created_at: Date }>(`
      INSERT INTO public.messages (conversation_id, provider, external_id, direction, sender_type, kind, body, created_at)
      VALUES ($1, 'simulador', $2, 'entrada', 'contato', 'texto', 'Solicitação sintética', $3) RETURNING id, created_at;
    `, [conversationId, randomUUID(), new Date("2026-11-16T12:34:56.789Z")]);
    const origin = messages.rows[0];
    ok(origin);
    const jobs = await pool.query<{ id: string }>(`
      INSERT INTO public.jobs (type, message_id, status, attempts, locked_at)
      VALUES ('processar_mensagem', $1, 'processando', 1, CURRENT_TIMESTAMP) RETURNING id;
    `, [origin.id]);
    ok(jobs.rows[0]);
    return {
      attempt: { id: jobs.rows[0].id, attempts: 1 },
      draft: {
        messageId: origin.id, conversationId, expectedStatus: "aguardando_menu",
        decision: { action: "enviar_abertura", nextStatus: "aguardando_menu" }, referenceAt: origin.created_at,
        blocks: [{ position: 1, text: "  Saudação original\n" },
          { position: 2, text: "Aviso sintético" }, { position: 3, text: "Menu original" }],
      },
    };
  }
  async function prepare(command: ResponsePlanPreparation) {
    const result = await store.prepare(command);
    ok(result.status === "preparado");
    return { command, planId: result.planId };
  }
  async function fixture() {
    const contacts = await pool.query<{ id: string }>("INSERT INTO public.contacts (phone) VALUES ($1) RETURNING id;",
      [`+1555${String(++phoneSequence).padStart(7, "0")}`]);
    ok(contacts.rows[0]);
    const conversations = await pool.query<{ id: string }>(
      "INSERT INTO public.conversations (contact_id) VALUES ($1) RETURNING id;", [contacts.rows[0].id]);
    ok(conversations.rows[0]);
    return prepare(await message(conversations.rows[0].id));
  }
  async function databaseSnapshot() {
    return (await pool.query(`
      SELECT (SELECT jsonb_agg(t ORDER BY id) FROM public.contacts t) AS contacts,
        (SELECT jsonb_agg(t ORDER BY id) FROM public.conversations t) AS conversations,
        (SELECT jsonb_agg(t ORDER BY id) FROM public.messages t) AS messages,
        (SELECT jsonb_agg(t ORDER BY id) FROM public.jobs t) AS jobs,
        (SELECT jsonb_agg(t ORDER BY id) FROM public.response_plans t) AS plans,
        (SELECT jsonb_agg(t ORDER BY plan_id, position) FROM public.response_blocks t) AS blocks,
        (SELECT jsonb_agg(t ORDER BY id) FROM public.pgmigrations t) AS migrations;
    `)).rows;
  }
  async function confirmBlock(client: PoolClient, planId: string, position: number) {
    // Fixture da futura confirmação: não é uma operação de produção desta etapa.
    const blocks = await client.query<{ conversation_id: string; text: string }>(
      "SELECT conversation_id, text FROM public.response_blocks WHERE plan_id = $1 AND position = $2;", [planId, position]);
    const block = blocks.rows[0];
    ok(block);
    const messages = await client.query<{ id: string }>(`
      INSERT INTO public.messages (conversation_id, provider, external_id, direction, sender_type, kind, body)
      VALUES ($1, 'simulador', $2, 'saida', 'bot', 'texto', $3) RETURNING id;
    `, [block.conversation_id, randomUUID(), block.text]);
    ok(messages.rows[0]);
    const result = await client.query<{ sent_message_id: string; sent_at: Date }>(`
      UPDATE public.response_blocks SET status = 'enviado', sent_message_id = $3, sent_at = CURRENT_TIMESTAMP
      WHERE plan_id = $1 AND position = $2 RETURNING sent_message_id, sent_at;
    `, [planId, position, messages.rows[0].id]);
    ok(result.rows[0]);
    return result.rows[0];
  }
  async function progress(planId: string, positions: number[], terminal?: "enviado" | "cancelado") {
    const client = await pool.connect();
    try {
      await client.query("BEGIN;");
      for (const position of positions) await confirmBlock(client, planId, position);
      if (terminal === "cancelado") {
        await client.query("UPDATE public.response_blocks SET status = 'cancelado' WHERE plan_id = $1 AND status = 'pendente';", [planId]);
      }
      if (terminal !== undefined) {
        await client.query("UPDATE public.response_plans SET status = $2, finished_at = CURRENT_TIMESTAMP WHERE id = $1;", [planId, terminal]);
      }
      await client.query("COMMIT;");
    } catch (error) {
      await client.query("ROLLBACK;");
      throw error;
    } finally { client.release(); }
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

    await t.test("mensagem inexistente ou sem plano retorna undefined sem alterar o banco", async () => {
      const first = await fixture();
      const withoutPlan = await message(first.command.draft.conversationId);
      const before = await databaseSnapshot();
      equal(await loadMessageResponsePlan(randomUUID(), reader), undefined);
      equal(await loadMessageResponsePlan(withoutPlan.draft.messageId, reader), undefined);
      deepEqual(await databaseSnapshot(), before);
    });

    await t.test("carrega o plano original completo com blocos ordenados, textos e datas preservados", async () => {
      const { command, planId } = await fixture();
      // Reinsere em ordem física diferente: posição é a ordem contratual.
      await pool.query("DELETE FROM public.response_blocks WHERE plan_id = $1;", [planId]);
      for (const position of [3, 1, 2]) {
        const block = command.draft.blocks.find((block) => block.position === position);
        ok(block);
        await pool.query("INSERT INTO public.response_blocks (plan_id, conversation_id, position, text) VALUES ($1, $2, $3, $4);",
          [planId, command.draft.conversationId, position, block.text]);
      }
      const metadata = (await pool.query<{ created_at: Date }>("SELECT created_at FROM public.response_plans WHERE id = $1;", [planId])).rows[0];
      ok(metadata);
      const before = await databaseSnapshot();
      deepEqual(await loadMessageResponsePlan(command.draft.messageId.toUpperCase(), reader), {
        id: planId, messageId: command.draft.messageId, conversationId: command.draft.conversationId,
        sourceJobId: command.attempt.id, expectedStatus: "aguardando_menu", decision: command.draft.decision,
        referenceAt: command.draft.referenceAt, createdAt: metadata.created_at, status: "pendente", finishedAt: null,
        blocks: command.draft.blocks.map((block) => ({ ...block, status: "pendente", sentMessageId: null, sentAt: null })),
      });
      deepEqual(await databaseSnapshot(), before);
    });

    await t.test("preserva confirmação parcial sem recompor os textos nem finalizar o plano", async () => {
      const { command, planId } = await fixture();
      await progress(planId, [1]);
      const before = await databaseSnapshot();
      const plan = await reader.findByMessageId(command.draft.messageId);
      ok(plan);
      equal(plan.status, "pendente");
      equal(plan.finishedAt, null);
      const first = plan.blocks[0];
      ok(first?.status === "enviado");
      ok(first.sentAt instanceof Date);
      const saved = (await pool.query("SELECT sent_message_id, sent_at FROM public.response_blocks WHERE plan_id = $1 AND position = 1;", [planId])).rows[0];
      deepEqual({ sentMessageId: first.sentMessageId, sentAt: first.sentAt }, { sentMessageId: saved?.sent_message_id, sentAt: saved?.sent_at });
      deepEqual(plan.blocks.map((block) => block.text), command.draft.blocks.map((block) => block.text));
      deepEqual(plan.blocks.map((block) => block.status), ["enviado", "pendente", "pendente"]);
      deepEqual(await databaseSnapshot(), before);
    });

    await t.test("lê plano enviado mesmo com job concluído e conversa em qualquer estado", async () => {
      const { command, planId } = await fixture();
      await progress(planId, [1, 2, 3], "enviado");
      await pool.query("UPDATE public.jobs SET status = 'concluido', locked_at = NULL WHERE id = $1;", [command.attempt.id]);
      const original = await reader.findByMessageId(command.draft.messageId);
      ok(original?.status === "enviado");
      ok(original.finishedAt instanceof Date);
      ok(original.blocks.every((block) => block.status === "enviado"));
      for (const status of ["aguardando_menu", "aguardando_detalhes", "qualificando", "aguardando_humano", "em_atendimento_humano", "encerrada"]) {
        await pool.query(`UPDATE public.conversations SET status = $2,
          closed_at = CASE WHEN $2 = 'encerrada' THEN CURRENT_TIMESTAMP ELSE NULL END WHERE id = $1;`, [command.draft.conversationId, status]);
        const before = await databaseSnapshot();
        deepEqual(await reader.findByMessageId(command.draft.messageId), original);
        deepEqual(await databaseSnapshot(), before);
      }
    });

    await t.test("plano cancelado preserva blocos já enviados e cancelamentos sem confirmação", async () => {
      const { command, planId } = await fixture();
      await progress(planId, [1], "cancelado");
      const plan = await reader.findByMessageId(command.draft.messageId);
      ok(plan?.status === "cancelado");
      ok(plan.finishedAt instanceof Date);
      deepEqual(plan.blocks.map((block) => block.status), ["enviado", "cancelado", "cancelado"]);
      for (const block of plan.blocks.slice(1)) {
        equal(block.sentMessageId, null); equal(block.sentAt, null);
      }
      const other = await fixture();
      await progress(other.planId, [], "cancelado");
      ok((await reader.findByMessageId(other.command.draft.messageId))?.blocks.every((block) => block.status === "cancelado"));
    });

    await t.test("mensagem histórica mantém seu plano mesmo com outro ciclo aberto do contato", async () => {
      const first = await fixture();
      await progress(first.planId, [1, 2, 3], "enviado");
      const original = await reader.findByMessageId(first.command.draft.messageId);
      await pool.query("UPDATE public.conversations SET status = 'encerrada', closed_at = CURRENT_TIMESTAMP WHERE id = $1;", [first.command.draft.conversationId]);
      const next = (await pool.query<{ id: string }>(`INSERT INTO public.conversations (contact_id)
        SELECT contact_id FROM public.conversations WHERE id = $1 RETURNING id;`, [first.command.draft.conversationId])).rows[0];
      ok(next);
      const second = await prepare(await message(next.id));
      deepEqual(await reader.findByMessageId(first.command.draft.messageId), original);
      equal((await reader.findByMessageId(second.command.draft.messageId))?.id, second.planId);
    });

    await t.test("reconhece as três ações de menu sem substituir o plano de abertura", async () => {
      for (const decision of [
        { action: "reapresentar_menu", nextStatus: "aguardando_menu" },
        { action: "informar_servicos", nextStatus: "aguardando_detalhes" },
        { action: "informar_valores_horarios", nextStatus: "aguardando_detalhes" },
      ] satisfies MessageResponsePlanDraft["decision"][]) {
        const first = await fixture();
        await progress(first.planId, [1, 2, 3], "enviado");
        const command = await message(first.command.draft.conversationId);
        command.draft.decision = decision;
        const next = await prepare(command);
        const plan = await reader.findByMessageId(command.draft.messageId);
        equal(plan?.id, next.planId);
        deepEqual(plan?.decision, decision);
        equal((await reader.findByMessageId(first.command.draft.messageId))?.id, first.planId);
      }
    });

    await t.test("leituras independentes não permitem alterar o conteúdo persistido pelo objeto retornado", async () => {
      const { command } = await fixture();
      const first = await reader.findByMessageId(command.draft.messageId);
      ok(first && first.blocks[0]);
      const expected = structuredClone(first);
      const before = await databaseSnapshot();
      first.referenceAt.setTime(0); first.createdAt.setTime(0); first.blocks[0].text = "Não persistir";
      first.blocks.pop();
      deepEqual(await reader.findByMessageId(command.draft.messageId), expected);
      deepEqual(await databaseSnapshot(), before);
    });

    await t.test("plano sem blocos ou com lacuna é inválido, não inexistente; erro não revela texto", async () => {
      for (const change of ["sem_blocos", "lacuna"]) {
        const { command, planId } = await fixture();
        if (change === "sem_blocos") await pool.query("DELETE FROM public.response_blocks WHERE plan_id = $1;", [planId]);
        else await pool.query("UPDATE public.response_blocks SET position = 4 WHERE plan_id = $1 AND position = 3;", [planId]);
        const before = await databaseSnapshot();
        await rejects(reader.findByMessageId(command.draft.messageId), { name: "Error", message: "O plano de resposta persistido é inválido." });
        deepEqual(await databaseSnapshot(), before);
      }
    });

    await t.test("incoerência entre estados de plano e blocos rejeita a leitura sem reparar dados", async () => {
      for (const change of ["enviado", "cancelado", "bloco_cancelado"]) {
        const { command, planId } = await fixture();
        if (change === "bloco_cancelado") {
          await pool.query("UPDATE public.response_blocks SET status = 'cancelado' WHERE plan_id = $1;", [planId]);
        } else {
          await pool.query("UPDATE public.response_plans SET status = $2, finished_at = CURRENT_TIMESTAMP WHERE id = $1;", [planId, change]);
        }
        const before = await databaseSnapshot();
        await rejects(reader.findByMessageId(command.draft.messageId), { message: "O plano de resposta persistido é inválido." });
        deepEqual(await databaseSnapshot(), before);
      }
    });

    await t.test("UUID inválido é recusado antes do SQL, com mensagem fixa e banco preservado", async () => {
      const before = await databaseSnapshot();
      const query = t.mock.method(pool, "query");
      try {
        for (const id of ["", "id-do-provedor", "segredo_sintetico", "' OR true --"]) {
          await rejects(reader.findByMessageId(id), { name: "TypeError", message: "A leitura do plano exige o UUID interno da mensagem." });
        }
        equal(query.mock.callCount(), 0);
      } finally { query.mock.restore(); }
      deepEqual(await databaseSnapshot(), before);
    });

    await t.test("leitura vê a versão confirmada completa antes e depois de uma confirmação concorrente", async () => {
      const { command, planId } = await fixture();
      const before = await reader.findByMessageId(command.draft.messageId);
      const writer = await pool.connect();
      try {
        await writer.query("BEGIN;");
        for (const position of [1, 2, 3]) await confirmBlock(writer, planId, position);
        await writer.query("UPDATE public.response_plans SET status = 'enviado', finished_at = CURRENT_TIMESTAMP WHERE id = $1;", [planId]);
        deepEqual(await reader.findByMessageId(command.draft.messageId), before);
        await writer.query("COMMIT;");
        const after = await reader.findByMessageId(command.draft.messageId);
        ok(after?.status === "enviado");
        ok(after.finishedAt instanceof Date);
        ok(after.blocks.every((block) => block.status === "enviado"));
        equal(after.id, before?.id);
        deepEqual(after.blocks.map((block) => block.text), before?.blocks.map((block) => block.text));
      } finally { await writer.query("ROLLBACK;"); writer.release(); }
    });

    await t.test("falha SQL é propagada e não se transforma em plano inexistente", async () => {
      const { command, planId } = await fixture();
      // Indisponibilidade de relação somente no banco descartável desta suíte.
      await pool.query("ALTER TABLE public.response_plans RENAME TO response_plans_unavailable_test;");
      try { await rejects(reader.findByMessageId(command.draft.messageId), { code: "42P01" }); }
      finally { await pool.query("ALTER TABLE public.response_plans_unavailable_test RENAME TO response_plans;"); }
      equal((await reader.findByMessageId(command.draft.messageId))?.id, planId);
    });
  } finally {
    try {
      await pool.end();
      if (databaseCreated) await admin.query(`DROP DATABASE "${temporaryDatabase}" WITH (FORCE);`);
    } finally { await admin.end(); }
  }
});
