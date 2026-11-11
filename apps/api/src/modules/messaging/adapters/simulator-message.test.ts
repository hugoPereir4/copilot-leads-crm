import { deepEqual, equal, ok } from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import { adaptSimulatorMessage } from "./simulator-message.js";

const payload = { id: " id-sintetico ", from: "+15550000001", fromMe: false,
  type: "text", body: " Olá! ", timestamp: "2026-11-10T09:00:00-03:00" };

test("adapter traduz texto, preserva IDs e converte data com fuso", () => {
  deepEqual(adaptSimulatorMessage({ ...payload, provider: "nao-confiar", extra: true }), {
    status: "normalizada", message: { provider: "simulador", externalId: payload.id, phone: payload.from,
      kind: "texto", text: payload.body, receivedAt: new Date("2026-11-10T12:00:00Z") },
  });
});

test("adapter traduz áudio e outros conteúdos sem levar texto ao núcleo", () => {
  for (const [type, kind] of [["audio", "audio"], ["other", "outro"]]) {
    const result = adaptSimulatorMessage({ ...payload, type, body: undefined });
    ok(result.status === "normalizada");
    equal(result.message.kind, kind);
    equal("text" in result.message, false);
  }
});

test("adapter ignora mensagem própria sem exigir os campos de mensagem recebida", () => {
  deepEqual(adaptSimulatorMessage({ fromMe: true }), { status: "ignorada", reason: "mensagem_propria" });
});

test("adapter rejeita indicador próprio inválido e campos externos malformados", () => {
  const inputs: unknown[] = [null, [], {}, { ...payload, fromMe: "false" }, { ...payload, id: " " },
    { ...payload, from: "5550000001" }, { ...payload, type: "image" }, { ...payload, body: "  " },
    { ...payload, body: undefined }, { ...payload, timestamp: "2026-11-10T12:00:00" },
    { ...payload, timestamp: "2026-02-30T12:00:00Z" }, { ...payload, timestamp: 123 }];
  for (const input of inputs) equal(adaptSimulatorMessage(input).status, "invalida");
});

test("adapter retorna apenas os nomes dos campos inválidos", () => {
  deepEqual(adaptSimulatorMessage({ ...payload, from: "valor-sintetico-invalido" }), {
    status: "invalida", fields: ["from"],
  });
});

test("exemplo versionado é aceito pelo adapter do simulador", async () => {
  const original: unknown = JSON.parse(await readFile(
    new URL("../../../../examples/simulator/text-message.json", import.meta.url), "utf8"));
  equal(adaptSimulatorMessage(original).status, "normalizada");
});
