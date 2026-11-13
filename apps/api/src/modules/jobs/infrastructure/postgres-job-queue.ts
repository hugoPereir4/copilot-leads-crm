import type { Pool } from "pg";
import type { ClaimedJob, JobQueue, JobType } from "../application/job-queue.js";
import type { JobAttempt, JobCompletionResult, JobFailureDecision, JobFailureResult, JobLifecycle } from "../application/job-lifecycle.js";
import type { JobRecovery, JobRecoveryOptions, JobRecoveryResult } from "../application/job-recovery.js";

type ClaimedJobRow = {
  id: string;
  type: JobType;
  message_id: string;
  status: "processando";
  attempts: number;
  max_attempts: number;
  locked_at: Date;
};

export class PostgresJobQueue implements JobQueue, JobLifecycle, JobRecovery {
  constructor(private readonly pool: Pool) {}

  async claimNext(type: JobType): Promise<ClaimedJob | undefined> {
    // Uma única instrução: seleção e atualização compartilham a transação
    // implícita do PostgreSQL. O bloqueio termina antes de devolver a reserva.
    const result = await this.pool.query<ClaimedJobRow>(`
      WITH candidate AS (
        SELECT id FROM public.jobs
        WHERE type = $1 AND status = 'pendente'
          AND run_at <= CURRENT_TIMESTAMP AND attempts < max_attempts
        ORDER BY run_at, created_at, id
        LIMIT 1
        FOR UPDATE SKIP LOCKED
      )
      UPDATE public.jobs AS job
      SET status = 'processando', attempts = job.attempts + 1,
          locked_at = CURRENT_TIMESTAMP
      FROM candidate
      WHERE job.id = candidate.id
      RETURNING job.id, job.type, job.message_id, job.status,
                job.attempts, job.max_attempts, job.locked_at;
    `, [type]);
    const row = result.rows[0];
    if (row === undefined) return undefined;
    return {
      id: row.id,
      type: row.type,
      messageId: row.message_id,
      status: row.status,
      attempts: row.attempts,
      maxAttempts: row.max_attempts,
      lockedAt: row.locked_at,
    };
  }

  async recoverExpired(type: JobType, options: JobRecoveryOptions): Promise<JobRecoveryResult> {
    if (!Number.isSafeInteger(options.timeoutSeconds) || options.timeoutSeconds <= 0) {
      throw new RangeError("O prazo da reserva deve ser um inteiro positivo seguro em segundos.");
    }
    if (!Number.isSafeInteger(options.batchSize) || options.batchSize <= 0 || options.batchSize > 1000) {
      throw new RangeError("O tamanho do lote deve ser um inteiro entre 1 e 1000.");
    }
    // Seleção e atualização pertencem à mesma instrução. SKIP LOCKED evita
    // esperar por uma conclusão ou outra recuperação que já bloqueou a linha.
    const result = await this.pool.query<{ status: "pendente" | "falhou" }>(`
      WITH expired AS (
        SELECT id FROM public.jobs
        WHERE type = $1 AND status = 'processando'
          AND locked_at <= CURRENT_TIMESTAMP - $2::double precision * INTERVAL '1 second'
        ORDER BY locked_at, created_at, id
        LIMIT $3
        FOR UPDATE SKIP LOCKED
      )
      UPDATE public.jobs AS job
      SET status = CASE WHEN job.attempts < job.max_attempts THEN 'pendente' ELSE 'falhou' END,
          run_at = CASE WHEN job.attempts < job.max_attempts THEN CURRENT_TIMESTAMP ELSE job.run_at END,
          locked_at = NULL,
          last_error = 'processing_reservation_expired'
      FROM expired
      WHERE job.id = expired.id
      RETURNING job.status;
    `, [type, options.timeoutSeconds, options.batchSize]);
    return {
      requeued: result.rows.filter((row) => row.status === "pendente").length,
      failed: result.rows.filter((row) => row.status === "falhou").length,
    };
  }

  async complete(attempt: JobAttempt): Promise<JobCompletionResult> {
    const result = await this.pool.query(`
      UPDATE public.jobs SET status = 'concluido', locked_at = NULL, last_error = NULL
      WHERE id = $1 AND status = 'processando' AND attempts = $2 AND attempts > 0
      RETURNING id;
    `, [attempt.id, attempt.attempts]);
    return { status: result.rowCount === 1 ? "concluido" : "reserva_desatualizada" };
  }

  async fail(attempt: JobAttempt, decision: JobFailureDecision): Promise<JobFailureResult> {
    if (decision.retry && (
      !Number.isFinite(decision.delaySeconds) || decision.delaySeconds <= 0 || decision.delaySeconds > 60
    )) {
      throw new RangeError("O intervalo de reagendamento deve ser um número finito maior que zero e de no máximo 60 segundos.");
    }
    // O limite vem da linha atual. Nenhum contador é incrementado ou zerado.
    // Os códigos persistidos são constantes, sem texto recebido do chamador.
    const result = await this.pool.query<{ status: "pendente" | "falhou"; run_at: Date }>(`
      UPDATE public.jobs
      SET status = CASE WHEN $3::boolean AND attempts < max_attempts THEN 'pendente' ELSE 'falhou' END,
          run_at = CASE WHEN $3::boolean AND attempts < max_attempts
            THEN CURRENT_TIMESTAMP + $4::double precision * INTERVAL '1 second' ELSE run_at END,
          locked_at = NULL,
          last_error = CASE WHEN $3::boolean
            THEN 'processing_transient_failure' ELSE 'processing_permanent_failure' END
      WHERE id = $1 AND status = 'processando' AND attempts = $2 AND attempts > 0
      RETURNING status, run_at;
    `, [attempt.id, attempt.attempts, decision.retry, decision.retry ? decision.delaySeconds : 0]);
    const row = result.rows[0];
    if (row === undefined) return { status: "reserva_desatualizada" };
    return row.status === "pendente" ? { status: "pendente", runAt: row.run_at } : { status: "falhou" };
  }
}
