import { deepEqual, equal, rejects } from "node:assert/strict";
import { test } from "node:test";
import type { JobType } from "./job-queue.js";
import type { JobRecovery, JobRecoveryOptions, JobRecoveryResult } from "./job-recovery.js";
import { recoverExpiredJobs } from "./recover-expired-jobs.js";

test("recuperação solicita o tipo suportado, prazo de dois minutos e lote de cem", async () => {
  let received: { type: JobType; options: JobRecoveryOptions } | undefined;
  const result: JobRecoveryResult = { requeued: 2, failed: 1 };
  const recovery: JobRecovery = {
    async recoverExpired(type, options) { received = { type, options }; return result; },
  };
  equal(await recoverExpiredJobs(recovery), result);
  deepEqual(received, { type: "processar_mensagem", options: { timeoutSeconds: 120, batchSize: 100 } });
});

test("recuperação sem reservas expiradas preserva o resultado vazio", async () => {
  const result: JobRecoveryResult = { requeued: 0, failed: 0 };
  const recovery: JobRecovery = { async recoverExpired() { return result; } };
  equal(await recoverExpiredJobs(recovery), result);
});

test("recuperação propaga indisponibilidade sem informar lote recuperado", async () => {
  const failure = new Error("Falha sintética na recuperação.");
  const recovery: JobRecovery = { async recoverExpired() { throw failure; } };
  await rejects(recoverExpiredJobs(recovery), (error: unknown) => error === failure);
});
