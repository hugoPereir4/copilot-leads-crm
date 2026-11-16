import { deepEqual, equal } from "node:assert/strict";
import { test } from "node:test";
import { messageResponsePlanSnapshotSchema, type MessageResponsePlanSnapshot } from "./message-response-plan-snapshot.js";

function snapshot(): MessageResponsePlanSnapshot {
  return {
    id: "00000000-0000-4000-8000-000000000001",
    messageId: "00000000-0000-4000-8000-000000000002",
    conversationId: "00000000-0000-4000-8000-000000000003",
    sourceJobId: "00000000-0000-4000-8000-000000000004",
    expectedStatus: "aguardando_menu",
    decision: { action: "enviar_abertura", nextStatus: "aguardando_menu" },
    referenceAt: new Date("2026-11-16T12:00:00.123Z"),
    createdAt: new Date("2026-11-16T13:00:00.456Z"), status: "pendente", finishedAt: null,
    blocks: [
      { position: 1, text: "  Saudação sintética\n", status: "pendente", sentMessageId: null, sentAt: null },
      { position: 2, text: "Menu sintético", status: "pendente", sentMessageId: null, sentAt: null },
    ],
  };
}
function sent(position: number) {
  return { position, text: "Texto confirmado", status: "enviado" as const,
    sentMessageId: `00000000-0000-4000-8000-${String(position + 4).padStart(12, "0")}`,
    sentAt: new Date("2026-11-16T13:01:00.789Z") };
}
const finishedAt = new Date("2026-11-16T13:02:00.012Z");

test("leitura preserva identidade, conteúdo, referência e datas do plano persistido", () => {
  const input = snapshot();
  deepEqual(messageResponsePlanSnapshotSchema.parse(input), input);
});

test("snapshot exige os quatro UUIDs internos e campos conhecidos em todos os níveis", () => {
  for (const field of ["id", "messageId", "conversationId", "sourceJobId"]) {
    equal(messageResponsePlanSnapshotSchema.safeParse({ ...snapshot(), [field]: "id-do-provedor" }).success, false);
  }
  for (const input of [null, {}, { ...snapshot(), rawPayload: "não permitido" },
    { ...snapshot(), decision: { action: "enviar_abertura", nextStatus: "aguardando_menu", extra: true } },
    { ...snapshot(), blocks: [{ ...sent(1), providerId: "não permitido" }] }]) {
    equal(messageResponsePlanSnapshotSchema.safeParse(input).success, false);
  }
});

test("datas devem ser Date válidas, sem coerção de strings ou substituição pelo relógio", () => {
  for (const field of ["referenceAt", "createdAt"]) {
    for (const value of [new Date(NaN), "2026-11-16T12:00:00Z", null, Infinity]) {
      equal(messageResponsePlanSnapshotSchema.safeParse({ ...snapshot(), [field]: value }).success, false);
    }
  }
  for (const value of [new Date(NaN), "2026-11-16T13:02:00Z", Infinity]) {
    equal(messageResponsePlanSnapshotSchema.safeParse({ ...snapshot(), status: "enviado", finishedAt: value,
      blocks: [sent(1)] }).success, false);
    equal(messageResponsePlanSnapshotSchema.safeParse({ ...snapshot(), blocks: [{ ...sent(1), sentAt: value }] }).success, false);
  }
});

test("leitura reutiliza as quatro decisões textuais e o estado esperado da criação", () => {
  for (const decision of [
    { action: "enviar_abertura", nextStatus: "aguardando_menu" },
    { action: "reapresentar_menu", nextStatus: "aguardando_menu" },
    { action: "informar_servicos", nextStatus: "aguardando_detalhes" },
    { action: "informar_valores_horarios", nextStatus: "aguardando_detalhes" },
  ]) equal(messageResponsePlanSnapshotSchema.safeParse({ ...snapshot(), decision }).success, true);
  for (const patch of [
    { decision: { action: "informar_servicos", nextStatus: "aguardando_menu" } },
    { decision: { action: "solicitar_recepcao", nextStatus: "aguardando_humano" } },
    { expectedStatus: "aguardando_humano" },
  ]) equal(messageResponsePlanSnapshotSchema.safeParse({ ...snapshot(), ...patch }).success, false);
});

test("plano precisa de texto não vazio e blocos ordenados de um até N, sem lacunas", () => {
  for (const blocks of [[], [{ ...sent(1), text: " \n\t\uFEFF" }], [{ ...sent(1), text: null }],
    [sent(0)], [sent(2)], [sent(1), sent(1)], [sent(1), sent(3)], [sent(2), sent(1)], [sent(1.5)]]) {
    equal(messageResponsePlanSnapshotSchema.safeParse({ ...snapshot(), blocks }).success, false);
  }
});

test("cada confirmação exige UUID e data; blocos pendentes ou cancelados não têm confirmação", () => {
  for (const block of [
    { ...sent(1), sentMessageId: null }, { ...sent(1), sentMessageId: "externo" }, { ...sent(1), sentAt: null },
    { ...sent(1), status: "pendente" }, { ...sent(1), status: "cancelado" }, { ...sent(1), status: "desconhecido" },
  ]) equal(messageResponsePlanSnapshotSchema.safeParse({ ...snapshot(), blocks: [block] }).success, false);
});

test("término é obrigatório nos planos terminados, nulo nos pendentes e não antecede criação", () => {
  for (const patch of [
    { finishedAt }, { status: "enviado" }, { status: "cancelado" },
    { status: "desconhecido" }, { status: "enviado", finishedAt: new Date("2026-11-16T12:00:00Z") },
  ]) equal(messageResponsePlanSnapshotSchema.safeParse({ ...snapshot(), blocks: [sent(1)], ...patch }).success, false);
  equal(messageResponsePlanSnapshotSchema.safeParse({ ...snapshot(), blocks: [sent(1)], status: "enviado",
    finishedAt: snapshot().createdAt }).success, true);
});

test("preserva progresso parcial, envio completo e cancelamento com confirmações anteriores", () => {
  const pending = snapshot();
  const canceled = { position: 2, text: "Não enviado", status: "cancelado", sentMessageId: null, sentAt: null };
  for (const input of [
    { ...pending, blocks: [sent(1), pending.blocks[1]] },
    { ...pending, blocks: [sent(1), sent(2)] }, // Confirmações não autorizam finalizar automaticamente.
    { ...pending, status: "enviado", finishedAt, blocks: [sent(1), sent(2)] },
    { ...pending, status: "cancelado", finishedAt, blocks: [sent(1), canceled] },
    { ...pending, status: "cancelado", finishedAt, blocks: [{ ...canceled, position: 1 }] },
  ]) deepEqual(messageResponsePlanSnapshotSchema.parse(input), input);
});

test("rejeita incompatibilidade entre estado do plano e progresso dos blocos", () => {
  const pending = snapshot();
  const canceled = { position: 1, text: "Não enviado", status: "cancelado", sentMessageId: null, sentAt: null };
  for (const input of [
    { ...pending, status: "enviado", finishedAt },
    { ...pending, status: "cancelado", finishedAt },
    { ...pending, blocks: [canceled] },
    { ...pending, status: "enviado", finishedAt, blocks: [canceled] },
  ]) equal(messageResponsePlanSnapshotSchema.safeParse(input).success, false);
});

test("uma mensagem de confirmação não pode aparecer em dois blocos do snapshot", () => {
  equal(messageResponsePlanSnapshotSchema.safeParse({ ...snapshot(), blocks: [sent(1),
    { ...sent(2), sentMessageId: sent(1).sentMessageId }] }).success, false);
});
