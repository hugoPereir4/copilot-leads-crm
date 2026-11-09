import { deepEqual, equal, rejects } from "node:assert/strict";
import { test } from "node:test";
import type { NormalizedMessage } from "../contracts/normalized-message.js";
import type { IncomingMessageInbox, MessageRegistration } from "./incoming-message-inbox.js";
import { receiveMessage } from "./receive-message.js";

const commonFields = {
  provider: "simulador", externalId: "mensagem-sintetica", phone: "+15550000001",
  receivedAt: new Date("2026-11-05T12:00:00Z"),
};

test("recepção solicita registro e processamento para texto", async () => {
  const commands: MessageRegistration[] = [];
  const inbox: IncomingMessageInbox = {
    async register(command) {
      commands.push(command);
      return { status: "registrada", messageId: "id-sintetico" };
    },
  };
  const message: NormalizedMessage = { ...commonFields, kind: "texto", text: "Olá!" };
  const rawPayload = { simulatedText: "Olá!" };
  const result = await receiveMessage({ message, rawPayload }, inbox);
  deepEqual(commands, [{ message, rawPayload, enqueueProcessing: true }]);
  deepEqual(result, { status: "registrada", messageId: "id-sintetico" });
});

for (const kind of ["audio", "outro"] as const) {
  test(`recepção registra ${kind} sem solicitar processamento`, async () => {
    const commands: MessageRegistration[] = [];
    const inbox: IncomingMessageInbox = {
      async register(command) {
        commands.push(command);
        return { status: "registrada", messageId: "id-sintetico" };
      },
    };
    const message: NormalizedMessage = { ...commonFields, kind };
    await receiveMessage({ message, rawPayload: { syntheticKind: kind } }, inbox);
    equal(commands.length, 1);
    equal(commands[0]?.enqueueProcessing, false);
  });
}

test("recepção preserva o resultado de duplicata informado pela persistência", async () => {
  let calls = 0;
  const inbox: IncomingMessageInbox = {
    async register() {
      calls += 1;
      return { status: "duplicada", messageId: "id-original-sintetico" };
    },
  };
  const message: NormalizedMessage = { ...commonFields, kind: "texto", text: "Olá!" };
  deepEqual(await receiveMessage({ message, rawPayload: null }, inbox),
    { status: "duplicada", messageId: "id-original-sintetico" });
  equal(calls, 1);
});

test("recepção propaga falha da persistência sem retornar sucesso", async () => {
  const failure = new Error("Falha sintética de persistência.");
  const inbox: IncomingMessageInbox = { async register() { throw failure; } };
  const message: NormalizedMessage = { ...commonFields, kind: "texto", text: "Olá!" };
  await rejects(receiveMessage({ message, rawPayload: null }, inbox), (error: unknown) => error === failure);
});
