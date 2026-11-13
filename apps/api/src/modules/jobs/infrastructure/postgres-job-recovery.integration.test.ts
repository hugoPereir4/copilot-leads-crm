import { deepEqual, equal, ok, rejects } from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { runner } from "node-pg-migrate";
import { Client, Pool } from "pg";
import { readDatabaseConfig } from "../../../config/database.js";
import { createDatabasePool } from "../../../infrastructure/database/pool.js";
import { claimNextJob } from "../application/claim-next-job.js";
import { completeJob } from "../application/complete-job.js";
import { failJob } from "../application/fail-job.js";
import { recoverExpiredJobs } from "../application/recover-expired-jobs.js";
import { PostgresJobQueue } from "./postgres-job-queue.js";

type JobRow = {
  id: string; type: string; message_id: string; status: string;
  attempts: number; max_attempts: number; run_at: Date; locked_at: Date | null;
  last_error: string | null; created_at: Date;
};
type JobOptions = {
  status?: "pendente" | "processando" | "concluido" | "falhou";
  type?: string; attempts?: number; maxAttempts?: number; ageSeconds?: number;
};

test("recuperação de reservas expiradas em banco descartável", { timeout: 60000 }, async (t) => {
  const config = readDatabaseConfig(process.env);
  if (!["127.0.0.1", "localhost", "::1"].includes(config.host)) {
    throw new Error("O teste de integração exige um PostgreSQL local.");
  }
  const temporaryDatabase = `copilot_job_recovery_test_${randomUUID().replaceAll("-", "")}`;
  const admin = new Client({ ...config, connectionTimeoutMillis: 5000 });
  const testConfig = { ...config, database: temporaryDatabase };
  const pool = createDatabasePool(testConfig);
  const queue = new PostgresJobQueue(pool);
  let databaseCreated = false;
  let phoneSequence = 0;

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
       VALUES ($1, 'simulador', $2, 'entrada', 'contato', 'texto', 'Mensagem sintética de recuperação') RETURNING id;`,
      [conversation.rows[0].id, randomUUID()]);
    ok(message.rows[0]);
    const result = await pool.query<JobRow>(`
      INSERT INTO public.jobs (type, message_id, status, attempts, max_attempts, run_at, locked_at, last_error)
      VALUES ($1, $2, $3, $4, $5, '2020-01-01T00:00:00Z',
        CASE WHEN $3 = 'processando' THEN CURRENT_TIMESTAMP - $6::double precision * INTERVAL '1 second' ELSE NULL END,
        'erro_sintetico_anterior') RETURNING *;
    `, [options.type ?? "processar_mensagem", message.rows[0].id, options.status ?? "processando",
      options.attempts ?? 1, options.maxAttempts ?? 3, options.ageSeconds ?? 240]);
    ok(result.rows[0]);
    return result.rows[0];
  }
  async function readJob(id: string) {
    const result = await pool.query<JobRow>("SELECT * FROM public.jobs WHERE id = $1;", [id]);
    ok(result.rows[0]);
    return result.rows[0];
  }
  async function snapshot() {
    return (await pool.query<JobRow>("SELECT * FROM public.jobs ORDER BY id;")).rows;
  }
  async function databaseTime() {
    const result = await pool.query<{ now: Date }>("SELECT CURRENT_TIMESTAMP AS now;");
    ok(result.rows[0]);
    return result.rows[0].now.getTime();
  }
  t.beforeEach(async () => {
    // Exclusivamente no banco descartável criado e possuído por esta suíte.
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

    await t.test("fila vazia retorna contagens zero", async () => {
      deepEqual(await recoverExpiredJobs(queue), { requeued: 0, failed: 0 });
    });

    await t.test("recupera expirados com saldo e encerra os esgotados sem alterar contador ou vínculos", async () => {
      const retryable = await createJob({ attempts: 1, maxAttempts: 2 });
      const exhausted = await createJob({ attempts: 1, maxAttempts: 1 });
      const started = await databaseTime();
      deepEqual(await recoverExpiredJobs(queue), { requeued: 1, failed: 1 });
      const finished = await databaseTime();
      const requeued = await readJob(retryable.id);
      ok(requeued.run_at.getTime() >= started && requeued.run_at.getTime() <= finished);
      deepEqual(requeued, { ...retryable, status: "pendente", locked_at: null,
        last_error: "processing_reservation_expired", run_at: requeued.run_at });
      deepEqual(await readJob(exhausted.id), { ...exhausted, status: "falhou", locked_at: null,
        last_error: "processing_reservation_expired" });
      equal((await snapshot()).length, 2);
      const next = await claimNextJob(queue);
      ok(next);
      equal(next.id, retryable.id);
      equal(next.attempts, 2);
      equal(await claimNextJob(queue), undefined);
    });

    await t.test("ignora reservas recentes, futuras, outros tipos e estados", async () => {
      await createJob({ ageSeconds: 60 });
      await createJob({ ageSeconds: -120 });
      await createJob({ type: "outro_tipo_sintetico" });
      for (const status of ["pendente", "concluido", "falhou"] as const) {
        await createJob({ status });
      }
      const before = await snapshot();
      deepEqual(await recoverExpiredJobs(queue), { requeued: 0, failed: 0 });
      deepEqual(await snapshot(), before);
    });

    await t.test("prazo usa locked_at e o relógio do banco, sem depender de run_at", async () => {
      const expired = await createJob({ ageSeconds: 121 });
      const recent = await createJob({ ageSeconds: 0 });
      await pool.query("UPDATE public.jobs SET run_at = CURRENT_TIMESTAMP + INTERVAL '1 day' WHERE id = $1;", [expired.id]);
      const beforeRecent = await readJob(recent.id);
      deepEqual(await recoverExpiredJobs(queue), { requeued: 1, failed: 0 });
      equal((await readJob(expired.id)).status, "pendente");
      deepEqual(await readJob(recent.id), beforeRecent);
    });

    await t.test("fronteira exata de cento e vinte segundos é inclusiva com relógio transacional fixo", async () => {
      const cases = [
        { job: await createJob(), offsetMicroseconds: -1, expectedStatus: "pendente" },
        { job: await createJob(), offsetMicroseconds: 0, expectedStatus: "pendente" },
        { job: await createJob(), offsetMicroseconds: 1, expectedStatus: "processando" },
      ] as const;
      // Pool exclusivo deste cenário, com uma só conexão e chamadas sequenciais:
      // BEGIN, fixtures e SQL real da fila compartilham a mesma transação.
      const boundaryPool = new Pool({
        ...testConfig, max: 1, connectionTimeoutMillis: 5000, statement_timeout: 5000,
      });
      const boundaryQueue = new PostgresJobQueue(boundaryPool);
      try {
        await boundaryPool.query("BEGIN;");
        for (const fixture of cases) {
          await boundaryPool.query(`
            UPDATE public.jobs
            SET locked_at = CURRENT_TIMESTAMP - INTERVAL '120 seconds'
              + $2::double precision * INTERVAL '1 microsecond'
            WHERE id = $1;
          `, [fixture.job.id, fixture.offsetMicroseconds]);
          // Compara no PostgreSQL, preservando a precisão de microssegundos
          // que seria perdida se o timestamp fosse convertido em Date no Node.
          const position = await boundaryPool.query<{ at_boundary: boolean; before_expiry: boolean }>(`
            SELECT locked_at = CURRENT_TIMESTAMP - INTERVAL '120 seconds' AS at_boundary,
                   locked_at > CURRENT_TIMESTAMP - INTERVAL '120 seconds' AS before_expiry
            FROM public.jobs WHERE id = $1;
          `, [fixture.job.id]);
          ok(position.rows[0]);
          equal(position.rows[0].at_boundary, fixture.offsetMicroseconds === 0);
          equal(position.rows[0].before_expiry, fixture.offsetMicroseconds > 0);
        }
        deepEqual(await recoverExpiredJobs(boundaryQueue), { requeued: 2, failed: 0 });
        for (const fixture of cases) {
          const result = await boundaryPool.query<JobRow>("SELECT * FROM public.jobs WHERE id = $1;", [fixture.job.id]);
          ok(result.rows[0]);
          equal(result.rows[0].status, fixture.expectedStatus);
          equal(result.rows[0].attempts, fixture.job.attempts);
        }
        // Mesmo após outras consultas, o caso a 1 µs do prazo continua válido:
        // CURRENT_TIMESTAMP não avança dentro desta transação.
        deepEqual(await recoverExpiredJobs(boundaryQueue), { requeued: 0, failed: 0 });
      } finally {
        try { await boundaryPool.query("ROLLBACK;"); } finally { await boundaryPool.end(); }
      }
    });

    await t.test("repetir a recuperação não reaplica mudanças", async () => {
      await createJob();
      await createJob({ attempts: 3 });
      deepEqual(await recoverExpiredJobs(queue), { requeued: 1, failed: 1 });
      const before = await snapshot();
      deepEqual(await recoverExpiredJobs(queue), { requeued: 0, failed: 0 });
      deepEqual(await snapshot(), before);
    });

    await t.test("limita o lote e ordena por locked_at, created_at e id", async () => {
      const oldest = await createJob();
      const earlierCreation = await createJob();
      const tied = [await createJob(), await createJob()].sort((a, b) => a.id.localeCompare(b.id));
      await pool.query("UPDATE public.jobs SET locked_at = '2019-01-01T00:00:00Z', created_at = '2019-01-01T00:00:00Z';");
      await pool.query("UPDATE public.jobs SET locked_at = '2018-01-01T00:00:00Z' WHERE id = $1;", [oldest.id]);
      await pool.query("UPDATE public.jobs SET created_at = '2018-01-01T00:00:00Z' WHERE id = $1;", [earlierCreation.id]);
      for (const expected of [oldest, earlierCreation, ...tied]) {
        deepEqual(await queue.recoverExpired("processar_mensagem", { timeoutSeconds: 120, batchSize: 1 }),
          { requeued: 1, failed: 0 });
        equal((await readJob(expected.id)).status, "pendente");
      }
      deepEqual(await recoverExpiredJobs(queue), { requeued: 0, failed: 0 });
    });

    await t.test("lote padrão recupera cem de cento e um jobs sem modificar tentativas", async () => {
      for (let index = 0; index < 101; index++) {
        await createJob({ attempts: 1 + index % 2 });
      }
      const before = await snapshot();
      equal(before.length, 101);
      const originalCounters = before.map(({ id, attempts }) => ({ id, attempts }));
      deepEqual(await recoverExpiredJobs(queue), { requeued: 100, failed: 0 });
      const firstBatch = await snapshot();
      equal(firstBatch.filter((job) => job.status === "pendente").length, 100);
      const remaining = firstBatch.filter((job) => job.status === "processando");
      equal(remaining.length, 1);
      const [remainingJob] = remaining;
      ok(remainingJob);
      deepEqual(remainingJob, before.find((job) => job.id === remainingJob.id));
      deepEqual(firstBatch.map(({ id, attempts }) => ({ id, attempts })), originalCounters);

      deepEqual(await recoverExpiredJobs(queue), { requeued: 1, failed: 0 });
      const secondBatch = await snapshot();
      equal(secondBatch.length, 101);
      ok(secondBatch.every((job) => job.status === "pendente" && job.locked_at === null
        && job.last_error === "processing_reservation_expired"));
      deepEqual(secondBatch.map(({ id, attempts }) => ({ id, attempts })), originalCounters);
    });

    await t.test("opções inválidas falham antes do SQL e preservam o estado persistido", async () => {
      await createJob();
      const before = await snapshot();
      const invalidNumbers = [0, -1, 1.5, NaN, Infinity, -Infinity, Number.MAX_SAFE_INTEGER + 1];
      const options = [
        ...invalidNumbers.map((timeoutSeconds) => ({ timeoutSeconds, batchSize: 100 })),
        ...[...invalidNumbers, 1001].map((batchSize) => ({ timeoutSeconds: 120, batchSize })),
      ];
      for (const option of options) {
        const query = t.mock.method(pool, "query");
        try {
          await rejects(queue.recoverExpired("processar_mensagem", option), RangeError);
          equal(query.mock.callCount(), 0);
        } finally {
          query.mock.restore();
        }
        deepEqual(await snapshot(), before);
      }
    });

    await t.test("duas recuperações concorrentes não contabilizam o mesmo job duas vezes", async () => {
      const fixture = await createJob();
      const results = await Promise.all([recoverExpiredJobs(queue), recoverExpiredJobs(queue)]);
      equal(results.reduce((sum, result) => sum + result.requeued, 0), 1);
      equal(results.reduce((sum, result) => sum + result.failed, 0), 0);
      const stored = await readJob(fixture.id);
      equal(stored.status, "pendente");
      equal(stored.attempts, 1);
    });

    await t.test("recuperações concorrentes com lote unitário podem recuperar jobs distintos", async () => {
      await createJob();
      await createJob({ attempts: 3 });
      const recover = () => queue.recoverExpired("processar_mensagem", { timeoutSeconds: 120, batchSize: 1 });
      const results = await Promise.all([recover(), recover()]);
      equal(results.reduce((sum, result) => sum + result.requeued, 0), 1);
      equal(results.reduce((sum, result) => sum + result.failed, 0), 1);
      const stored = await snapshot();
      equal(stored.filter((job) => job.status === "pendente").length, 1);
      equal(stored.filter((job) => job.status === "falhou").length, 1);
    });

    await t.test("pula linha bloqueada e a recupera em chamada posterior após liberar", async () => {
      const locked = await createJob();
      const available = await createJob({ attempts: 3 });
      const blocker = await pool.connect();
      try {
        await blocker.query("BEGIN;");
        await blocker.query("SELECT id FROM public.jobs WHERE id = $1 FOR UPDATE;", [locked.id]);
        deepEqual(await recoverExpiredJobs(queue), { requeued: 0, failed: 1 });
        deepEqual(await recoverExpiredJobs(queue), { requeued: 0, failed: 0 });
        deepEqual(await readJob(locked.id), locked);
        equal((await readJob(available.id)).status, "falhou");
      } finally {
        try { await blocker.query("ROLLBACK;"); } finally { blocker.release(); }
      }
      deepEqual(await recoverExpiredJobs(queue), { requeued: 1, failed: 0 });
    });

    await t.test("tentativa recuperada não finaliza antes nem depois de uma nova reserva", async () => {
      const oldAttempt = await createJob();
      deepEqual(await recoverExpiredJobs(queue), { requeued: 1, failed: 0 });
      const requeued = await snapshot();
      deepEqual(await completeJob(oldAttempt, queue), { status: "reserva_desatualizada" });
      deepEqual(await failJob(oldAttempt, "transitoria", queue), { status: "reserva_desatualizada" });
      deepEqual(await failJob(oldAttempt, "definitiva", queue), { status: "reserva_desatualizada" });
      deepEqual(await snapshot(), requeued);
      const currentAttempt = await claimNextJob(queue);
      ok(currentAttempt);
      equal(currentAttempt.id, oldAttempt.id);
      equal(currentAttempt.attempts, oldAttempt.attempts + 1);
      const reserved = await snapshot();
      deepEqual(await completeJob(oldAttempt, queue), { status: "reserva_desatualizada" });
      deepEqual(await failJob(oldAttempt, "transitoria", queue), { status: "reserva_desatualizada" });
      deepEqual(await failJob(oldAttempt, "definitiva", queue), { status: "reserva_desatualizada" });
      deepEqual(await snapshot(), reserved);
      deepEqual(await recoverExpiredJobs(queue), { requeued: 0, failed: 0 });
      deepEqual(await completeJob(currentAttempt, queue), { status: "concluido" });
      equal((await snapshot()).length, 1);
    });

    await t.test("conclusão concorrente com recuperação preserva a transição vencedora", async () => {
      const job = await createJob();
      const [completion, recovery] = await Promise.all([completeJob(job, queue), recoverExpiredJobs(queue)]);
      const stored = await readJob(job.id);
      if (completion.status === "concluido") {
        deepEqual(recovery, { requeued: 0, failed: 0 });
        deepEqual(stored, { ...job, status: "concluido", locked_at: null, last_error: null });
      } else {
        deepEqual(recovery, { requeued: 1, failed: 0 });
        equal(stored.status, "pendente");
        equal(stored.last_error, "processing_reservation_expired");
        equal(stored.locked_at, null);
        equal(stored.attempts, job.attempts);
      }
    });

    await t.test("falha definitiva concorrente com recuperação preserva a transição vencedora", async () => {
      const job = await createJob();
      const [failure, recovery] = await Promise.all([failJob(job, "definitiva", queue), recoverExpiredJobs(queue)]);
      const stored = await readJob(job.id);
      if (failure.status === "falhou") {
        deepEqual(recovery, { requeued: 0, failed: 0 });
        deepEqual(stored, { ...job, status: "falhou", locked_at: null, last_error: "processing_permanent_failure" });
      } else {
        equal(failure.status, "reserva_desatualizada");
        deepEqual(recovery, { requeued: 1, failed: 0 });
        equal(stored.status, "pendente");
        equal(stored.last_error, "processing_reservation_expired");
        equal(stored.locked_at, null);
        equal(stored.attempts, job.attempts);
      }
    });

    await t.test("erro após UPDATE desfaz todo o lote e permite repetir a recuperação", async () => {
      await createJob();
      await createJob({ attempts: 3 });
      const before = await snapshot();
      await pool.query(`
        CREATE FUNCTION public.reject_test_job_recovery() RETURNS trigger LANGUAGE plpgsql AS $$
        BEGIN RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'falha_sintetica_na_recuperacao'; END;
        $$;
        CREATE TRIGGER reject_test_job_recovery AFTER UPDATE ON public.jobs
        FOR EACH ROW EXECUTE FUNCTION public.reject_test_job_recovery();
      `);
      try {
        await rejects(recoverExpiredJobs(queue), { code: "P0001" });
        deepEqual(await snapshot(), before);
      } finally {
        await pool.query("DROP TRIGGER reject_test_job_recovery ON public.jobs; DROP FUNCTION public.reject_test_job_recovery();");
      }
      deepEqual(await recoverExpiredJobs(queue), { requeued: 1, failed: 1 });
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
