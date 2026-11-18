import type { JobQueue } from "../../jobs/application/job-queue.js";
import type { JobLifecycle } from "../../jobs/application/job-lifecycle.js";
import { failJob } from "../../jobs/application/fail-job.js";
import type { BusinessProfileReader } from "../../business-profile/application/business-profile-reader.js";
import type { MessageProcessingContextReader } from "../../messaging/application/message-processing-context-reader.js";
import type { MessageResponsePlanReader } from "../../messaging/application/message-response-plan-reader.js";
import type { MessageResponsePlanStore } from "../../messaging/application/message-response-plan-store.js";
import { decideMessageProcessing } from "../../messaging/application/decide-message-processing.js";
import { prepareMessageResponsePlan } from "../../messaging/application/prepare-message-response-plan.js";
import type { SimulatorEffects } from "./simulator-effects.js";
import type { QualifyMessage } from "../../leads/application/qualify-message.js";

// Sem contexto a mensagem nunca será processável: repetir pela fila só gastaria tentativas (D12).
class MissingContextError extends Error {
  constructor() { super("Contexto ausente."); }
}

export class SimulatorProcessor {
  constructor(private readonly dependencies: {
    queue: JobQueue & JobLifecycle;
    profile: BusinessProfileReader;
    contexts: MessageProcessingContextReader;
    plans: MessageResponsePlanReader;
    planStore: MessageResponsePlanStore;
    effects: SimulatorEffects;
    qualification: Pick<QualifyMessage, "execute">;
    report?: (jobId: string, code: string) => void;
  }) {}

  async processOne(): Promise<boolean> {
    const d = this.dependencies;
    const job = await d.queue.claimNext("processar_mensagem");
    if (!job) return false;
    try {
      const context = await d.contexts.findByMessageId(job.messageId);
      if (!context) throw new MissingContextError();
      // Retomar antes de reler perfil/decidir: o snapshot original prevalece.
      const original = await d.plans.findByMessageId(job.messageId);
      const profile = original ? undefined : await d.profile.read();
      const opening = original ? "enviada" : await d.effects.openingStatus(context.conversation.id);
      let decision = original?.decision ?? decideMessageProcessing({ context, profile: profile!,
        openingStatus: opening === "enviada" ? "enviada" : "pendente" });
      if (!original && (opening === "cancelada" || opening === "pendente")
        && !["aguardando_humano", "em_atendimento_humano", "encerrada"].includes(context.conversation.status)) {
        // Situação interrompida sem origem retomável: tornar visível ao humano.
        decision = { action: "solicitar_qualificacao", nextStatus: "qualificando" };
      }
      if (decision.action === "adiar") throw new Error("Processamento anterior ainda em andamento.");
      if (decision.action === "solicitar_qualificacao") {
        await d.qualification.execute({ job, context }, profile!);
        return true;
      }
      let planId = original?.id;
      if (!original && (decision.action === "enviar_abertura" || decision.action === "reapresentar_menu"
        || decision.action === "informar_servicos" || decision.action === "informar_valores_horarios")) {
        const result = await prepareMessageResponsePlan({ job, context, profile: profile!, decision }, d.planStore);
        if (result.status === "reserva_desatualizada") return true;
        if (result.status !== "preparado" && result.status !== "existente") throw new Error("Preparação adiada ou contexto alterado.");
        planId = result.planId;
      }
      const outcome = await d.effects.apply({ attempt: { id: job.id, attempts: job.attempts }, context, decision,
        ...(planId === undefined ? {} : { planId }) });
      if (outcome === "contexto_desatualizado") throw new Error("Contexto alterado antes dos efeitos.");
    } catch (error) {
      const outcome = await failJob(job, error instanceof MissingContextError ? "definitiva" : "transitoria", d.queue);
      d.report?.(job.id, outcome.status === "falhou" ? "simulator_job_failed" : "simulator_job_retry");
    }
    return true;
  }
}
