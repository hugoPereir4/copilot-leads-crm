import { deepEqual, equal, ok, rejects } from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { runner } from "node-pg-migrate";
import { Client } from "pg";
import { readDatabaseConfig } from "../../../config/database.js";
import { createDatabasePool } from "../../../infrastructure/database/pool.js";
import { claimNextJob } from "../application/claim-next-job.js";
import { completeJob } from "../application/complete-job.js";
import { failJob } from "../application/fail-job.js";
import { PostgresJobQueue } from "./postgres-job-queue.js";

type JobRow = {
  id: string; type: string; message_id: string; status: string;
  attempts: number; max_attempts: number; run_at: Date; locked_at: Date | null;
  last_error: string | null; created_at: Date;
};
type JobOptions = {
  status?: "pendente" | "processando" | "concluido" | "falhou";
  attempts?: number; maxAttempts?: number; lastError?: string;
};

test("finalização e novas tentativas em banco descartável", { timeout: 60000 }, async (t) => {
  const config = readDatabaseConfig(process.env);
  if (!["127.0.0.1", "localhost", "::1"].includes(config.host)) {
    throw new Error("O teste de integração exige um PostgreSQL local.");
  }
  const temporaryDatabase = `copilot_job_lifecycle_test_${randomUUID().replaceAll("-", "")}`;
  const admin = new Client({ ...config, connectionTimeoutMillis: 5000 });
  const testConfig = { ...config, database: temporaryDatabase };
  const pool = createDatabasePool(testConfig);
  const queue = new PostgresJobQueue(pool);
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
       VALUES ($1, 'simulador', $2, 'entrada', 'contato', 'texto', 'Mensagem sintética do ciclo') RETURNING id;`,
      [conversation.rows[0].id, randomUUID()]);
    ok(message.rows[0]);
    const status = options.status ?? "pendente";
    const job = await pool.query<JobRow>(`
      INSERT INTO public.jobs (type, message_id, status, attempts, max_attempts, run_at, locked_at, last_error)
      VALUES ('processar_mensagem', $1, $2, $3, $4, $5, $6, $7) RETURNING *;
    `, [message.rows[0].id, status, options.attempts ?? 0, options.maxAttempts ?? 3,
      past, status === "processando" ? past : null, options.lastError ?? null]);
    ok(job.rows[0]);
    return job.rows[0];
  }
  async function reserve(options: JobOptions = {}) {
    const fixture = await createJob(options);
    const job = await claimNextJob(queue);
    ok(job);
    equal(job.id, fixture.id);
    return job;
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
  async function makeDue(id: string) {
    // Simula a chegada do horário somente neste banco, sem aguardar timers.
    await pool.query("UPDATE public.jobs SET run_at = CURRENT_TIMESTAMP - INTERVAL '1 second' WHERE id = $1;", [id]);
  }
  t.beforeEach(async () => {
    // O pool está conectado exclusivamente ao banco criado pela suíte.
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

    await t.test("conclusão limpa trava e erro sem alterar contador, vínculo ou agendamento", async () => {
      const job = await reserve({ attempts: 1, lastError: "erro_sintetico_anterior" });
      const before = await readJob(job.id);
      deepEqual(await completeJob(job, queue), { status: "concluido" });
      deepEqual(await readJob(job.id), { ...before, status: "concluido", locked_at: null, last_error: null });
      equal(await claimNextJob(queue), undefined);
    });

    await t.test("repetir uma conclusão não reaplica a alteração", async () => {
      const job = await reserve();
      await completeJob(job, queue);
      const before = await snapshot();
      deepEqual(await completeJob(job, queue), { status: "reserva_desatualizada" });
      deepEqual(await snapshot(), before);
    });

    await t.test("falha transitória reagenda cinco segundos pelo relógio do banco e preserva o job", async () => {
      const job = await reserve({ lastError: "erro_sintetico_anterior" });
      const before = await readJob(job.id);
      const started = await databaseTime();
      const result = await failJob(job, "transitoria", queue);
      const finished = await databaseTime();
      ok(result.status === "pendente");
      ok(result.runAt instanceof Date);
      ok(result.runAt.getTime() >= started + 5000 && result.runAt.getTime() <= finished + 5000);
      deepEqual(await readJob(job.id), { ...before, status: "pendente", locked_at: null,
        last_error: "processing_transient_failure", run_at: result.runAt });
      equal(await claimNextJob(queue), undefined);
    });

    await t.test("intervalos inválidos são rejeitados antes do SQL e preservam o job reservado", async () => {
      const job = await reserve({ lastError: "erro_sintetico_preservado" });
      const before = await snapshot();
      for (const delaySeconds of [0, -1, -0.5, NaN, Infinity, -Infinity, 60.1, 61, Number.MAX_VALUE]) {
        const query = t.mock.method(pool, "query");
        try {
          await rejects(queue.fail(job, { retry: true, delaySeconds }), {
            name: "RangeError",
            message: "O intervalo de reagendamento deve ser um número finito maior que zero e de no máximo 60 segundos.",
          });
          equal(query.mock.callCount(), 0);
        } finally {
          query.mock.restore();
        }
        deepEqual(await snapshot(), before);
      }
    });

    await t.test("reagendamento aceita intervalo positivo fracionário e o limite de sessenta segundos", async () => {
      for (const delaySeconds of [0.5, 60]) {
        const job = await createJob({ status: "processando", attempts: 1 });
        const before = await readJob(job.id);
        const started = await databaseTime();
        const result = await queue.fail(job, { retry: true, delaySeconds });
        const finished = await databaseTime();
        ok(result.status === "pendente");
        ok(result.runAt.getTime() >= started + delaySeconds * 1000
          && result.runAt.getTime() <= finished + delaySeconds * 1000);
        deepEqual(await readJob(job.id), { ...before, status: "pendente", locked_at: null,
          last_error: "processing_transient_failure", run_at: result.runAt });
      }
    });

    await t.test("segunda tentativa transitória usa espera de dez segundos", async () => {
      const job = await reserve({ attempts: 1 });
      equal(job.attempts, 2);
      const started = await databaseTime();
      const result = await failJob(job, "transitoria", queue);
      const finished = await databaseTime();
      ok(result.status === "pendente");
      ok(result.runAt.getTime() >= started + 10000 && result.runAt.getTime() <= finished + 10000);
      equal((await readJob(job.id)).attempts, 2);
    });

    await t.test("falha transitória no limite encerra o job respeitando máximo diferente do padrão", async () => {
      const job = await reserve({ maxAttempts: 1 });
      const before = await readJob(job.id);
      deepEqual(await failJob(job, "transitoria", queue), { status: "falhou" });
      deepEqual(await readJob(job.id), { ...before, status: "falhou", locked_at: null,
        last_error: "processing_transient_failure" });
      equal(await claimNextJob(queue), undefined);
    });

    await t.test("falha definitiva encerra antes do limite sem reagendar", async () => {
      const job = await reserve();
      const before = await readJob(job.id);
      deepEqual(await failJob(job, "definitiva", queue), { status: "falhou" });
      deepEqual(await readJob(job.id), { ...before, status: "falhou", locked_at: null,
        last_error: "processing_permanent_failure" });
    });

    await t.test("reagendamento confere o limite atual no banco em vez do snapshot da reserva", async () => {
      const job = await reserve();
      equal(job.maxAttempts, 3);
      await pool.query("UPDATE public.jobs SET max_attempts = attempts WHERE id = $1;", [job.id]);
      deepEqual(await failJob(job, "transitoria", queue), { status: "falhou" });
      const stored = await readJob(job.id);
      equal(stored.attempts, 1);
      equal(stored.max_attempts, 1);
    });

    await t.test("ID inexistente ou contador diferente não conclui nem registra falha", async () => {
      const job = await reserve({ attempts: 1 });
      const before = await snapshot();
      for (const attempt of [
        { id: randomUUID(), attempts: 1 },
        { id: job.id, attempts: job.attempts - 1 },
        { id: job.id, attempts: job.attempts + 1 },
      ]) {
        deepEqual(await completeJob(attempt, queue), { status: "reserva_desatualizada" });
        deepEqual(await failJob(attempt, "transitoria", queue), { status: "reserva_desatualizada" });
      }
      deepEqual(await snapshot(), before);
    });

    await t.test("pendentes, concluídos e falhos não são sobrescritos pela finalização", async () => {
      const fixtures = [];
      for (const status of ["pendente", "concluido", "falhou"] as const) {
        fixtures.push(await createJob({ status, attempts: 1, lastError: "erro_sintetico_preservado" }));
      }
      const before = await snapshot();
      for (const job of fixtures) {
        deepEqual(await completeJob(job, queue), { status: "reserva_desatualizada" });
        deepEqual(await failJob(job, "transitoria", queue), { status: "reserva_desatualizada" });
        deepEqual(await failJob(job, "definitiva", queue), { status: "reserva_desatualizada" });
      }
      deepEqual(await snapshot(), before);
    });

    await t.test("tentativa antiga não altera uma reserva posterior do mesmo job", async () => {
      const oldAttempt = await reserve();
      await failJob(oldAttempt, "transitoria", queue);
      await makeDue(oldAttempt.id);
      const currentAttempt = await claimNextJob(queue);
      ok(currentAttempt);
      equal(currentAttempt.id, oldAttempt.id);
      equal(currentAttempt.attempts, 2);
      const before = await snapshot();
      deepEqual(await completeJob(oldAttempt, queue), { status: "reserva_desatualizada" });
      deepEqual(await failJob(oldAttempt, "transitoria", queue), { status: "reserva_desatualizada" });
      deepEqual(await failJob(oldAttempt, "definitiva", queue), { status: "reserva_desatualizada" });
      deepEqual(await snapshot(), before);
      deepEqual(await completeJob(currentAttempt, queue), { status: "concluido" });
    });

    await t.test("ciclo completo usa três tentativas totais no mesmo registro", async () => {
      let job = await reserve();
      const id = job.id;
      const messageId = job.messageId;
      for (const attempts of [1, 2, 3]) {
        equal(job.attempts, attempts);
        equal(job.id, id);
        equal(job.messageId, messageId);
        const result = await failJob(job, "transitoria", queue);
        equal(result.status, attempts < 3 ? "pendente" : "falhou");
        equal((await readJob(id)).attempts, attempts);
        if (attempts < 3) {
          await makeDue(id);
          const next = await claimNextJob(queue);
          ok(next);
          job = next;
        }
      }
      equal((await snapshot()).length, 1);
      equal(await claimNextJob(queue), undefined);
    });

    await t.test("duas conclusões concorrentes confirmam somente uma alteração", async () => {
      const job = await reserve();
      const results = await Promise.all([completeJob(job, queue), completeJob(job, queue)]);
      equal(results.filter((result) => result.status === "concluido").length, 1);
      equal(results.filter((result) => result.status === "reserva_desatualizada").length, 1);
      equal((await readJob(job.id)).attempts, 1);
    });

    await t.test("conclusão e reagendamento concorrentes não sobrescrevem o vencedor", async () => {
      const job = await reserve();
      const results = await Promise.all([completeJob(job, queue), failJob(job, "transitoria", queue)]);
      equal(results.filter((result) => result.status === "reserva_desatualizada").length, 1);
      const winner = results.find((result) => result.status !== "reserva_desatualizada");
      ok(winner);
      const stored = await readJob(job.id);
      equal(stored.status, winner.status);
      equal(stored.locked_at, null);
      equal(stored.attempts, 1);
      if (winner.status === "pendente") equal(stored.run_at.getTime(), winner.runAt.getTime());
      equal(stored.last_error, winner.status === "concluido" ? null : "processing_transient_failure");
    });

    await t.test("falhas transitória e definitiva concorrentes aplicam somente uma decisão", async () => {
      const job = await reserve();
      const results = await Promise.all([failJob(job, "transitoria", queue), failJob(job, "definitiva", queue)]);
      equal(results.filter((result) => result.status === "reserva_desatualizada").length, 1);
      const winner = results.find((result) => result.status !== "reserva_desatualizada");
      ok(winner);
      const stored = await readJob(job.id);
      equal(stored.status, winner.status);
      equal(stored.locked_at, null);
      equal(stored.attempts, 1);
      equal(stored.last_error, winner.status === "pendente" ? "processing_transient_failure" : "processing_permanent_failure");
    });

    await t.test("falha após UPDATE desfaz conclusão e falhas, permitindo repetir a operação", async () => {
      const first = await reserve();
      const second = await reserve();
      const third = await reserve();
      const before = await snapshot();
      // Trigger exclusivo deste banco descartável: erro depois da escrita.
      await pool.query(`
        CREATE FUNCTION public.reject_test_job_finish() RETURNS trigger LANGUAGE plpgsql AS $$
        BEGIN RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'falha_sintetica_na_finalizacao'; END;
        $$;
        CREATE TRIGGER reject_test_job_finish AFTER UPDATE ON public.jobs
        FOR EACH ROW EXECUTE FUNCTION public.reject_test_job_finish();
      `);
      try {
        await rejects(completeJob(first, queue), { code: "P0001" });
        await rejects(failJob(second, "transitoria", queue), { code: "P0001" });
        await rejects(failJob(third, "definitiva", queue), { code: "P0001" });
        deepEqual(await snapshot(), before);
      } finally {
        await pool.query("DROP TRIGGER reject_test_job_finish ON public.jobs; DROP FUNCTION public.reject_test_job_finish();");
      }
      deepEqual(await completeJob(first, queue), { status: "concluido" });
      equal((await failJob(second, "transitoria", queue)).status, "pendente");
      deepEqual(await failJob(third, "definitiva", queue), { status: "falhou" });
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
