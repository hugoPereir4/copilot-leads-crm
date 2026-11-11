export type JobType = "processar_mensagem";

export type ClaimedJob = {
  readonly id: string;
  readonly type: JobType;
  readonly messageId: string;
  readonly status: "processando";
  readonly attempts: number;
  readonly maxAttempts: number;
  readonly lockedAt: Date;
};

// Porta da aplicação. Reserva no máximo um job pendente do tipo solicitado,
// com horário atingido e tentativas disponíveis. A reserva deve incrementar
// attempts, preencher lockedAt e mudar o estado atomicamente, sem duplicar
// a reserva em chamadas concorrentes. Ausência de trabalho não é uma falha.
export interface JobQueue {
  claimNext(type: JobType): Promise<ClaimedJob | undefined>;
}
