import type { JobAttempt, JobFailureKind, JobFailureResult, JobLifecycle } from "./job-lifecycle.js";
import { decideJobFailure } from "./retry-policy.js";

export async function failJob(
  attempt: JobAttempt,
  kind: JobFailureKind,
  lifecycle: JobLifecycle,
): Promise<JobFailureResult> {
  return lifecycle.fail(attempt, decideJobFailure(kind, attempt.attempts));
}
