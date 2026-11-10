import { deepEqual, equal, throws } from "node:assert/strict";
import { test } from "node:test";
import { MessagePayloadSerializationError, serializeMessagePayload } from "./serialize-message-payload.js";

test("serializa objetos e arrays JSON sem alterar o original", () => {
  const payload = { id: "sintetico", nested: [1, true, null, { text: "Olá!" }] };
  const before = structuredClone(payload);
  deepEqual(JSON.parse(serializeMessagePayload(payload)), payload);
  deepEqual(payload, before);
  deepEqual(JSON.parse(serializeMessagePayload(["sintetico", { value: 1 }])), ["sintetico", { value: 1 }]);
});

test("serializa valores JSON primitivos, inclusive null", () => {
  for (const value of [null, "sintetico", 42, false]) {
    equal(JSON.parse(serializeMessagePayload(value)), value);
  }
});

test("rejeita valores que a serialização JSON perderia ou converteria silenciosamente", () => {
  for (const value of [undefined, { value: undefined }, NaN, Infinity, { value: NaN },
    BigInt(1), () => {}, Symbol("sintetico"), new Date("2026-11-09T12:00:00Z")]) {
    throws(() => serializeMessagePayload(value), MessagePayloadSerializationError);
  }
});

test("rejeita payload circular sem expor seu conteúdo no erro", () => {
  const payload: { syntheticMarker: string; self?: unknown } = { syntheticMarker: "conteudo-sintetico" };
  payload.self = payload;
  throws(() => serializeMessagePayload(payload), {
    name: "MessagePayloadSerializationError",
    message: "O payload original da mensagem deve conter apenas valores JSON válidos.",
  });
});
