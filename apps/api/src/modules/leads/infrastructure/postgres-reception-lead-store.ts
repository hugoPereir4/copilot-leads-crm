import type { PoolClient } from "pg";
import type { ReceptionLeadStore } from "../application/reception-lead-store.js";

// O cliente pertence à transação coordenada: lead, estado e job confirmam juntos.
export class PostgresReceptionLeadStore implements ReceptionLeadStore {
  constructor(private readonly client: PoolClient) {}
  async upsert(input: { conversationId: string; contactId: string; needsReview: boolean }): Promise<void> {
    await this.client.query(`
      INSERT INTO public.leads (conversation_id, contact_id, needs_review, summary)
      VALUES ($1, $2, $3, CASE WHEN $3::boolean THEN 'Solicitação administrativa encaminhada para revisão humana.' ELSE NULL END)
      ON CONFLICT ON CONSTRAINT leads_conversation_id_key DO UPDATE
      SET needs_review = leads.needs_review OR EXCLUDED.needs_review,
          summary = COALESCE(leads.summary, EXCLUDED.summary), updated_at = CURRENT_TIMESTAMP;
    `, [input.conversationId, input.contactId, input.needsReview]);
  }
}
