import type { JobType } from "./job-queue.js";

export type JobRecoveryOptions = {
  readonly timeoutSeconds: number;
  readonly batchSize: number;
};

export type JobRecoveryResult = {
  readonly requeued: number;
  readonly failed: number;
};

// Recupera um lote limitado de reservas expiradas pelo relógio da persistência.
// Preserva attempts: só uma nova reserva incrementa o contador. Com saldo,
// disponibiliza o mesmo job imediatamente; sem saldo, registra falha final.
// Não disputa linhas já bloqueadas e não altera reservas ainda válidas.
export interface JobRecovery {
  recoverExpired(type: JobType, options: JobRecoveryOptions): Promise<JobRecoveryResult>;
}
