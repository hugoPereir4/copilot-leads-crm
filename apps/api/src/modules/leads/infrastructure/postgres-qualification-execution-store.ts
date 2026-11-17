import type { Pool, PoolClient } from "pg";
import type { LeadQualification, QualificationSource } from "@copilot-leads/shared";
import type { QualificationExecutionStore, QualificationReservation, QualificationWork } from "../application/qualification-execution-store.js";
import { qualificationResultSchema, type QualificationFailureCode } from "../contracts/qualification.js";

async function lockWork(client: PoolClient, { job, context }: QualificationWork) {
  const current = (await client.query<{ status: string; attempts: number; type: string; message_id: string }>(
    "SELECT status, attempts, type, message_id FROM public.jobs WHERE id = $1 FOR UPDATE;", [job.id])).rows[0];
  if (!current || current.status !== "processando" || current.attempts !== job.attempts || current.type !== "processar_mensagem"
    || current.message_id !== context.message.id) return undefined;
  const conversation = (await client.query<{ id: string; status: string; contact_id: string }>(
    "SELECT id, status, contact_id FROM public.conversations WHERE id = $1 FOR UPDATE;", [context.conversation.id])).rows[0];
  const message = (await client.query<{ conversation_id: string; provider: string; direction: string; sender_type: string; kind: string; body: string | null }>(
    "SELECT conversation_id, provider, direction, sender_type, kind, body FROM public.messages WHERE id = $1 FOR SHARE;", [context.message.id])).rows[0];
  const eligible = !!conversation && conversation.contact_id === context.contact.id && !!message
    && message.conversation_id === conversation.id && message.provider === "simulador" && message.direction === "entrada"
    && message.sender_type === "contato" && message.kind === "texto" && !!message.body?.trim() && message.body === context.message.body;
  return { conversation, eligible };
}
const completeJob = (client: PoolClient, work: QualificationWork) => client.query(`UPDATE public.jobs
  SET status = 'concluido', locked_at = NULL, last_error = NULL WHERE id = $1 AND status = 'processando' AND attempts = $2;`, [work.job.id, work.job.attempts]);
type Lead = { id: string; stage: string; needs_review: boolean; summary: string | null; qualification: LeadQualification | null };
type Run = { status: string; source: QualificationSource; reserved_attempt: number };

export class PostgresQualificationExecutionStore implements QualificationExecutionStore {
  constructor(private readonly pool: Pool) {}

  private async transaction<T>(action: (client: PoolClient) => Promise<T>) {
    const client = await this.pool.connect(); let discard = false;
    try { await client.query("BEGIN ISOLATION LEVEL READ COMMITTED;"); const result = await action(client); await client.query("COMMIT;"); return result; }
    catch (error) { try { await client.query("ROLLBACK;"); } catch { discard = true; } throw error; }
    finally { client.release(discard); }
  }
  async begin(work: QualificationWork, source: QualificationSource): Promise<QualificationReservation> {
    return this.transaction(async (client) => {
      const locked = await lockWork(client, work);
      if (!locked) return { status: "ignorada" };
      const lead = (await client.query<Lead>("SELECT id, stage, needs_review, summary, qualification FROM public.leads WHERE conversation_id = $1 FOR UPDATE;", [work.context.conversation.id])).rows[0];
      if (!locked.eligible || !["aguardando_menu", "aguardando_detalhes"].includes(locked.conversation!.status)
        || (lead && !["novo", "qualificado"].includes(lead.stage))) {
        await client.query(`UPDATE public.qualification_runs SET status = 'descartada', error_code = 'estado_humano', finished_at = CURRENT_TIMESTAMP
          WHERE message_id = $1 AND status = 'processando';`, [work.context.message.id]);
        await completeJob(client, work); return { status: "ignorada" };
      }
      const existing = (await client.query<Run>("SELECT status, source, reserved_attempt FROM public.qualification_runs WHERE message_id = $1 FOR UPDATE;", [work.context.message.id])).rows[0];
      if (existing && existing.status !== "processando") { await completeJob(client, work); return { status: "ignorada" }; }
      if (existing) {
        await client.query("UPDATE public.qualification_runs SET reserved_attempt = $2 WHERE message_id = $1;", [work.context.message.id, work.job.attempts]);
        return { status: "interrompida", source: existing.source, previousMessages: [] };
      }
      // Lead visível durante a chamada, para permitir assunção humana imediata.
      // Sem sinalizar revisão inexistente; o run expõe o estado processando.
      await client.query(`INSERT INTO public.leads (conversation_id, contact_id) VALUES ($1, $2)
        ON CONFLICT ON CONSTRAINT leads_conversation_id_key DO NOTHING;`, [work.context.conversation.id, work.context.contact.id]);
      await client.query(`INSERT INTO public.qualification_runs (message_id, conversation_id, job_id, reserved_attempt, source)
        VALUES ($1, $2, $3, $4, $5);`, [work.context.message.id, work.context.conversation.id, work.job.id, work.job.attempts, source]);
      const pending = await client.query("SELECT id FROM public.response_plans WHERE conversation_id = $1 AND status = 'pendente';", [work.context.conversation.id]);
      if (pending.rowCount) return { status: "interrompida", source, previousMessages: [] };
      const messages = await client.query<{ body: string }>(`SELECT LEFT(body, 20000) AS body FROM public.messages
        WHERE conversation_id = $1 AND id <> $2 AND direction = 'entrada' AND sender_type = 'contato'
          AND kind = 'texto' AND body IS NOT NULL AND btrim(body) <> ''
          AND (created_at, id) < (SELECT created_at, id FROM public.messages WHERE id = $2)
        ORDER BY created_at DESC, id DESC LIMIT 10;`, [work.context.conversation.id, work.context.message.id]);
      return { status: "reservada", source, previousMessages: messages.rows.toReversed().map((row) => row.body) };
    });
  }
  async finish(work: QualificationWork, input: LeadQualification, errorCode: QualificationFailureCode | null) {
    const result = qualificationResultSchema.parse(input);
    await this.transaction(async (client) => {
      const locked = await lockWork(client, work); if (!locked) return;
      const lead = (await client.query<Lead>("SELECT id, stage, needs_review, summary, qualification FROM public.leads WHERE conversation_id = $1 FOR UPDATE;", [work.context.conversation.id])).rows[0];
      const run = (await client.query<Run>("SELECT status, source, reserved_attempt FROM public.qualification_runs WHERE message_id = $1 FOR UPDATE;", [work.context.message.id])).rows[0];
      if (!run || run.status !== "processando" || run.reserved_attempt !== work.job.attempts || run.source !== result.source) return;
      if (!locked.eligible || !lead || !["novo", "qualificado"].includes(lead.stage)
        || !["aguardando_menu", "aguardando_detalhes"].includes(locked.conversation!.status)) {
        await client.query(`UPDATE public.qualification_runs SET status = 'descartada', error_code = 'estado_humano', finished_at = CURRENT_TIMESTAMP
          WHERE message_id = $1;`, [work.context.message.id]);
        await completeJob(client, work); return;
      }
      const previous = lead.qualification;
      const qualification: LeadQualification = { ...result, intent: result.intent ?? previous?.intent ?? null,
        serviceId: result.serviceId ?? previous?.serviceId ?? null, serviceName: result.serviceName ?? previous?.serviceName ?? null,
        period: result.period ?? previous?.period ?? null, summary: result.summary ?? lead.summary,
        needsReview: lead.needs_review || result.needsReview };
      await client.query(`UPDATE public.response_blocks SET status = 'cancelado' WHERE status = 'pendente'
        AND plan_id IN (SELECT id FROM public.response_plans WHERE conversation_id = $1 AND status = 'pendente');`, [work.context.conversation.id]);
      await client.query(`UPDATE public.response_plans SET status = 'cancelado', finished_at = CURRENT_TIMESTAMP
        WHERE conversation_id = $1 AND status = 'pendente';`, [work.context.conversation.id]);
      await client.query(`UPDATE public.leads SET stage = CASE WHEN stage = 'qualificado' OR $2 = 'qualificado' THEN 'qualificado' ELSE 'novo' END,
        needs_review = $3, summary = $4, qualification = $5::jsonb, updated_at = CURRENT_TIMESTAMP WHERE id = $1;`,
        [lead.id, result.status, qualification.needsReview, qualification.summary, JSON.stringify(qualification)]);
      await client.query("UPDATE public.conversations SET status = 'aguardando_humano' WHERE id = $1;", [work.context.conversation.id]);
      await client.query(`UPDATE public.qualification_runs SET status = 'concluida', result = $2::jsonb,
        error_code = $3, finished_at = CURRENT_TIMESTAMP WHERE message_id = $1;`, [work.context.message.id, JSON.stringify(qualification), errorCode]);
      await completeJob(client, work);
    });
  }
}
