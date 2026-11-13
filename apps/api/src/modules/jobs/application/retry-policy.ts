import type { JobFailureDecision, JobFailureKind } from "./job-lifecycle.js";

const baseDelaySeconds = 5;
const maxDelaySeconds = 60;

export function decideJobFailure(kind: JobFailureKind, attempts: number): JobFailureDecision {
  if (!Number.isSafeInteger(attempts) || attempts < 1) {
    throw new RangeError("A tentativa deve ser um inteiro positivo.");
  }
  if (kind !== "transitoria") return { retry: false };
  return {
    retry: true,
    delaySeconds: Math.min(baseDelaySeconds * 2 ** (attempts - 1), maxDelaySeconds),
  };
}
