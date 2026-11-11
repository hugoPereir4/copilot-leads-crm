import type { ClaimedJob, JobQueue } from "./job-queue.js";

export async function claimNextJob(queue: JobQueue): Promise<ClaimedJob | undefined> {
  // Apenas esta tarefa integra o processamento previsto nesta entrega.
  return queue.claimNext("processar_mensagem");
}
