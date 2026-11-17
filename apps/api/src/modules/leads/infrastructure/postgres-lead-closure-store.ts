import type { Pool } from "pg";
import { leadClosureCommandSchema } from "../application/close-lead.js";
import type { LeadClosureCommand, LeadClosureResult, LeadClosureStore } from "../application/lead-closure-store.js";

export class PostgresLeadClosureStore implements LeadClosureStore {
  constructor(private readonly pool: Pool) {}

  async close(input: LeadClosureCommand): Promise<LeadClosureResult> {
    const parsed = leadClosureCommandSchema.safeParse(input);
    if (!parsed.success) throw new TypeError("Dados de encerramento inválidos.");
    const { leadId, result } = parsed.data;
    const client = await this.pool.connect();
    let discard = false;
    try {
      await client.query("BEGIN ISOLATION LEVEL READ COMMITTED;");
      // Mesma exclusão da assunção: conversa → lead → planos → blocos.
      // Não bloquear jobs enquanto segura a conversa (worker: job → conversa).
      const conversation = (await client.query<{ id: string; contact_id: string; status: string; closed_at: Date | null }>(`
        SELECT id, contact_id, status, closed_at FROM public.conversations
        WHERE id = (SELECT conversation_id FROM public.leads WHERE id = $1) FOR UPDATE;
      `, [leadId])).rows[0];
      const lead = (await client.query<{ conversation_id: string; contact_id: string; stage: string }>(
        "SELECT conversation_id, contact_id, stage FROM public.leads WHERE id = $1 FOR UPDATE;", [leadId])).rows[0];
      if (!lead) { await client.query("ROLLBACK;"); return { status: "nao_encontrado" }; }
      if (!conversation || lead.conversation_id !== conversation.id || lead.contact_id !== conversation.contact_id) {
        await client.query("ROLLBACK;"); return { status: "estado_incompativel" };
      }
      const repeated = lead.stage === result && conversation.status === "encerrada" && conversation.closed_at !== null;
      if (!repeated && (lead.stage !== "em_atendimento" || conversation.status !== "em_atendimento_humano")) {
        await client.query("ROLLBACK;"); return { status: "estado_incompativel" };
      }
      let closedAt = conversation.closed_at;
      if (!repeated) {
        await client.query("SELECT id FROM public.response_plans WHERE conversation_id = $1 AND status = 'pendente' ORDER BY id FOR UPDATE;", [conversation.id]);
        await client.query(`UPDATE public.response_blocks SET status = 'cancelado' WHERE status = 'pendente'
          AND plan_id IN (SELECT id FROM public.response_plans WHERE conversation_id = $1 AND status = 'pendente');`, [conversation.id]);
        await client.query(`UPDATE public.response_plans SET status = 'cancelado', finished_at = CURRENT_TIMESTAMP
          WHERE conversation_id = $1 AND status = 'pendente';`, [conversation.id]);
        await client.query("UPDATE public.leads SET stage = $2, updated_at = CURRENT_TIMESTAMP WHERE id = $1;", [leadId, result]);
        const updated = await client.query<{ closed_at: Date }>(`UPDATE public.conversations
          SET status = 'encerrada', closed_at = CURRENT_TIMESTAMP WHERE id = $1 RETURNING closed_at;`, [conversation.id]);
        closedAt = updated.rows[0]!.closed_at;
      }
      const receipt = { status: repeated ? "ja_encerrado" as const : "encerrado" as const, leadId,
        conversationId: conversation.id, result, conversationStatus: "encerrada" as const, closedAt: closedAt!.toISOString() };
      await client.query("COMMIT;");
      return receipt;
    } catch (error) {
      try { await client.query("ROLLBACK;"); } catch { discard = true; }
      throw error;
    } finally { client.release(discard); }
  }
}
