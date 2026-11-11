import { deepEqual, equal, ok, rejects } from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { runner } from "node-pg-migrate";
import { Client } from "pg";
import { readDatabaseConfig } from "../../../config/database.js";
import { createDatabasePool } from "../../../infrastructure/database/pool.js";
import { claimNextJob } from "../application/claim-next-job.js";
import { PostgresJobQueue } from "./postgres-job-queue.js";

type JobOptions = {
  id?: string;
  type?: string;
  status?: "pendente" | "processando" | "concluido" | "falhou";
  attempts?: number;
  maxAttempts?: number;
  runAt?: Date;
  createdAt?: Date;
  lastError?: string;
};

test("reivindicação de jobs em banco descartável", { timeout: 60000 }, async (t) => {
  const config = readDatabaseConfig(process.env);
  if (!["127.0.0.1", "localhost", "::1"].includes(config.host)) {
    throw new Error("O teste de integração exige um PostgreSQL local.");
  }
  const temporaryDatabase = `copilot_job_claim_test_${randomUUID().replaceAll("-", "")}`;
  const admin = new Client({ ...config, connectionTimeoutMillis: 5000 });
  const testConfig = { ...config, database: temporaryDatabase };
  const pool = createDatabasePool(testConfig);
  const queue = new PostgresJobQueue(pool);
  const claim = () => claimNextJob(queue);
  let databaseCreated = false;
  let phoneSequence = 0;
  const past = new Date("2020-01-01T00:00:00Z");

  async function createJob(options: JobOptions = {}) {
    const contact = await pool.query<{ id: string }>(
      "INSERT INTO public.contacts (phone) VALUES ($1) RETURNING id;",
      [`+1555${String(++phoneSequence).padStart(7, "0")}`]);
    ok(contact.rows[0]);
    const conversation = await pool.query<{ id: string }>(
      "INSERT INTO public.conversations (contact_id) VALUES ($1) RETURNING id;", [contact.rows[0].id]);
    ok(conversation.rows[0]);
    const message = await pool.query<{ id: string }>(
      `INSERT INTO public.messages (conversation_id, provider, external_id, direction, sender_type, kind, body)
       VALUES ($1, 'simulador', $2, 'entrada', 'contato', 'texto', 'Mensagem sintética da fila') RETURNING id;`,
      [conversation.rows[0].id, randomUUID()]);
    ok(message.rows[0]);
    const status = options.status ?? "pendente";
    const result = await pool.query<{ id: string; message_id: string }>(
      `INSERT INTO public.jobs (id, type, message_id, status, attempts, max_attempts, run_at, locked_at, last_error, created_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10) RETURNING id, message_id;`,
      [options.id ?? randomUUID(), options.type ?? "processar_mensagem", message.rows[0].id, status,
        options.attempts ?? 0, options.maxAttempts ?? 3, options.runAt ?? past,
        status === "processando" ? past : null, options.lastError ?? null, options.createdAt ?? past]);
    ok(result.rows[0]);
    return result.rows[0];
  }

  async function snapshot() {
    const result = await pool.query(
      "SELECT id, type, message_id, status, attempts, max_attempts, run_at, locked_at, last_error, created_at FROM public.jobs ORDER BY id;");
    return result.rows;
  }

  // A limpeza usa somente o pool conectado ao banco criado por esta suíte.
  t.beforeEach(async () => {
    await pool.query("TRUNCATE public.jobs, public.messages, public.conversations, public.contacts;");
  });

  try {
    await admin.connect();
    await admin.query(`CREATE DATABASE "${temporaryDatabase}" TEMPLATE template0;`);
    databaseCreated = true;
    const migrationClient = new Client({ ...testConfig, connectionTimeoutMillis: 5000 });
    try {
      await migrationClient.connect();
      await runner({
        dbClient: migrationClient,
        dir: fileURLToPath(new URL("../../../../migrations/", import.meta.url)),
        direction: "up", schema: "public", migrationsTable: "pgmigrations",
        checkOrder: true, singleTransaction: true,
        logger: { info: () => {}, warn: () => {}, error: () => {} },
      });
    } finally {
      await migrationClient.end();
    }

    await t.test("fila vazia retorna ausência de trabalho", async () => {
      equal(await claim(), undefined);
      deepEqual(await snapshot(), []);
    });

    await t.test("reserva atualiza estado, tentativa e data preservando o job e seu vínculo", async () => {
      const fixture = await createJob({ lastError: "falha_sintetica_anterior" });
      const [before] = await snapshot();
      const started = await pool.query<{ now: Date }>("SELECT CURRENT_TIMESTAMP AS now;");
      const job = await claim();
      const finished = await pool.query<{ now: Date }>("SELECT CURRENT_TIMESTAMP AS now;");
      ok(job);
      ok(started.rows[0] && finished.rows[0]);
      ok(job.lockedAt instanceof Date);
      ok(job.lockedAt >= started.rows[0].now && job.lockedAt <= finished.rows[0].now);
      deepEqual(job, { id: fixture.id, type: "processar_mensagem", messageId: fixture.message_id,
        status: "processando", attempts: 1, maxAttempts: 3, lockedAt: job.lockedAt });
      deepEqual(await snapshot(), [{ ...before, status: "processando", attempts: 1, locked_at: job.lockedAt }]);
    });

    await t.test("ignora horário futuro, tentativas esgotadas, outros estados e tipos não suportados", async () => {
      for (const options of [
        { runAt: new Date(Date.now() + 24 * 60 * 60 * 1000) },
        { attempts: 3, maxAttempts: 3 },
        { status: "processando" }, { status: "concluido" }, { status: "falhou" },
        { type: "tarefa_sintetica_nao_suportada" },
      ] satisfies JobOptions[]) await createJob(options);
      const before = await snapshot();
      equal(await claim(), undefined);
      deepEqual(await snapshot(), before);
    });

    await t.test("seleciona por run_at, created_at e id como desempate", async () => {
      const laterRun = await createJob({ runAt: new Date("2020-01-02T00:00:00Z") });
      const laterCreation = await createJob({ createdAt: new Date("2020-01-02T00:00:00Z") });
      const higherId = await createJob({ id: "00000000-0000-4000-8000-000000000002" });
      const lowerId = await createJob({ id: "00000000-0000-4000-8000-000000000001" });
      for (const fixture of [lowerId, higherId, laterCreation, laterRun]) {
        equal((await claim())?.id, fixture.id);
      }
      equal(await claim(), undefined);
    });

    await t.test("permite a última tentativa disponível sem ultrapassar o máximo", async () => {
      const fixture = await createJob({ attempts: 1, maxAttempts: 2 });
      const job = await claim();
      ok(job);
      equal(job.id, fixture.id);
      equal(job.attempts, 2);
      equal(job.maxAttempts, 2);
      equal(await claim(), undefined);
      equal((await snapshot()).length, 1);
    });

    await t.test("duas chamadas concorrentes reservam um job uma única vez", async () => {
      const fixture = await createJob();
      const results = await Promise.all([claim(), claim()]);
      equal(results.filter((job) => job !== undefined).length, 1);
      equal(results.find((job) => job !== undefined)?.id, fixture.id);
      const [stored] = await snapshot();
      equal(stored?.status, "processando");
      equal(stored?.attempts, 1);
    });

    await t.test("duas chamadas concorrentes podem reservar jobs distintos", async () => {
      const first = await createJob();
      const second = await createJob();
      const results = await Promise.all([claim(), claim()]);
      ok(results[0] && results[1]);
      deepEqual(new Set(results.map((job) => job?.id)), new Set([first.id, second.id]));
      for (const stored of await snapshot()) {
        equal(stored.status, "processando");
        equal(stored.attempts, 1);
      }
    });

    await t.test("pula linha bloqueada por outra transação e a disponibiliza após liberar", async () => {
      const first = await createJob();
      const second = await createJob({ runAt: new Date("2020-01-02T00:00:00Z") });
      const blocker = await pool.connect();
      try {
        await blocker.query("BEGIN;");
        await blocker.query("SELECT id FROM public.jobs WHERE id = $1 FOR UPDATE;", [first.id]);
        equal((await claim())?.id, second.id);
        equal(await claim(), undefined);
      } finally {
        try { await blocker.query("ROLLBACK;"); } finally { blocker.release(); }
      }
      const stored = (await snapshot()).find((job) => job.id === first.id);
      equal(stored?.status, "pendente");
      equal(stored?.attempts, 0);
      equal(stored?.locked_at, null);
      equal((await claim())?.id, first.id);
    });

    await t.test("falha após atualização desfaz a reserva e permite tentar novamente", async () => {
      const fixture = await createJob();
      const before = await snapshot();
      // O trigger existe somente neste banco descartável e falha depois do UPDATE.
      await pool.query(`
        CREATE FUNCTION public.reject_test_job_claim() RETURNS trigger LANGUAGE plpgsql AS $$
        BEGIN RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'falha_sintetica_na_reserva'; END;
        $$;
        CREATE TRIGGER reject_test_job_claim AFTER UPDATE ON public.jobs
        FOR EACH ROW EXECUTE FUNCTION public.reject_test_job_claim();
      `);
      try {
        await rejects(claim(), { code: "P0001" });
        deepEqual(await snapshot(), before);
      } finally {
        await pool.query("DROP TRIGGER reject_test_job_claim ON public.jobs; DROP FUNCTION public.reject_test_job_claim();");
      }
      const job = await claim();
      equal(job?.id, fixture.id);
      equal(job?.attempts, 1);
    });
  } finally {
    try {
      await pool.end();
      if (databaseCreated) await admin.query(`DROP DATABASE "${temporaryDatabase}" WITH (FORCE);`);
    } finally {
      await admin.end();
    }
  }
});
