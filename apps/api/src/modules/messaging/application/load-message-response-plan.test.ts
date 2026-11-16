import { equal, rejects } from "node:assert/strict";
import { test } from "node:test";
import type { MessageResponsePlanSnapshot } from "../contracts/message-response-plan-snapshot.js";
import { loadMessageResponsePlan } from "./load-message-response-plan.js";

const messageId = "00000000-0000-4000-8000-000000000001";

test("carga do plano consulta a mensagem de origem e preserva o snapshot da porta", async () => {
  const snapshot: MessageResponsePlanSnapshot = {
    id: "00000000-0000-4000-8000-000000000002", messageId,
    conversationId: "00000000-0000-4000-8000-000000000003",
    sourceJobId: "00000000-0000-4000-8000-000000000004", expectedStatus: "aguardando_menu",
    decision: { action: "enviar_abertura", nextStatus: "aguardando_menu" },
    referenceAt: new Date("2026-11-16T12:00:00Z"), createdAt: new Date("2026-11-16T13:00:00Z"),
    status: "pendente", finishedAt: null,
    blocks: [{ position: 1, text: "Texto original", status: "pendente", sentMessageId: null, sentAt: null }],
  };
  let calls = 0;
  const result = await loadMessageResponsePlan(messageId, { async findByMessageId(id) {
    calls++; equal(id, messageId); return snapshot;
  } });
  equal(calls, 1);
  equal(result, snapshot);
});

test("ausência de plano permanece undefined, sem recompor ou fabricar resposta", async () => {
  equal(await loadMessageResponsePlan(messageId, { async findByMessageId() { return undefined; } }), undefined);
});

test("falha da leitura é propagada sem ser confundida com plano inexistente", async () => {
  const failure = new Error("falha_sintetica");
  await rejects(loadMessageResponsePlan(messageId, { async findByMessageId() { throw failure; } }),
    (error: unknown) => error === failure);
});
