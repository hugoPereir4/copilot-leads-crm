import { deepEqual, equal, rejects } from "node:assert/strict";
import { test } from "node:test";
import { assumeHumanAttendance } from "./assume-human-attendance.js";
import type { HumanHandoffStore, HumanHandoffResult } from "./human-handoff-store.js";

test("assunção recusa entrada inválida antes de chamar a persistência", async () => {
  let calls = 0;
  const store: HumanHandoffStore = { async assume() { calls++; return { status: "nao_encontrado" }; } };
  for (const value of [undefined, null, "", "incorreto", 1, {}]) {
    deepEqual(await assumeHumanAttendance(value, store), { status: "entrada_invalida" });
  }
  equal(calls, 0);
});

test("assunção normaliza UUID e preserva todos os resultados da porta", async () => {
  const id = "AABBCCDD-1234-4123-8123-ABCDEF123456";
  const results: HumanHandoffResult[] = [
    { status: "nao_encontrado" }, { status: "estado_incompativel" },
    ...(["assumido", "ja_assumido"] as const).map((status) => ({ status, leadId: id.toLowerCase(),
      conversationId: "aabbccdd-1234-4123-8123-abcdef123457", stage: "em_atendimento" as const,
      conversationStatus: "em_atendimento_humano" as const })),
  ];
  for (const result of results) {
    equal(await assumeHumanAttendance(id, { async assume(received) { equal(received, id.toLowerCase()); return result; } }), result);
  }
});

test("assunção propaga falha da persistência sem fabricar sucesso", async () => {
  const error = new Error("Falha sintética.");
  await rejects(assumeHumanAttendance("aabbccdd-1234-4123-8123-abcdef123456", {
    async assume() { throw error; },
  }), (received) => received === error);
});
