import { deepEqual, equal, rejects } from "node:assert/strict";
import { test } from "node:test";
import { completeJob } from "./complete-job.js";
import { failJob } from "./fail-job.js";
import type { JobAttempt, JobCompletionResult, JobFailureDecision, JobFailureResult, JobLifecycle } from "./job-lifecycle.js";

const attempt: JobAttempt = { id: "job-sintetico", attempts: 1 };
const unexpected = async (): Promise<never> => { throw new Error("Operação não esperada no teste."); };
const unused: JobLifecycle = { complete: unexpected, fail: unexpected };

test("conclusão usa a tentativa recebida e preserva a confirmação da porta", async () => {
  let received: JobAttempt | undefined;
  const result: JobCompletionResult = { status: "concluido" };
  const lifecycle: JobLifecycle = { ...unused, async complete(input) { received = input; return result; } };
  equal(await completeJob(attempt, lifecycle), result);
  equal(received, attempt);
});

test("conclusão não informa sucesso quando a reserva está desatualizada", async () => {
  const result: JobCompletionResult = { status: "reserva_desatualizada" };
  const lifecycle: JobLifecycle = { ...unused, async complete() { return result; } };
  equal(await completeJob(attempt, lifecycle), result);
});

test("falha transitória solicita reagendamento e preserva o horário confirmado pela porta", async () => {
  let received: { attempt: JobAttempt; decision: JobFailureDecision } | undefined;
  const result: JobFailureResult = { status: "pendente", runAt: new Date("2026-11-11T12:00:05Z") };
  const lifecycle: JobLifecycle = {
    ...unused,
    async fail(input, decision) { received = { attempt: input, decision }; return result; },
  };
  equal(await failJob(attempt, "transitoria", lifecycle), result);
  deepEqual(received, { attempt, decision: { retry: true, delaySeconds: 5 } });
});

test("falha definitiva solicita encerramento sem espera", async () => {
  let received: JobFailureDecision | undefined;
  const lifecycle: JobLifecycle = {
    ...unused,
    async fail(_input, decision) { received = decision; return { status: "falhou" }; },
  };
  deepEqual(await failJob(attempt, "definitiva", lifecycle), { status: "falhou" });
  deepEqual(received, { retry: false });
});

test("falha transitória respeita a decisão da porta quando o limite persistido esgotou", async () => {
  const lifecycle: JobLifecycle = { ...unused, async fail() { return { status: "falhou" }; } };
  deepEqual(await failJob({ ...attempt, attempts: 3 }, "transitoria", lifecycle), { status: "falhou" });
});

test("falha preserva o resultado de reserva desatualizada", async () => {
  const lifecycle: JobLifecycle = { ...unused, async fail() { return { status: "reserva_desatualizada" }; } };
  deepEqual(await failJob(attempt, "transitoria", lifecycle), { status: "reserva_desatualizada" });
});

test("conclusão e falha propagam indisponibilidade sem informar sucesso ou reagendamento", async () => {
  const failure = new Error("Falha sintética de persistência.");
  const reject = async (): Promise<never> => { throw failure; };
  const lifecycle: JobLifecycle = { complete: reject, fail: reject };
  await rejects(completeJob(attempt, lifecycle), (error: unknown) => error === failure);
  await rejects(failJob(attempt, "transitoria", lifecycle), (error: unknown) => error === failure);
});
