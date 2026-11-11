import type { Pool } from "pg";
import type { ClaimedJob, JobQueue, JobType } from "../application/job-queue.js";

type ClaimedJobRow = {
  id: string;
  type: JobType;
  message_id: string;
  status: "processando";
  attempts: number;
  max_attempts: number;
  locked_at: Date;
};

export class PostgresJobQueue implements JobQueue {
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
}
