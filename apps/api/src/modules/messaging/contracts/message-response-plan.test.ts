import { deepEqual, equal } from "node:assert/strict";
import { test } from "node:test";
import { messageResponsePlanDraftSchema, type MessageResponsePlanDraft } from "./message-response-plan.js";

function draft(): MessageResponsePlanDraft {
  return {
    messageId: "00000000-0000-4000-8000-000000000001",
    conversationId: "00000000-0000-4000-8000-000000000002",
    expectedStatus: "aguardando_menu",
    decision: { action: "enviar_abertura", nextStatus: "aguardando_menu" },
    referenceAt: new Date("2026-11-16T12:00:00Z"),
    blocks: [{ position: 1, text: " Saudação\n" }, { position: 2, text: "Menu sintético" }],
  };
}

test("contrato preserva o snapshot, posições, data e textos sem transformação", () => {
  const input = draft();
  deepEqual(messageResponsePlanDraftSchema.parse(input), input);
});

test("plano exige UUIDs internos, data válida e campos conhecidos", () => {
  for (const input of [
    { ...draft(), messageId: "id-do-provedor" }, { ...draft(), conversationId: "" },
    { ...draft(), referenceAt: new Date(NaN) }, { ...draft(), referenceAt: "2026-11-16T12:00:00Z" },
    { ...draft(), enviado: true }, {}, null,
  ]) equal(messageResponsePlanDraftSchema.safeParse(input).success, false);
});

test("blocos vazios, textos ausentes e propriedades desconhecidas são recusados", () => {
  for (const blocks of [[], [{ position: 1, text: " \n" }], [{ position: 1, text: null }],
    [{ position: 1 }], [{ position: 1, text: "Texto", providerId: "não confirmado" }]]) {
    equal(messageResponsePlanDraftSchema.safeParse({ ...draft(), blocks }).success, false);
  }
});

test("posições devem começar em um e ser inteiras consecutivas na ordem do array", () => {
  for (const positions of [[0, 1], [1, 1], [1, 3], [2, 1], [1, 2.5], [-1, 0]]) {
    equal(messageResponsePlanDraftSchema.safeParse({ ...draft(),
      blocks: positions.map((position) => ({ position, text: "Texto sintético" })) }).success, false);
  }
});

test("contrato aceita somente ações com texto e seus respectivos estados propostos", () => {
  for (const decision of [
    { action: "enviar_abertura", nextStatus: "aguardando_menu" },
    { action: "reapresentar_menu", nextStatus: "aguardando_menu" },
    { action: "informar_servicos", nextStatus: "aguardando_detalhes" },
    { action: "informar_valores_horarios", nextStatus: "aguardando_detalhes" },
  ]) equal(messageResponsePlanDraftSchema.safeParse({ ...draft(), decision }).success, true);
  for (const decision of [
    { action: "informar_servicos", nextStatus: "aguardando_humano" },
    { action: "enviar_abertura", nextStatus: "aguardando_detalhes" },
    { action: "solicitar_qualificacao", nextStatus: "qualificando" },
    { action: "ignorar", reason: "texto_vazio" }, { action: "acao_desconhecida" },
  ]) equal(messageResponsePlanDraftSchema.safeParse({ ...draft(), decision }).success, false);
});

test("estado esperado protege somente as preparações do menu deste recorte", () => {
  for (const expectedStatus of ["aguardando_detalhes", "qualificando", "aguardando_humano", "em_atendimento_humano", "encerrada"]) {
    equal(messageResponsePlanDraftSchema.safeParse({ ...draft(), expectedStatus }).success, false);
  }
});
