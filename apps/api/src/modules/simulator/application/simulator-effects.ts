import type { JobAttempt } from "../../jobs/application/job-lifecycle.js";
import type { MessageProcessingContext } from "../../messaging/contracts/message-processing-context.js";
import type { MessageProcessingDecision } from "../../messaging/contracts/message-processing-decision.js";

export type SimulatorEffectInput = {
  attempt: JobAttempt;
  context: MessageProcessingContext;
  decision: MessageProcessingDecision;
  planId?: string;
};
export interface SimulatorEffects {
  openingStatus(conversationId: string): Promise<"ausente" | "pendente" | "enviada" | "cancelada">;
  apply(input: SimulatorEffectInput): Promise<"concluido" | "reserva_desatualizada" | "contexto_desatualizado">;
}
