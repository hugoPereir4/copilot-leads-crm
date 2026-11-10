import type { Pool, PoolClient } from "pg";
import type { IncomingMessageInbox, MessageReceipt, MessageRegistration } from "../application/incoming-message-inbox.js";
import { serializeMessagePayload } from "./serialize-message-payload.js";

async function findExistingMessage(client: PoolClient, provider: string, externalId: string): Promise<string | undefined> {
  const result = await client.query<{ id: string }>(
    "SELECT id FROM public.messages WHERE provider = $1 AND external_id = $2;", [provider, externalId]);
  return result.rows[0]?.id;
}

export class PostgresIncomingMessageInbox implements IncomingMessageInbox {
  constructor(private readonly pool: Pool) {}

  async register(input: MessageRegistration): Promise<MessageReceipt> {
    const { message } = input;
    const rawPayload = serializeMessagePayload(input.rawPayload);
    const client = await this.pool.connect();
    let discardClient = false;

    try {
      // As releituras após conflitos precisam enxergar commits concorrentes.
      await client.query("BEGIN ISOLATION LEVEL READ COMMITTED;");
      const existingId = await findExistingMessage(client, message.provider, message.externalId);
      if (existingId !== undefined) {
        await client.query("COMMIT;");
        return { status: "duplicada", messageId: existingId };
      }

      await client.query(
        "INSERT INTO public.contacts (phone) VALUES ($1) ON CONFLICT ON CONSTRAINT contacts_phone_key DO NOTHING;",
        [message.phone]);
      const contacts = await client.query<{ id: string }>(
        "SELECT id FROM public.contacts WHERE phone = $1 FOR UPDATE;", [message.phone]);
      const contactId = contacts.rows[0]?.id;
      if (contactId === undefined) throw new Error("Não foi possível localizar o contato da recepção.");

      // Outra recepção do mesmo contato pode ter concluído enquanto aguardávamos.
      const duplicateAfterLock = await findExistingMessage(client, message.provider, message.externalId);
      if (duplicateAfterLock !== undefined) {
        await client.query("ROLLBACK;");
        return { status: "duplicada", messageId: duplicateAfterLock };
      }

      const conversations = await client.query<{ id: string }>(
        "SELECT id FROM public.conversations WHERE contact_id = $1 AND status <> 'encerrada' FOR UPDATE;", [contactId]);
      let conversationId = conversations.rows[0]?.id;
      if (conversationId === undefined) {
        const created = await client.query<{ id: string }>(
          "INSERT INTO public.conversations (contact_id) VALUES ($1) RETURNING id;", [contactId]);
        conversationId = created.rows[0]?.id;
      }
      if (conversationId === undefined) throw new Error("Não foi possível preparar a conversa da recepção.");

      const inserted = await client.query<{ id: string }>(
        `INSERT INTO public.messages
          (conversation_id, provider, external_id, direction, sender_type, kind, body, raw_payload)
         VALUES ($1, $2, $3, 'entrada', 'contato', $4, $5, $6::jsonb)
         ON CONFLICT ON CONSTRAINT messages_provider_external_id_key DO NOTHING RETURNING id;`,
        [conversationId, message.provider, message.externalId, message.kind,
          message.kind === "texto" ? message.text : null, rawPayload]);
      const messageId = inserted.rows[0]?.id;
      if (messageId === undefined) {
        // O mesmo ID também pode chegar com outro telefone. A restrição única
        // decide a disputa; desfazemos o contato/conversa provisórios do perdedor.
        const originalId = await findExistingMessage(client, message.provider, message.externalId);
        if (originalId === undefined) throw new Error("Não foi possível localizar a mensagem original após conflito.");
        await client.query("ROLLBACK;");
        return { status: "duplicada", messageId: originalId };
      }

      await client.query(
        "UPDATE public.conversations SET last_message_at = GREATEST(last_message_at, $2::timestamptz) WHERE id = $1;",
        [conversationId, message.receivedAt]);
      if (input.enqueueProcessing) {
        await client.query("INSERT INTO public.jobs (type, message_id) VALUES ('processar_mensagem', $1);", [messageId]);
      }
      await client.query("COMMIT;");
      return { status: "registrada", messageId };
    } catch (error) {
      try {
        await client.query("ROLLBACK;");
      } catch {
        // Uma conexão que não conseguiu desfazer a transação sai do pool.
        discardClient = true;
      }
      throw error;
    } finally {
      client.release(discardClient);
    }
  }
}
