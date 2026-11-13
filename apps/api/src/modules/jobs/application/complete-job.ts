import type { JobAttempt, JobCompletionResult, JobLifecycle } from "./job-lifecycle.js";

export async function completeJob(attempt: JobAttempt, lifecycle: JobLifecycle): Promise<JobCompletionResult> {
  return lifecycle.complete(attempt);
}
