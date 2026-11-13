import type { Pool } from "pg";
import type { MessageProcessingContextReader } from "../application/message-processing-context-reader.js";
import { messageProcessingContextSchema, type MessageProcessingContext } from "../contracts/message-processing-context.js";

export class PostgresMessageProcessingContextReader implements MessageProcessingContextReader {
  constructor(private readonly pool: Pool) {}

  async findByMessageId(messageId: string): Promise<MessageProcessingContext | undefined> {
    // Uma única leitura pelo vínculo original, sem procurar a conversa aberta
    // mais recente do contato. Não carrega raw_payload ou histórico inteiro.
    const result = await this.pool.query<Record<string, unknown>>(`
      SELECT message.id AS message_id, message.provider, message.external_id,
             message.direction, message.sender_type, message.kind, message.body,
             message.created_at AS message_created_at,
             conversation.id AS conversation_id, conversation.status AS conversation_status,
             contact.id AS contact_id, contact.phone, contact.display_name
      FROM public.messages AS message
      INNER JOIN public.conversations AS conversation ON conversation.id = message.conversation_id
      INNER JOIN public.contacts AS contact ON contact.id = conversation.contact_id
      WHERE message.id = $1;
    `, [messageId]);
    const row = result.rows[0];
    if (row === undefined) return undefined;
    const parsed = messageProcessingContextSchema.safeParse({
      message: {
        id: row.message_id, provider: row.provider, externalId: row.external_id,
        direction: row.direction, senderType: row.sender_type, kind: row.kind,
        body: row.body, createdAt: row.message_created_at,
      },
      conversation: { id: row.conversation_id, status: row.conversation_status },
      contact: { id: row.contact_id, phone: row.phone, displayName: row.display_name },
    });
    if (!parsed.success) throw new Error("O contexto persistido da mensagem é inválido.");
    return parsed.data;
  }
}
