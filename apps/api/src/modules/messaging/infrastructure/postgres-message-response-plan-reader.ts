import type { Pool } from "pg";
import { z } from "zod";
import type { MessageResponsePlanReader } from "../application/message-response-plan-reader.js";
import {
  messageResponsePlanSnapshotSchema, type MessageResponsePlanSnapshot,
} from "../contracts/message-response-plan-snapshot.js";

const messageIdSchema = z.uuid();

export class PostgresMessageResponsePlanReader implements MessageResponsePlanReader {
  constructor(private readonly pool: Pool) {}

  async findByMessageId(messageId: string): Promise<MessageResponsePlanSnapshot | undefined> {
    if (!messageIdSchema.safeParse(messageId).success) {
      throw new TypeError("A leitura do plano exige o UUID interno da mensagem.");
    }
    // Uma instrução mantém plano e blocos na mesma fotografia do PostgreSQL.
    // LEFT JOIN distingue plano sem blocos (inválido) de plano inexistente.
    const result = await this.pool.query<Record<string, unknown>>(`
      SELECT plan.id, plan.source_message_id, plan.conversation_id, plan.source_job_id,
             plan.expected_status, plan.action, plan.next_status, plan.reference_at,
             plan.status AS plan_status, plan.created_at, plan.finished_at,
             block.position, block.text, block.status AS block_status, block.sent_message_id, block.sent_at
      FROM public.response_plans AS plan
      LEFT JOIN public.response_blocks AS block ON block.plan_id = plan.id
      WHERE plan.source_message_id = $1
      ORDER BY block.position;
    `, [messageId]);
    const row = result.rows[0];
    if (row === undefined) return undefined;
    const parsed = messageResponsePlanSnapshotSchema.safeParse({
      id: row.id, messageId: row.source_message_id, conversationId: row.conversation_id, sourceJobId: row.source_job_id,
      expectedStatus: row.expected_status, decision: { action: row.action, nextStatus: row.next_status },
      referenceAt: row.reference_at, status: row.plan_status, createdAt: row.created_at, finishedAt: row.finished_at,
      blocks: result.rows.filter((block) => block.position !== null).map((block) => ({
        position: block.position, text: block.text, status: block.block_status,
        sentMessageId: block.sent_message_id, sentAt: block.sent_at,
      })),
    });
    if (!parsed.success) throw new Error("O plano de resposta persistido é inválido.");
    return parsed.data;
  }
}
