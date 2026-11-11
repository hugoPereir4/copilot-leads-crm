import { equal, rejects } from "node:assert/strict";
import { test } from "node:test";
import { claimNextJob } from "./claim-next-job.js";
import type { ClaimedJob, JobQueue, JobType } from "./job-queue.js";

test("reivindicação solicita o tipo suportado e preserva a reserva da porta", async () => {
  const job: ClaimedJob = {
    id: "job-sintetico", type: "processar_mensagem", messageId: "mensagem-sintetica",
    status: "processando", attempts: 2, maxAttempts: 3,
    lockedAt: new Date("2026-11-11T12:00:00Z"),
  };
  let requestedType: JobType | undefined;
  const queue: JobQueue = { async claimNext(type) { requestedType = type; return job; } };
  equal(await claimNextJob(queue), job);
  equal(requestedType, "processar_mensagem");
});

test("reivindicação retorna ausência de trabalho sem fabricar um job", async () => {
  const queue: JobQueue = { async claimNext() { return undefined; } };
  equal(await claimNextJob(queue), undefined);
});

test("reivindicação propaga falha da fila sem confundir com fila vazia", async () => {
  const failure = new Error("Falha sintética na fila.");
  const queue: JobQueue = { async claimNext() { throw failure; } };
  await rejects(claimNextJob(queue), (error: unknown) => error === failure);
});
