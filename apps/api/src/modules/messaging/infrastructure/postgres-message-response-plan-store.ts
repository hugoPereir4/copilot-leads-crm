import type { Pool, PoolClient } from "pg";
import { z } from "zod";
import type {
  MessageResponsePlanStore, ResponsePlanPreparation, ResponsePlanPreparationResult,
} from "../application/message-response-plan-store.js";
import { messageResponsePlanDraftSchema } from "../contracts/message-response-plan.js";

const preparationSchema = z.strictObject({
  attempt: z.object({ id: z.uuid(), attempts: z.number().int().positive().max(Number.MAX_SAFE_INTEGER) }),
  draft: messageResponsePlanDraftSchema,
});

async function prepareInTransaction(
  client: PoolClient, { attempt, draft }: ResponsePlanPreparation,
): Promise<ResponsePlanPreparationResult> {
  // Ordem dos bloqueios: job, conversa, mensagem. Não usar um snapshot anterior
  // ao bloqueio para autorizar a gravação, nem expirar a tentativa pelo relógio.
  const jobs = await client.query<{ message_id: string; type: string; status: string; attempts: number }>(`
    SELECT message_id, type, status, attempts FROM public.jobs WHERE id = $1 FOR UPDATE;
  `, [attempt.id]);
  const job = jobs.rows[0];
  if (job === undefined || job.status !== "processando" || job.attempts !== attempt.attempts) {
    return { status: "reserva_desatualizada" };
  }
  if (job.type !== "processar_mensagem" || job.message_id !== draft.messageId) {
    return { status: "contexto_desatualizado" };
  }
  const conversations = await client.query<{ status: string }>(`
    SELECT status FROM public.conversations WHERE id = $1 FOR UPDATE;
  `, [draft.conversationId]);
  const conversation = conversations.rows[0];
  if (conversation === undefined) return { status: "contexto_desatualizado" };

  // FOR SHARE também impede alteração dos campos não-chave da origem durante
  // a preparação. Dados da mensagem não são tomados como imutáveis pelo SQL.
  const messages = await client.query<{
    conversation_id: string; direction: string; sender_type: string; kind: string;
    body: string | null; created_at: Date;
  }>(`
    SELECT conversation_id, direction, sender_type, kind, body, created_at
    FROM public.messages WHERE id = $1 FOR SHARE;
  `, [draft.messageId]);
  const message = messages.rows[0];
  if (message === undefined || message.conversation_id !== draft.conversationId) {
    return { status: "contexto_desatualizado" };
  }

  // Outra preparação pode ter concluído enquanto esperávamos pela conversa.
  // Esta consulta separada enxerga seu commit em READ COMMITTED.
  const existing = await client.query<{ id: string; source_job_id: string; conversation_id: string }>(`
    SELECT id, source_job_id, conversation_id FROM public.response_plans WHERE source_message_id = $1;
  `, [draft.messageId]);
  const original = existing.rows[0];
  if (original !== undefined) {
    return original.source_job_id === attempt.id && original.conversation_id === draft.conversationId
      ? { status: "existente", planId: original.id } : { status: "contexto_desatualizado" };
  }

  if (conversation.status !== draft.expectedStatus
    || message.direction !== "entrada" || message.sender_type !== "contato"
    || message.kind !== "texto" || !message.body?.trim()
    || message.created_at.getTime() !== draft.referenceAt.getTime()) {
    return { status: "contexto_desatualizado" };
  }
  const openings = await client.query<{ status: string }>(`
    SELECT status FROM public.response_plans WHERE conversation_id = $1 AND action = 'enviar_abertura';
  `, [draft.conversationId]);
  const opening = openings.rows[0];
  if (opening?.status === "pendente") return { status: "adiado", reason: "abertura_pendente" };
  if (opening?.status === "cancelado"
    || (opening === undefined && draft.decision.action !== "enviar_abertura")
    || (opening !== undefined && draft.decision.action === "enviar_abertura")) {
    return { status: "contexto_desatualizado" };
  }
  const pending = await client.query(`
    SELECT id FROM public.response_plans WHERE conversation_id = $1 AND status = 'pendente';
  `, [draft.conversationId]);
  if (pending.rowCount !== 0) return { status: "adiado", reason: "resposta_anterior_pendente" };

  const inserted = await client.query<{ id: string }>(`
    INSERT INTO public.response_plans
      (conversation_id, source_message_id, source_job_id, action, expected_status, next_status, reference_at)
    VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id;
  `, [draft.conversationId, draft.messageId, attempt.id, draft.decision.action,
    draft.expectedStatus, draft.decision.nextStatus, draft.referenceAt]);
  const planId = inserted.rows[0]?.id;
  if (planId === undefined) throw new Error("Não foi possível identificar o plano preparado.");
  for (const block of draft.blocks) {
    await client.query(`
      INSERT INTO public.response_blocks (plan_id, conversation_id, position, text) VALUES ($1, $2, $3, $4);
    `, [planId, draft.conversationId, block.position, block.text]);
  }
  return { status: "preparado", planId };
}

export class PostgresMessageResponsePlanStore implements MessageResponsePlanStore {
  constructor(private readonly pool: Pool) {}

  async prepare(input: ResponsePlanPreparation): Promise<ResponsePlanPreparationResult> {
    const parsed = preparationSchema.safeParse(input);
    if (!parsed.success) throw new TypeError("Os dados de preparação do plano de resposta são inválidos.");
    const command = parsed.data;
    // PostgreSQL representa UUIDs em minúsculas; a comparação dos vínculos
    // deve aceitar também uma entrada válida com letras maiúsculas.
    command.attempt.id = command.attempt.id.toLowerCase();
    command.draft.messageId = command.draft.messageId.toLowerCase();
    command.draft.conversationId = command.draft.conversationId.toLowerCase();
    // Copiar também a Date antes do primeiro await: o chamador não pode alterar
    // o snapshot que será gravado enquanto a conexão/bloqueio estiver pendente.
    command.draft.referenceAt = new Date(command.draft.referenceAt.getTime());
    const client = await this.pool.connect();
    let discardClient = false;
    try {
      await client.query("BEGIN ISOLATION LEVEL READ COMMITTED;");
      const result = await prepareInTransaction(client, command);
      await client.query("COMMIT;");
      return result;
    } catch (error) {
      try {
        await client.query("ROLLBACK;");
      } catch {
        discardClient = true;
      }
      throw error;
    } finally {
      client.release(discardClient);
    }
  }
}
