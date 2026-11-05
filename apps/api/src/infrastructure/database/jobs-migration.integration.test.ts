import { deepEqual, equal, match, ok, rejects } from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { runner } from "node-pg-migrate";
import { Client } from "pg";
import { readDatabaseConfig } from "../../config/database.js";
import { createDatabasePool } from "./pool.js";

test("migração de jobs em banco descartável", { timeout: 60000 }, async (t) => {
  const config = readDatabaseConfig(process.env);

  if (!["127.0.0.1", "localhost", "::1"].includes(config.host)) {
    throw new Error("O teste de integração exige um PostgreSQL local.");
  }

  const temporaryDatabase = `copilot_jobs_test_${randomUUID().replaceAll("-", "")}`;
  const dependencies = ["1793750400000_create_contacts", "1793750401000_create_conversations",
    "1793750402000_create_messages"];
  const jobsMigration = "1793750403000_create_jobs";
  const admin = new Client({ ...config, connectionTimeoutMillis: 5000 });
  const testConfig = { ...config, database: temporaryDatabase };
  const pool = createDatabasePool(testConfig);
  let databaseCreated = false;
  let contactSequence = 0;

  const migrate = async (direction: "up" | "down", file = jobsMigration) => {
    const migrationClient = new Client({ ...testConfig, connectionTimeoutMillis: 5000 });
    try {
      await migrationClient.connect();
      return await runner({
        dbClient: migrationClient,
        dir: fileURLToPath(new URL("../../../migrations/", import.meta.url)),
        file,
        direction,
        schema: "public",
        migrationsTable: "pgmigrations",
        checkOrder: true,
        singleTransaction: true,
        logger: {
          info: () => {},
          warn: () => {},
          error: () => {},
        },
      });
    } finally {
      // Aguarda o encerramento antes de permitir a remoção do banco descartável.
      await migrationClient.end();
    }
  };

  // Fixture sintética que prepara os vínculos exigidos pelo job.
  async function createMessage(): Promise<string> {
    contactSequence += 1;
    const contact = await pool.query<{ id: string }>(
      "INSERT INTO public.contacts (phone) VALUES ($1) RETURNING id;",
      [`+1555${String(contactSequence).padStart(7, "0")}`]);
    ok(contact.rows[0]);
    const conversation = await pool.query<{ id: string }>(
      "INSERT INTO public.conversations (contact_id) VALUES ($1) RETURNING id;", [contact.rows[0].id]);
    ok(conversation.rows[0]);
    const message = await pool.query<{ id: string }>(
      "INSERT INTO public.messages (conversation_id, provider, external_id, direction, sender_type, kind, body) VALUES ($1, 'simulador', $2, 'entrada', 'contato', 'texto', 'Mensagem sintética') RETURNING id;",
      [conversation.rows[0].id, randomUUID()]);
    ok(message.rows[0]);
    return message.rows[0].id;
  }

  const insertJob = (messageId: string, type = "processar_mensagem") => pool.query(
    "INSERT INTO public.jobs (type, message_id) VALUES ($1, $2);", [type, messageId]);

  try {
    await admin.connect();
    // O identificador contém apenas prefixo fixo e UUID hexadecimal gerado aqui.
    await admin.query(`CREATE DATABASE "${temporaryDatabase}" TEMPLATE template0;`);
    databaseCreated = true;
    for (const dependency of dependencies) await migrate("up", dependency);

    await t.test("aplica jobs após mensagens e registra as quatro migrações", async () => {
      const applied = await migrate("up");
      equal(applied.length, 1);
      equal(applied[0]?.name, jobsMigration);
      const history = await pool.query<{ name: string }>("SELECT name FROM public.pgmigrations ORDER BY id;");
      deepEqual(history.rows, [...dependencies, jobsMigration].map((name) => ({ name })));
    });

    await t.test("gera UUID e datas e inicia pendente sem tentativas, trava ou erro", async () => {
      const messageId = await createMessage();
      const result = await pool.query<{
        id: string; status: string; attempts: number; max_attempts: number;
        run_at: Date; created_at: Date; locked_at: Date | null; last_error: string | null;
      }>("INSERT INTO public.jobs (type, message_id) VALUES ('processar_mensagem', $1) RETURNING *;", [messageId]);
      const job = result.rows[0];
      ok(job);
      match(job.id, /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i);
      equal(job.status, "pendente");
      equal(job.attempts, 0);
      equal(job.max_attempts, 3);
      for (const date of [job.run_at, job.created_at]) {
        ok(date instanceof Date);
        ok(Number.isFinite(date.getTime()));
      }
      equal(job.locked_at, null);
      equal(job.last_error, null);
    });

    await t.test("rejeita campos obrigatórios explicitamente nulos", async () => {
      const messageId = await createMessage();
      const columns = ["id", "type", "message_id", "status", "attempts", "max_attempts", "run_at", "created_at"];
      for (const [index, column] of columns.entries()) {
        const values: (string | number | Date | null)[] = [
          randomUUID(), "processar_mensagem", messageId, "pendente", 0, 3, new Date(), new Date(),
        ];
        values[index] = null;
        await rejects(pool.query(
          "INSERT INTO public.jobs (id, type, message_id, status, attempts, max_attempts, run_at, created_at) VALUES ($1, $2, $3, $4, $5, $6, $7, $8);", values),
          { code: "23502", column });
      }
    });

    await t.test("exige mensagem existente e impede apagar uma mensagem com job", async () => {
      await rejects(insertJob(randomUUID()), { code: "23503", constraint: "jobs_message_id_fkey" });
      const messageId = await createMessage();
      await insertJob(messageId);
      await rejects(pool.query("DELETE FROM public.messages WHERE id = $1;", [messageId]),
        { code: "23001", constraint: "jobs_message_id_fkey" });
    });

    await t.test("aceita os quatro estados e rejeita estado inválido ou tipo vazio", async () => {
      for (const status of ["pendente", "processando", "concluido", "falhou"]) {
        const messageId = await createMessage();
        await pool.query(
          "INSERT INTO public.jobs (type, message_id, status, locked_at) VALUES ('processar_mensagem', $1, $2, $3);",
          [messageId, status, status === "processando" ? new Date() : null]);
      }
      const messageId = await createMessage();
      await rejects(pool.query(
        "INSERT INTO public.jobs (type, message_id, status) VALUES ('processar_mensagem', $1, 'invalido');", [messageId]),
        { code: "23514", constraint: "jobs_status_check" });
      for (const type of ["", "   "]) {
        await rejects(insertJob(messageId, type), { code: "23514", constraint: "jobs_type_not_blank_check" });
      }
    });

    await t.test("limita tentativas a zero até o máximo e exige máximo positivo", async () => {
      const messageId = await createMessage();
      for (const attempts of [-1, 4]) {
        await rejects(pool.query(
          "INSERT INTO public.jobs (type, message_id, attempts) VALUES ('processar_mensagem', $1, $2);", [messageId, attempts]),
          { code: "23514", constraint: "jobs_attempts_check" });
      }
      for (const maxAttempts of [0, -1]) {
        // Um máximo negativo também conflita com o intervalo de attempts.
        await rejects(pool.query(
          "INSERT INTO public.jobs (type, message_id, max_attempts) VALUES ('processar_mensagem', $1, $2);", [messageId, maxAttempts]),
          { code: "23514" });
      }
      await insertJob(messageId);
      await pool.query("UPDATE public.jobs SET attempts = max_attempts WHERE message_id = $1;", [messageId]);
      const job = await pool.query<{ attempts: number; max_attempts: number }>(
        "SELECT attempts, max_attempts FROM public.jobs WHERE message_id = $1;", [messageId]);
      deepEqual(job.rows[0], { attempts: 3, max_attempts: 3 });
    });

    await t.test("exige trava apenas enquanto processando e permite reagendar o mesmo job", async () => {
      const messageId = await createMessage();
      await rejects(pool.query(
        "INSERT INTO public.jobs (type, message_id, status) VALUES ('processar_mensagem', $1, 'processando');", [messageId]),
        { code: "23514", constraint: "jobs_locked_at_status_check" });
      for (const status of ["pendente", "concluido", "falhou"]) {
        await rejects(pool.query(
          "INSERT INTO public.jobs (type, message_id, status, locked_at) VALUES ('processar_mensagem', $1, $2, now());",
          [messageId, status]), { code: "23514", constraint: "jobs_locked_at_status_check" });
      }
      await insertJob(messageId);
      await pool.query(
        "UPDATE public.jobs SET status = 'processando', attempts = attempts + 1, locked_at = now() WHERE message_id = $1;", [messageId]);
      await rejects(pool.query("UPDATE public.jobs SET status = 'pendente' WHERE message_id = $1;", [messageId]),
        { code: "23514", constraint: "jobs_locked_at_status_check" });
      const scheduledAt = new Date("2030-01-01T12:00:00Z");
      await pool.query(
        "UPDATE public.jobs SET status = 'pendente', locked_at = NULL, run_at = $2, last_error = 'falha_sintetica' WHERE message_id = $1;",
        [messageId, scheduledAt]);
      const job = await pool.query<{ status: string; attempts: number; run_at: Date; locked_at: null; last_error: string }>(
        "SELECT status, attempts, run_at, locked_at, last_error FROM public.jobs WHERE message_id = $1;", [messageId]);
      deepEqual(job.rows[0], { status: "pendente", attempts: 1, run_at: scheduledAt, locked_at: null, last_error: "falha_sintetica" });
    });

    await t.test("mantém um job por tipo e mensagem inclusive após finalizar", async () => {
      const messageId = await createMessage();
      await insertJob(messageId);
      await rejects(insertJob(messageId), { code: "23505", constraint: "jobs_type_message_id_key" });
      await pool.query("UPDATE public.jobs SET status = 'concluido' WHERE message_id = $1;", [messageId]);
      await rejects(insertJob(messageId), { code: "23505", constraint: "jobs_type_message_id_key" });
      await insertJob(messageId, "outro_tipo_sintetico");
      const jobs = await pool.query<{ type: string; status: string }>(
        "SELECT type, status FROM public.jobs WHERE message_id = $1 ORDER BY type;", [messageId]);
      deepEqual(jobs.rows, [
        { type: "outro_tipo_sintetico", status: "pendente" },
        { type: "processar_mensagem", status: "concluido" },
      ]);
    });

    await t.test("impede jobs duplicados em inserções concorrentes", async () => {
      const messageId = await createMessage();
      const results = await Promise.allSettled([insertJob(messageId), insertJob(messageId)]);
      equal(results.filter((result) => result.status === "fulfilled").length, 1);
      const failure = results.find((result) => result.status === "rejected");
      ok(failure?.status === "rejected");
      const reason: unknown = failure.reason;
      ok(reason !== null && typeof reason === "object" && "code" in reason && "constraint" in reason);
      equal(reason.code, "23505");
      equal(reason.constraint, "jobs_type_message_id_key");
      const count = await pool.query<{ count: number }>(
        "SELECT count(*)::integer AS count FROM public.jobs WHERE message_id = $1;", [messageId]);
      equal(count.rows[0]?.count, 1);
    });

    await t.test("não reaplica jobs registrados nem altera os jobs existentes", async () => {
      const before = await pool.query<{ count: number }>("SELECT count(*)::integer AS count FROM public.jobs;");
      ok((before.rows[0]?.count ?? 0) > 0);
      equal((await migrate("up")).length, 0);
      const after = await pool.query<{ count: number }>("SELECT count(*)::integer AS count FROM public.jobs;");
      equal(after.rows[0]?.count, before.rows[0]?.count);
    });

    await t.test("cria o índice de busca, reverte só jobs e preserva todas as dependências", async () => {
      const countsSql = "SELECT (SELECT count(*)::integer FROM public.contacts) AS contacts, (SELECT count(*)::integer FROM public.conversations) AS conversations, (SELECT count(*)::integer FROM public.messages) AS messages;";
      const before = await pool.query(countsSql);
      const index = await pool.query<{ indexdef: string }>(
        "SELECT indexdef FROM pg_indexes WHERE schemaname = 'public' AND indexname = 'jobs_status_run_at_idx';");
      ok(index.rows[0]);
      match(index.rows[0].indexdef, /\(status, run_at\)/);
      equal((await migrate("down")).length, 1);
      const objects = await pool.query<{ table_name: string | null; index_name: string | null }>(
        "SELECT to_regclass('public.jobs')::text AS table_name, to_regclass('public.jobs_status_run_at_idx')::text AS index_name;");
      deepEqual(objects.rows[0], { table_name: null, index_name: null });
      const after = await pool.query(countsSql);
      deepEqual(after.rows, before.rows);
      const history = await pool.query<{ name: string }>("SELECT name FROM public.pgmigrations ORDER BY id;");
      deepEqual(history.rows, dependencies.map((name) => ({ name })));
      equal((await migrate("up")).length, 1);
    });
  } finally {
    try {
      await pool.end();
      if (databaseCreated) {
        await admin.query(`DROP DATABASE "${temporaryDatabase}" WITH (FORCE);`);
      }
    } finally {
      await admin.end();
    }
  }
});
