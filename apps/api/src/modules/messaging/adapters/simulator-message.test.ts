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

test("profileName é opcional, aparado, vazio vira ausente e aceita até 80 caracteres", () => {
  const name = (value: unknown) => {
    const result = adaptSimulatorMessage({ ...payload, profileName: value });
    ok(result.status === "normalizada");
    return result.message;
  };
  const absent = adaptSimulatorMessage(payload);
  ok(absent.status === "normalizada"); equal("profileName" in absent.message, false);
  equal("profileName" in name("   "), false);
  equal("profileName" in name(""), false);
  equal(name("  Perfil Sintético  ").profileName, "Perfil Sintético");
  const longest = "á".repeat(78) + "🙂🙂"; // 80 code points, 82 unidades UTF-16
  equal(name(`  ${longest}  `).profileName, longest);
});

test("profileName com 81 caracteres ou tipo não texto é rejeitado só pelo caminho, sem ecoar o valor", () => {
  const secret = "N".repeat(81);
  for (const value of [secret, 42, null, ["Nome"], { name: "Nome" }]) {
    const result = adaptSimulatorMessage({ ...payload, profileName: value });
    deepEqual(result, { status: "invalida", fields: ["profileName"] });
  }
  ok(!JSON.stringify(adaptSimulatorMessage({ ...payload, profileName: secret })).includes(secret));
  // Ecos próprios continuam ignorados sem validar nem levar o nome adiante.
  deepEqual(adaptSimulatorMessage({ fromMe: true, profileName: secret }), { status: "ignorada", reason: "mensagem_propria" });
});
