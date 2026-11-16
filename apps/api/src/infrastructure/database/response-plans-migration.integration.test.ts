import { deepEqual, equal, match, ok, rejects } from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { runner } from "node-pg-migrate";
import { Client } from "pg";
import { readDatabaseConfig } from "../../config/database.js";
import { createDatabasePool } from "./pool.js";

test("migração de planos e blocos em banco descartável", { timeout: 60000 }, async (t) => {
  const config = readDatabaseConfig(process.env);
  if (!["127.0.0.1", "localhost", "::1"].includes(config.host)) {
    throw new Error("O teste de integração exige um PostgreSQL local.");
  }
  const temporaryDatabase = `copilot_response_test_${randomUUID().replaceAll("-", "")}`;
  const dependencies = ["1793750400000_create_contacts", "1793750401000_create_conversations",
    "1793750402000_create_messages", "1793750403000_create_jobs"];
  const migration = "1794787200000_create_response_plans";
  const admin = new Client({ ...config, connectionTimeoutMillis: 5000 });
  const testConfig = { ...config, database: temporaryDatabase };
  const pool = createDatabasePool(testConfig);
  let databaseCreated = false;
  let phoneSequence = 0;

  async function migrate(direction: "up" | "down", file = migration) {
    const client = new Client({ ...testConfig, connectionTimeoutMillis: 5000 });
    try {
      await client.connect();
      return await runner({ dbClient: client, dir: fileURLToPath(new URL("../../../migrations/", import.meta.url)),
        file, direction, schema: "public", migrationsTable: "pgmigrations", checkOrder: true,
        singleTransaction: true, logger: { info: () => {}, warn: () => {}, error: () => {} } });
    } finally { await client.end(); }
  }
  async function createSource(conversationId?: string) {
    if (conversationId === undefined) {
      const contact = await pool.query<{ id: string }>("INSERT INTO public.contacts (phone) VALUES ($1) RETURNING id;",
        [`+1555${String(++phoneSequence).padStart(7, "0")}`]);
      ok(contact.rows[0]);
      const conversation = await pool.query<{ id: string }>(
        "INSERT INTO public.conversations (contact_id) VALUES ($1) RETURNING id;", [contact.rows[0].id]);
      ok(conversation.rows[0]);
      conversationId = conversation.rows[0].id;
    }
    const message = await pool.query<{ id: string }>(`INSERT INTO public.messages
      (conversation_id, provider, external_id, direction, sender_type, kind, body)
      VALUES ($1, 'simulador', $2, 'entrada', 'contato', 'texto', 'Mensagem sintética') RETURNING id;`,
    [conversationId, randomUUID()]);
    ok(message.rows[0]);
    const job = await pool.query<{ id: string }>(
      "INSERT INTO public.jobs (type, message_id) VALUES ('processar_mensagem', $1) RETURNING id;", [message.rows[0].id]);
    ok(job.rows[0]);
    return { conversationId, messageId: message.rows[0].id, jobId: job.rows[0].id };
  }
  type Source = Awaited<ReturnType<typeof createSource>>;
  async function insertPlan(source: Source, action = "enviar_abertura", status = "pendente") {
    const result = await pool.query<{ id: string }>(`INSERT INTO public.response_plans
      (conversation_id, source_message_id, source_job_id, action, expected_status, next_status, reference_at, status, finished_at)
      VALUES ($1, $2, $3, $4, 'aguardando_menu', $5, '2026-11-16T12:00:00Z', $6,
        CASE WHEN $6 = 'pendente' THEN NULL ELSE CURRENT_TIMESTAMP END) RETURNING id;`,
    [source.conversationId, source.messageId, source.jobId, action,
      action === "informar_servicos" || action === "informar_valores_horarios" ? "aguardando_detalhes" : "aguardando_menu", status]);
    ok(result.rows[0]);
    return result.rows[0].id;
  }
  const insertBlock = (planId: string, conversationId: string, position = 1, text = "Texto sintético") => pool.query(
    "INSERT INTO public.response_blocks (plan_id, conversation_id, position, text) VALUES ($1, $2, $3, $4);",
    [planId, conversationId, position, text]);
  async function outgoing(conversationId: string) {
    const result = await pool.query<{ id: string }>(`INSERT INTO public.messages
      (conversation_id, provider, external_id, direction, sender_type, kind, body)
      VALUES ($1, 'simulador', $2, 'saida', 'bot', 'texto', 'Resposta sintética') RETURNING id;`, [conversationId, randomUUID()]);
    ok(result.rows[0]);
    return result.rows[0].id;
  }
  async function baseSnapshot() {
    const snapshot: Record<string, unknown> = {};
    for (const table of ["contacts", "conversations", "messages", "jobs"]) {
      snapshot[table] = (await pool.query(`SELECT coalesce(jsonb_agg(to_jsonb(t) ORDER BY id), '[]') AS data FROM public.${table} t;`)).rows[0]?.data;
    }
    return snapshot;
  }

  try {
    await admin.connect();
    await admin.query(`CREATE DATABASE "${temporaryDatabase}" TEMPLATE template0;`);
    databaseCreated = true;
    for (const dependency of dependencies) await migrate("up", dependency);
    await createSource(); // A migração também deve preservar dados anteriores.
    const initial = await baseSnapshot();

    await t.test("aplica a quinta migração e preserva integralmente os dados existentes", async () => {
      const applied = await migrate("up");
      equal(applied.length, 1);
      equal(applied[0]?.name, migration);
      deepEqual(await baseSnapshot(), initial);
      const history = await pool.query("SELECT name FROM public.pgmigrations ORDER BY id;");
      deepEqual(history.rows, [...dependencies, migration].map((name) => ({ name })));
    });

    await t.test("gera plano UUID pendente e bloco pendente sem confirmação", async () => {
      const source = await createSource();
      const id = await insertPlan(source);
      const plan = (await pool.query("SELECT * FROM public.response_plans WHERE id = $1;", [id])).rows[0];
      ok(plan);
      match(plan.id, /^[0-9a-f-]{36}$/);
      equal(plan.status, "pendente");
      equal(plan.finished_at, null);
      ok(plan.created_at instanceof Date);
      await insertBlock(id, source.conversationId, 1, " Texto preservado\n");
      const block = (await pool.query("SELECT * FROM public.response_blocks WHERE plan_id = $1;", [id])).rows[0];
      deepEqual(block, { plan_id: id, conversation_id: source.conversationId, position: 1,
        text: " Texto preservado\n", status: "pendente", sent_message_id: null, sent_at: null });
    });

    await t.test("exige os campos obrigatórios de planos e blocos", async () => {
      const source = await createSource();
      const columns = ["id", "conversation_id", "source_message_id", "source_job_id", "action", "expected_status",
        "next_status", "reference_at", "status", "created_at"];
      const original = [randomUUID(), source.conversationId, source.messageId, source.jobId, "enviar_abertura",
        "aguardando_menu", "aguardando_menu", new Date("2026-11-16T12:00:00Z"), "pendente", new Date()];
      for (const [index, column] of columns.entries()) {
        const values: unknown[] = [...original]; values[index] = null;
        await rejects(pool.query(`INSERT INTO public.response_plans (${columns.join(", ")})
          VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10);`, values), { code: "23502", column });
      }
      const id = await insertPlan(source);
      for (const [index, column] of ["plan_id", "conversation_id", "position", "text", "status"].entries()) {
        const values: unknown[] = [id, source.conversationId, 1, "Texto", "pendente"]; values[index] = null;
        await rejects(pool.query(`INSERT INTO public.response_blocks (plan_id,conversation_id,position,text,status)
          VALUES ($1,$2,$3,$4,$5);`, values), { code: "23502", column });
      }
    });

    await t.test("recusa mensagem inexistente e mensagem pertencente a outra conversa", async () => {
      const source = await createSource();
      await rejects(insertPlan({ ...source, messageId: randomUUID() }), { code: "23503" });
      await rejects(insertPlan({ ...source, conversationId: randomUUID() }),
        { code: "23503", constraint: "response_plans_source_message_conversation_fkey" });
      const other = await createSource();
      await rejects(insertPlan({ ...source, conversationId: other.conversationId }),
        { code: "23503", constraint: "response_plans_source_message_conversation_fkey" });
    });

    await t.test("recusa job inexistente ou vinculado a outra mensagem", async () => {
      const source = await createSource();
      await rejects(insertPlan({ ...source, jobId: randomUUID() }),
        { code: "23503", constraint: "response_plans_source_job_message_fkey" });
      const other = await createSource(source.conversationId);
      await rejects(insertPlan({ ...source, jobId: other.jobId }),
        { code: "23503", constraint: "response_plans_source_job_message_fkey" });
    });

    await t.test("permite somente as quatro ações e a correspondência com o próximo estado", async () => {
      for (const action of ["enviar_abertura", "reapresentar_menu", "informar_servicos", "informar_valores_horarios"]) {
        await insertPlan(await createSource(), action);
      }
      const source = await createSource();
      await rejects(insertPlan(source, "solicitar_qualificacao"), { code: "23514", constraint: "response_plans_action_next_status_check" });
      const id = await insertPlan(source, "informar_servicos");
      await rejects(pool.query("UPDATE public.response_plans SET next_status = 'aguardando_menu' WHERE id = $1;", [id]),
        { code: "23514", constraint: "response_plans_action_next_status_check" });
      await rejects(pool.query("UPDATE public.response_plans SET expected_status = 'aguardando_humano' WHERE id = $1;", [id]),
        { code: "23514", constraint: "response_plans_expected_status_check" });
    });

    await t.test("exige status conhecido e término coerente e finito", async () => {
      const id = await insertPlan(await createSource());
      for (const update of ["status = 'invalido'", "status = 'enviado'", "status = 'cancelado'", "finished_at = now()",
        "status = 'enviado', finished_at = created_at - INTERVAL '1 second'",
        "status = 'enviado', finished_at = 'infinity'", "reference_at = 'infinity'", "created_at = '-infinity'"]) {
        await rejects(pool.query(`UPDATE public.response_plans SET ${update} WHERE id = $1;`, [id]), { code: "23514" });
      }
      for (const status of ["enviado", "cancelado"]) {
        await pool.query("UPDATE public.response_plans SET status = $2, finished_at = created_at WHERE id = $1;", [id, status]);
        equal((await pool.query("SELECT status FROM public.response_plans WHERE id = $1;", [id])).rows[0]?.status, status);
      }
    });

    await t.test("mantém um plano por mensagem mesmo após envio ou cancelamento", async () => {
      for (const status of ["pendente", "enviado", "cancelado"]) {
        const source = await createSource();
        await insertPlan(source, "reapresentar_menu", status);
        await rejects(insertPlan(source, "informar_servicos", "enviado"),
          { code: "23505", constraint: "response_plans_source_message_id_key" });
      }
    });

    await t.test("abertura é única por conversa em todos os estados", async () => {
      for (const status of ["pendente", "enviado", "cancelado"]) {
        const source = await createSource();
        await insertPlan(source, "enviar_abertura", status);
        const next = await createSource(source.conversationId);
        await rejects(insertPlan(next, "enviar_abertura", "enviado"),
          { code: "23505", constraint: "response_plans_opening_conversation_key" });
      }
    });

    await t.test("limita plano pendente por conversa sem impedir histórico ou outra conversa", async () => {
      const source = await createSource();
      const id = await insertPlan(source, "informar_servicos");
      const next = await createSource(source.conversationId);
      await rejects(insertPlan(next, "reapresentar_menu"),
        { code: "23505", constraint: "response_plans_pending_conversation_key" });
      await insertPlan(await createSource(), "informar_servicos");
      await pool.query("UPDATE public.response_plans SET status = 'cancelado', finished_at = now() WHERE id = $1;", [id]);
      await insertPlan(next, "reapresentar_menu");
      await insertPlan(await createSource(source.conversationId), "informar_servicos", "enviado");
    });

    await t.test("impede apagar origens de um plano e um plano que ainda tem blocos", async () => {
      const source = await createSource();
      const id = await insertPlan(source);
      await insertBlock(id, source.conversationId);
      await rejects(pool.query("DELETE FROM public.jobs WHERE id = $1;", [source.jobId]), { code: "23001" });
      await rejects(pool.query("DELETE FROM public.messages WHERE id = $1;", [source.messageId]), { code: "23001" });
      await rejects(pool.query("DELETE FROM public.response_plans WHERE id = $1;", [id]),
        { code: "23001", constraint: "response_blocks_plan_conversation_fkey" });
    });

    await t.test("blocos exigem plano existente e a mesma conversa do plano", async () => {
      const source = await createSource();
      const id = await insertPlan(source);
      await rejects(insertBlock(randomUUID(), source.conversationId), { code: "23503" });
      const other = await createSource();
      await rejects(insertBlock(id, other.conversationId),
        { code: "23503", constraint: "response_blocks_plan_conversation_fkey" });
    });

    await t.test("posições são positivas e únicas por plano, textos vazios não entram", async () => {
      const source = await createSource();
      const id = await insertPlan(source);
      for (const position of [0, -1]) await rejects(insertBlock(id, source.conversationId, position), { code: "23514" });
      for (const text of ["", "   ", "\t\r\n"]) await rejects(insertBlock(id, source.conversationId, 1, text),
        { code: "23514", constraint: "response_blocks_text_not_blank_check" });
      await insertBlock(id, source.conversationId);
      await rejects(insertBlock(id, source.conversationId), { code: "23505", constraint: "response_blocks_pkey" });
      const other = await createSource();
      await insertBlock(await insertPlan(other), other.conversationId, 1);
    });

    await t.test("confirmação do bloco exige mensagem e data somente no estado enviado", async () => {
      const source = await createSource();
      const id = await insertPlan(source);
      const messageId = await outgoing(source.conversationId);
      await insertBlock(id, source.conversationId);
      for (const update of ["status = 'invalido'", "status = 'enviado'", "sent_at = now()",
        "sent_message_id = $2", "status = 'enviado', sent_at = now()",
        "status = 'enviado', sent_message_id = $2",
        "status = 'enviado', sent_message_id = $2, sent_at = 'infinity'"]) {
        const values = update.includes("$2") ? [id, messageId] : [id];
        await rejects(pool.query(`UPDATE public.response_blocks SET ${update} WHERE plan_id = $1;`, values), { code: "23514" });
      }
      await pool.query("UPDATE public.response_blocks SET status = 'cancelado' WHERE plan_id = $1;", [id]);
      await pool.query("UPDATE public.response_blocks SET status = 'enviado', sent_message_id = $2, sent_at = now() WHERE plan_id = $1;", [id, messageId]);
      equal((await pool.query("SELECT status FROM public.response_blocks WHERE plan_id = $1;", [id])).rows[0]?.status, "enviado");
    });

    await t.test("mensagem confirmada precisa existir, pertencer à conversa e não atender dois blocos", async () => {
      const source = await createSource();
      const id = await insertPlan(source);
      await insertBlock(id, source.conversationId, 1);
      await insertBlock(id, source.conversationId, 2);
      const other = await createSource();
      for (const messageId of [randomUUID(), await outgoing(other.conversationId)]) {
        await rejects(pool.query(`UPDATE public.response_blocks SET status = 'enviado', sent_message_id = $2, sent_at = now()
          WHERE plan_id = $1 AND position = 1;`, [id, messageId]),
        { code: "23503", constraint: "response_blocks_sent_message_conversation_fkey" });
      }
      const messageId = await outgoing(source.conversationId);
      await pool.query(`UPDATE public.response_blocks SET status = 'enviado', sent_message_id = $2, sent_at = now()
        WHERE plan_id = $1 AND position = 1;`, [id, messageId]);
      await rejects(pool.query(`UPDATE public.response_blocks SET status = 'enviado', sent_message_id = $2, sent_at = now()
        WHERE plan_id = $1 AND position = 2;`, [id, messageId]),
      { code: "23505", constraint: "response_blocks_sent_message_id_key" });
      await rejects(pool.query("DELETE FROM public.messages WHERE id = $1;", [messageId]), { code: "23001" });
    });

    await t.test("unicidade da origem decide inserções concorrentes", async () => {
      const source = await createSource();
      const results = await Promise.allSettled([
        insertPlan(source, "informar_servicos", "enviado"), insertPlan(source, "informar_servicos", "enviado"),
      ]);
      equal(results.filter((result) => result.status === "fulfilled").length, 1);
      const rejected = results.find((result) => result.status === "rejected");
      ok(rejected?.status === "rejected");
      const error: unknown = rejected.reason;
      ok(error !== null && typeof error === "object" && "code" in error && "constraint" in error);
      equal(error.code, "23505"); equal(error.constraint, "response_plans_source_message_id_key");
    });

    await t.test("índices parciais também impedem aberturas e planos pendentes concorrentes", async () => {
      for (const [action, status, constraint] of [
        ["enviar_abertura", "enviado", "response_plans_opening_conversation_key"],
        ["informar_servicos", "pendente", "response_plans_pending_conversation_key"],
      ] as const) {
        const first = await createSource();
        const second = await createSource(first.conversationId);
        const results = await Promise.allSettled([insertPlan(first, action, status), insertPlan(second, action, status)]);
        equal(results.filter((result) => result.status === "fulfilled").length, 1);
        const rejected = results.find((result) => result.status === "rejected");
        ok(rejected?.status === "rejected");
        const error: unknown = rejected.reason;
        ok(error !== null && typeof error === "object" && "code" in error && "constraint" in error);
        equal(error.code, "23505"); equal(error.constraint, constraint);
      }
    });

    await t.test("erro ao inserir bloco permite rollback integral da transação de preparação", async () => {
      const source = await createSource();
      const client = await pool.connect();
      let transactionOpen = false;
      try {
        await client.query("BEGIN;");
        transactionOpen = true;
        const result = await client.query<{ id: string }>(`INSERT INTO public.response_plans
          (conversation_id,source_message_id,source_job_id,action,expected_status,next_status,reference_at)
          VALUES ($1,$2,$3,'enviar_abertura','aguardando_menu','aguardando_menu',now()) RETURNING id;`,
        [source.conversationId, source.messageId, source.jobId]);
        ok(result.rows[0]);
        await client.query("INSERT INTO public.response_blocks (plan_id,conversation_id,position,text) VALUES ($1,$2,1,'Primeiro');",
          [result.rows[0].id, source.conversationId]);
        await rejects(client.query("INSERT INTO public.response_blocks (plan_id,conversation_id,position,text) VALUES ($1,$2,2,'');",
          [result.rows[0].id, source.conversationId]), { code: "23514" });
        await client.query("ROLLBACK;");
        transactionOpen = false;
        equal((await pool.query("SELECT count(*)::integer AS count FROM public.response_plans WHERE source_message_id = $1;",
          [source.messageId])).rows[0]?.count, 0);
        equal((await pool.query("SELECT count(*)::integer AS count FROM public.response_blocks WHERE plan_id = $1;",
          [result.rows[0].id])).rows[0]?.count, 0);
      } finally {
        try { if (transactionOpen) await client.query("ROLLBACK;"); }
        finally { client.release(); }
      }
    });

    await t.test("reaplicação é inócua e down remove somente objetos desta migração", async () => {
      const before = await baseSnapshot();
      const snapshot = () => pool.query(`SELECT
        (SELECT jsonb_agg(to_jsonb(p) ORDER BY id) FROM public.response_plans p) AS plans,
        (SELECT jsonb_agg(to_jsonb(b) ORDER BY plan_id, position) FROM public.response_blocks b) AS blocks;`);
      const responses = (await snapshot()).rows;
      equal((await migrate("up")).length, 0);
      deepEqual((await snapshot()).rows, responses);
      const indexes = await pool.query<{ indexname: string }>(`SELECT indexname FROM pg_indexes WHERE schemaname = 'public'
        AND indexname IN ('response_plans_opening_conversation_key','response_plans_pending_conversation_key') ORDER BY indexname;`);
      deepEqual(indexes.rows.map((row) => row.indexname), ["response_plans_opening_conversation_key", "response_plans_pending_conversation_key"]);
      equal((await migrate("down")).length, 1);
      deepEqual((await pool.query("SELECT to_regclass('public.response_plans')::text AS plans, to_regclass('public.response_blocks')::text AS blocks;")).rows[0],
        { plans: null, blocks: null });
      const remaining = await pool.query(`SELECT conname FROM pg_constraint
        WHERE conname IN ('messages_id_conversation_id_key','jobs_id_message_id_key');`);
      equal(remaining.rowCount, 0);
      deepEqual(await baseSnapshot(), before);
      deepEqual((await pool.query("SELECT name FROM public.pgmigrations ORDER BY id;")).rows, dependencies.map((name) => ({ name })));
      equal((await migrate("up")).length, 1);
    });
  } finally {
    try {
      await pool.end();
      if (databaseCreated) await admin.query(`DROP DATABASE "${temporaryDatabase}" WITH (FORCE);`);
    } finally { await admin.end(); }
  }
});
