import { deepEqual, equal, rejects } from "node:assert/strict";
import { test } from "node:test";
import { closeLead } from "./close-lead.js";
import type { LeadClosureResult, LeadClosureStore } from "./lead-closure-store.js";

const id = "AABBCCDD-1234-4123-8123-ABCDEF123456";
test("encerramento valida UUID e body estrito antes da persistência", async () => {
  let calls = 0;
  const store: LeadClosureStore = { async close() { calls++; return { status: "nao_encontrado" }; } };
  for (const body of [undefined, null, [], {}, { result: "outro" }, { result: "ganho", extra: true }, { result: 1 }]) {
    deepEqual(await closeLead(id, body, store), { status: "entrada_invalida" });
  }
  deepEqual(await closeLead("invalido", { result: "ganho" }, store), { status: "entrada_invalida" });
  equal(calls, 0);
});

test("encerramento normaliza UUID e preserva os resultados da porta", async () => {
  const results: LeadClosureResult[] = [{ status: "nao_encontrado" }, { status: "estado_incompativel" },
    ...(["encerrado", "ja_encerrado"] as const).map((status) => ({ status, leadId: id.toLowerCase(), conversationId: id.toLowerCase(),
      result: "ganho" as const, conversationStatus: "encerrada" as const, closedAt: "2026-11-17T12:00:00.000Z" }))];
  for (const result of results) equal(await closeLead(id, { result: "ganho" }, { async close(command) {
    deepEqual(command, { leadId: id.toLowerCase(), result: "ganho" }); return result;
  } }), result);
});

test("encerramento propaga falhas sem devolver sucesso", async () => {
  const error = new Error("Falha sintética");
  await rejects(closeLead(id, { result: "perdido" }, { async close() { throw error; } }), (received) => received === error);
});
