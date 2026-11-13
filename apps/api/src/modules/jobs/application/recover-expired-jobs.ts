import type { JobRecovery, JobRecoveryResult } from "./job-recovery.js";

// Parâmetros técnicos iniciais. O futuro processador deverá ter tempo limite
// inferior ao prazo da reserva; esta entrega ainda não executa tarefas.
const reservationTimeoutSeconds = 120;
const recoveryBatchSize = 100;

export async function recoverExpiredJobs(recovery: JobRecovery): Promise<JobRecoveryResult> {
  return recovery.recoverExpired("processar_mensagem", {
    timeoutSeconds: reservationTimeoutSeconds,
    batchSize: recoveryBatchSize,
  });
}
