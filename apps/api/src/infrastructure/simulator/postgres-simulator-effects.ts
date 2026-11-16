import type { Pool } from "pg";
import type { SimulatorEffects, SimulatorEffectInput } from "../../modules/simulator/application/simulator-effects.js";
import { PostgresReceptionLeadStore } from "../../modules/leads/infrastructure/postgres-reception-lead-store.js";

// Adapter da demonstração local. A entrega simulada É a mensagem persistida;
// não há chamada externa entre envio e confirmação nem promessa sobre WhatsApp real.
export class PostgresSimulatorEffects implements SimulatorEffects {
  constructor(private readonly pool: Pool) {}
  async openingStatus(conversationId: string) {
    const row = (await this.pool.query<{ status: "pendente" | "enviado" | "cancelado" }>(
      "SELECT status FROM public.response_plans WHERE conversation_id = $1 AND action = 'enviar_abertura';", [conversationId])).rows[0];
    return row === undefined ? "ausente" as const : row.status === "enviado" ? "enviada" as const
      : row.status === "cancelado" ? "cancelada" as const : "pendente" as const;
  }
  async apply({ attempt, context, decision, planId }: SimulatorEffectInput) {
    const client = await this.pool.connect();
    let discard = false;
    try {
      await client.query("BEGIN;");
      const job = (await client.query<{ message_id: string; type: string; status: string; attempts: number }>(
        "SELECT message_id, type, status, attempts FROM public.jobs WHERE id = $1 FOR UPDATE;", [attempt.id])).rows[0];
      if (!job || job.status !== "processando" || job.attempts !== attempt.attempts || attempt.attempts <= 0) {
        await client.query("ROLLBACK;"); return "reserva_desatualizada" as const;
      }
      if (job.type !== "processar_mensagem" || job.message_id !== context.message.id) {
        await client.query("ROLLBACK;"); return "contexto_desatualizado" as const;
      }
      const conversation = (await client.query<{ status: string; contact_id: string }>(
        "SELECT status, contact_id FROM public.conversations WHERE id = $1 FOR UPDATE;", [context.conversation.id])).rows[0];
      const message = (await client.query<{ conversation_id: string; provider: string; body: string | null;
        direction: string; sender_type: string; kind: string }>(
        "SELECT conversation_id, provider, body, direction, sender_type, kind FROM public.messages WHERE id = $1 FOR SHARE;", [context.message.id])).rows[0];
      if (!conversation || !message || message.provider !== "simulador"
        || message.conversation_id !== context.conversation.id || conversation.contact_id !== context.contact.id) {
        await client.query("ROLLBACK;"); return "contexto_desatualizado" as const;
      }
      const silent = ["aguardando_humano", "em_atendimento_humano", "encerrada"].includes(conversation.status);
      const eligible = message.direction === "entrada" && message.sender_type === "contato" && message.kind === "texto" && !!message.body?.trim();
      if (planId !== undefined) {
        const plan = (await client.query<{ status: string; expected_status: string; next_status: string }>(`
          SELECT status, expected_status, next_status FROM public.response_plans
          WHERE id = $1 AND source_job_id = $2 AND source_message_id = $3 AND conversation_id = $4 FOR UPDATE;
        `, [planId, attempt.id, context.message.id, context.conversation.id])).rows[0];
        if (!plan) throw new Error("Plano de resposta não corresponde à reserva.");
        if (plan.status === "pendente") {
          if (silent || !eligible) {
            await client.query("UPDATE public.response_blocks SET status = 'cancelado' WHERE plan_id = $1 AND status = 'pendente';", [planId]);
            await client.query("UPDATE public.response_plans SET status = 'cancelado', finished_at = CURRENT_TIMESTAMP WHERE id = $1;", [planId]);
          } else {
            if (conversation.status !== plan.expected_status) {
              await client.query("ROLLBACK;"); return "contexto_desatualizado" as const;
            }
            const blocks = await client.query<{ position: number; text: string; status: string }>(
              "SELECT position, text, status FROM public.response_blocks WHERE plan_id = $1 ORDER BY position FOR UPDATE;", [planId]);
            if (blocks.rows.length === 0) throw new Error("Plano sem blocos.");
            for (const [index, block] of blocks.rows.entries()) {
              if (block.position !== index + 1 || block.status === "cancelado") throw new Error("Progresso inválido.");
              if (block.status === "enviado") continue;
              const externalId = `response:${planId}:${block.position}`;
              await client.query(`INSERT INTO public.messages
                (conversation_id, provider, external_id, direction, sender_type, kind, body)
                VALUES ($1, 'simulador', $2, 'saida', 'bot', 'texto', $3)
                ON CONFLICT ON CONSTRAINT messages_provider_external_id_key DO NOTHING;`,
                [context.conversation.id, externalId, block.text]);
              const sent = (await client.query<{ id: string }>(`SELECT id FROM public.messages
                WHERE provider = 'simulador' AND external_id = $1 AND conversation_id = $2
                  AND direction = 'saida' AND sender_type = 'bot' AND kind = 'texto' AND body = $3;`,
                [externalId, context.conversation.id, block.text])).rows[0];
              if (!sent) throw new Error("Conflito na identidade da resposta simulada.");
              await client.query(`UPDATE public.response_blocks SET status = 'enviado', sent_message_id = $3, sent_at = CURRENT_TIMESTAMP
                WHERE plan_id = $1 AND position = $2;`, [planId, block.position, sent.id]);
            }
            await client.query("UPDATE public.response_plans SET status = 'enviado', finished_at = CURRENT_TIMESTAMP WHERE id = $1;", [planId]);
            await client.query("UPDATE public.conversations SET status = $2, last_message_at = GREATEST(last_message_at, CURRENT_TIMESTAMP) WHERE id = $1;", [context.conversation.id, plan.next_status]);
          }
        }
      } else if (!silent) {
        if (conversation.status !== context.conversation.status || message.body !== context.message.body
          || message.direction !== context.message.direction || message.sender_type !== context.message.senderType
          || message.kind !== context.message.kind) {
          await client.query("ROLLBACK;"); return "contexto_desatualizado" as const;
        }
        if (decision.action === "solicitar_recepcao" || decision.action === "solicitar_qualificacao") {
          await client.query(`UPDATE public.response_blocks SET status = 'cancelado'
            WHERE status = 'pendente' AND plan_id IN (SELECT id FROM public.response_plans
              WHERE conversation_id = $1 AND status = 'pendente');`, [context.conversation.id]);
          await client.query(`UPDATE public.response_plans SET status = 'cancelado', finished_at = CURRENT_TIMESTAMP
            WHERE conversation_id = $1 AND status = 'pendente';`, [context.conversation.id]);
          await new PostgresReceptionLeadStore(client).upsert({ conversationId: context.conversation.id,
            contactId: conversation.contact_id, needsReview: decision.action === "solicitar_qualificacao" });
          await client.query("UPDATE public.conversations SET status = 'aguardando_humano' WHERE id = $1;", [context.conversation.id]);
        } else if (decision.action !== "ignorar") {
          await client.query("ROLLBACK;"); return "contexto_desatualizado" as const;
        }
      }
      // Mesmo predicado da finalização existente, no cliente da transação dos
      // efeitos: usar queue.complete(pool) aqui confirmaria em outra transação.
      await client.query(`UPDATE public.jobs SET status = 'concluido', locked_at = NULL, last_error = NULL
        WHERE id = $1 AND status = 'processando' AND attempts = $2;`, [attempt.id, attempt.attempts]);
      await client.query("COMMIT;");
      return "concluido" as const;
    } catch (error) {
      try { await client.query("ROLLBACK;"); } catch { discard = true; }
      throw error;
    } finally { client.release(discard); }
  }
}
