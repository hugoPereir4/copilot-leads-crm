import type { BusinessProfile } from "../../business-profile/contracts/business-profile.js";
import type { ClaimedJob } from "../../jobs/application/job-queue.js";
import type { MessageProcessingContext } from "../contracts/message-processing-context.js";
import type { MessageResponsePlanDraft } from "../contracts/message-response-plan.js";
import { composeMessageResponse } from "./compose-message-response.js";
import type { MessageResponsePlanStore, ResponsePlanPreparationResult } from "./message-response-plan-store.js";

export interface PrepareMessageResponsePlanInput {
  job: ClaimedJob;
  context: MessageProcessingContext;
  profile: BusinessProfile;
  decision: MessageResponsePlanDraft["decision"];
}

export async function prepareMessageResponsePlan(
  { job, context, profile, decision }: PrepareMessageResponsePlanInput,
  store: MessageResponsePlanStore,
): Promise<ResponsePlanPreparationResult> {
  if (!Number.isSafeInteger(job.attempts) || job.attempts <= 0
    || !Number.isSafeInteger(job.maxAttempts) || job.maxAttempts < job.attempts) {
    throw new RangeError("A preparação exige um contador de tentativa válido.");
  }
  if (job.messageId !== context.message.id) {
    throw new Error("A reserva e o contexto devem pertencer à mesma mensagem.");
  }
  const { message } = context;
  if (message.direction !== "entrada"
    || message.senderType !== "contato" || message.kind !== "texto" || !message.body?.trim()) {
    throw new Error("A mensagem não permite preparar uma resposta de texto.");
  }
  // Referência estável já disponível: instante de persistência da mensagem.
  // Não equivale à data do provedor nem ao horário em que o worker executará.
  const referenceAt = new Date(message.createdAt.getTime());
  const texts = composeMessageResponse(decision, profile, referenceAt);
  const draft: MessageResponsePlanDraft = {
    messageId: message.id, conversationId: context.conversation.id,
    expectedStatus: "aguardando_menu", decision: { ...decision }, referenceAt,
    blocks: texts.map((text, index) => ({ position: index + 1, text })),
  };
  // Não rejeitar um plano existente pela fotografia do estado atual. A porta
  // deve procurar o original antes de exigir aguardando_menu para plano novo.
  // O store deve preferir o snapshot original quando retornar "existente".
  // Rascunho recalculado não autoriza reenvio ou substituição de um plano salvo.
  return store.prepare({ attempt: { id: job.id, attempts: job.attempts }, draft });
}
