import { z } from "zod";
import { messageResponsePlanDraftSchema } from "./message-response-plan.js";

const draftFields = messageResponsePlanDraftSchema.shape;
const blockFields = draftFields.blocks.element.shape;
const responseBlockSnapshotSchema = z.discriminatedUnion("status", [
  z.strictObject({ ...blockFields, status: z.literal("pendente"), sentMessageId: z.null(), sentAt: z.null() }),
  z.strictObject({ ...blockFields, status: z.literal("enviado"), sentMessageId: z.uuid(), sentAt: z.date() }),
  z.strictObject({ ...blockFields, status: z.literal("cancelado"), sentMessageId: z.null(), sentAt: z.null() }),
]);
const planFields = {
  id: z.uuid(),
  messageId: draftFields.messageId,
  conversationId: draftFields.conversationId,
  sourceJobId: z.uuid(),
  expectedStatus: draftFields.expectedStatus,
  decision: draftFields.decision,
  referenceAt: draftFields.referenceAt,
  createdAt: z.date(),
  blocks: z.array(responseBlockSnapshotSchema).min(1),
};

// Representação de leitura, separada do rascunho de criação. Preserva também
// planos terminados e confirmações; não escolhe um bloco nem autoriza envio.
export const messageResponsePlanSnapshotSchema = z.discriminatedUnion("status", [
  z.strictObject({ ...planFields, status: z.literal("pendente"), finishedAt: z.null() }),
  z.strictObject({ ...planFields, status: z.literal("enviado"), finishedAt: z.date() }),
  z.strictObject({ ...planFields, status: z.literal("cancelado"), finishedAt: z.date() }),
]).superRefine((plan, context) => {
  if (plan.finishedAt !== null && plan.finishedAt.getTime() < plan.createdAt.getTime()) {
    context.addIssue({ code: "custom", path: ["finishedAt"], message: "O término não pode anteceder a criação." });
  }
  const sentMessages = new Set<string>();
  plan.blocks.forEach((block, index) => {
    if (block.position !== index + 1) {
      context.addIssue({ code: "custom", path: ["blocks", index, "position"],
        message: "Os blocos devem estar ordenados e consecutivos a partir de um." });
    }
    if ((plan.status === "enviado" && block.status !== "enviado")
      || (plan.status === "cancelado" && block.status === "pendente")
      || (plan.status === "pendente" && block.status === "cancelado")) {
      context.addIssue({ code: "custom", path: ["blocks", index, "status"],
        message: "O progresso do bloco é incompatível com o estado do plano." });
    }
    if (block.sentMessageId !== null) {
      const messageId = block.sentMessageId.toLowerCase();
      if (sentMessages.has(messageId)) {
        context.addIssue({ code: "custom", path: ["blocks", index, "sentMessageId"],
          message: "Uma confirmação não pode pertencer a dois blocos." });
      }
      sentMessages.add(messageId);
    }
  });
});

export type MessageResponsePlanSnapshot = z.output<typeof messageResponsePlanSnapshotSchema>;
