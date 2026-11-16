import { z } from "zod";

const responseDecisionSchema = z.discriminatedUnion("action", [
  z.strictObject({ action: z.literal("enviar_abertura"), nextStatus: z.literal("aguardando_menu") }),
  z.strictObject({ action: z.literal("reapresentar_menu"), nextStatus: z.literal("aguardando_menu") }),
  z.strictObject({ action: z.literal("informar_servicos"), nextStatus: z.literal("aguardando_detalhes") }),
  z.strictObject({ action: z.literal("informar_valores_horarios"), nextStatus: z.literal("aguardando_detalhes") }),
]);

// Snapshot completo proposto para gravação. Não representa uma resposta enviada.
// Identidade persistida e progresso de envio serão fornecidos pela infraestrutura.
export const messageResponsePlanDraftSchema = z.strictObject({
  messageId: z.uuid(),
  conversationId: z.uuid(),
  expectedStatus: z.literal("aguardando_menu"),
  decision: responseDecisionSchema,
  referenceAt: z.date(),
  blocks: z.array(z.strictObject({
    position: z.number().int().positive(),
    text: z.string().refine((value) => value.trim().length > 0),
  })).min(1),
}).superRefine((draft, context) => {
  draft.blocks.forEach((block, index) => {
    if (block.position !== index + 1) {
      context.addIssue({ code: "custom", path: ["blocks", index, "position"],
        message: "Os blocos devem estar em ordem, com posições consecutivas a partir de um." });
    }
  });
});

export type MessageResponsePlanDraft = z.output<typeof messageResponsePlanDraftSchema>;
