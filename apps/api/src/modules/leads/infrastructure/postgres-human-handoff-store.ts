import type { Pool } from "pg";
import { humanHandoffLeadIdSchema } from "../application/assume-human-attendance.js";
import type { HumanHandoffStore, HumanHandoffResult } from "../application/human-handoff-store.js";

export class PostgresHumanHandoffStore implements HumanHandoffStore {
  constructor(private readonly pool: Pool) {}

  async assume(leadId: string): Promise<HumanHandoffResult> {
    const parsed = humanHandoffLeadIdSchema.safeParse(leadId);
    if (!parsed.success) throw new TypeError("Identificador do lead inválido.");
    const id = parsed.data;
    const client = await this.pool.connect();
    let discard = false;
    try {
      await client.query("BEGIN ISOLATION LEVEL READ COMMITTED;");
      // Worker: job → conversa → mensagem/plano/blocos → lead.
      // Aqui não bloqueamos jobs nem mensagens: conversa → lead → plano → blocos.
      // A conversa é o ponto comum de exclusão; nunca esperar pelo job segurando-a.
      const conversation = (await client.query<{ id: string; status: string; contact_id: string }>(`
        SELECT id, status, contact_id FROM public.conversations
        WHERE id = (SELECT conversation_id FROM public.leads WHERE id = $1) FOR UPDATE;
      `, [id])).rows[0];
      const lead = (await client.query<{ conversation_id: string; contact_id: string; stage: string }>(`
        SELECT conversation_id, contact_id, stage FROM public.leads WHERE id = $1 FOR UPDATE;
      `, [id])).rows[0];
      if (!lead) { await client.query("ROLLBACK;"); return { status: "nao_encontrado" }; }
      if (!conversation || lead.conversation_id !== conversation.id || lead.contact_id !== conversation.contact_id) {
        await client.query("ROLLBACK;"); return { status: "estado_incompativel" };
      }
      const repeated = lead.stage === "em_atendimento" && conversation.status === "em_atendimento_humano";
      const allowedConversation = ["aguardando_menu", "aguardando_detalhes", "qualificando", "aguardando_humano"];
      if (!repeated && (!(lead.stage === "novo" || lead.stage === "qualificado") || !allowedConversation.includes(conversation.status))) {
        await client.query("ROLLBACK;"); return { status: "estado_incompativel" };
      }
      if (!repeated) {
        // Todos os executores/preparadores atuais também bloqueiam a conversa.
        await client.query("SELECT id FROM public.response_plans WHERE conversation_id = $1 AND status = 'pendente' ORDER BY id FOR UPDATE;", [conversation.id]);
        await client.query(`UPDATE public.response_blocks SET status = 'cancelado'
          WHERE status = 'pendente' AND plan_id IN (SELECT id FROM public.response_plans
            WHERE conversation_id = $1 AND status = 'pendente');`, [conversation.id]);
        await client.query(`UPDATE public.response_plans SET status = 'cancelado', finished_at = CURRENT_TIMESTAMP
          WHERE conversation_id = $1 AND status = 'pendente';`, [conversation.id]);
        await client.query("UPDATE public.leads SET stage = 'em_atendimento', updated_at = CURRENT_TIMESTAMP WHERE id = $1;", [id]);
        await client.query("UPDATE public.conversations SET status = 'em_atendimento_humano' WHERE id = $1;", [conversation.id]);
      }
      await client.query("COMMIT;");
      return { status: repeated ? "ja_assumido" : "assumido", leadId: id, conversationId: conversation.id,
        stage: "em_atendimento", conversationStatus: "em_atendimento_humano" };
    } catch (error) {
      try { await client.query("ROLLBACK;"); } catch { discard = true; }
      throw error;
    } finally { client.release(discard); }
  }
}
