import { deepEqual, equal, ok } from "node:assert/strict";
import { test } from "node:test";
import type { IncomingMessageInbox, MessageRegistration } from "../application/incoming-message-inbox.js";
import { receiveMessageInput } from "./receive-message.js";

const validText = {
  provider: "simulador", externalId: "mensagem-sintetica", phone: "+15550000001",
  receivedAt: new Date("2026-11-05T12:00:00Z"), kind: "texto", text: " Olá! ",
};

test("entrada valida texto, remove campos extras e preserva o original separadamente", async () => {
  const commands: MessageRegistration[] = [];
  const inbox: IncomingMessageInbox = {
    async register(command) {
      commands.push(command);
      return { status: "registrada", messageId: "id-sintetico" };
    },
  };
  const rawPayload = { providerSpecific: { synthetic: true } };
  const input = { ...validText, provider: "outro_simulador", externalId: " id-opaco ", extra: "descartar" };
  deepEqual(await receiveMessageInput(input, rawPayload, inbox), { status: "registrada", messageId: "id-sintetico" });
  deepEqual(commands, [{
    message: { ...validText, provider: "outro_simulador", externalId: " id-opaco " },
    rawPayload, enqueueProcessing: true,
  }]);
  equal(commands[0]?.rawPayload, rawPayload);
  equal(input.extra, "descartar");
});

test("entrada rejeita dados malformados sem chamar a persistência", async () => {
  let calls = 0;
  const inbox: IncomingMessageInbox = {
    async register() { calls += 1; return { status: "registrada", messageId: "id-sintetico" }; },
  };
  const invalidInputs: unknown[] = [
    null, [], {},
    { ...validText, provider: "   " }, { ...validText, externalId: "" },
    { ...validText, externalId: 123 }, { ...validText, phone: "15550000001" },
    { ...validText, phone: "+05550000001" }, { ...validText, phone: "+1 5550000001" },
    { ...validText, receivedAt: "2026-11-05T12:00:00Z" }, { ...validText, receivedAt: new Date(NaN) },
    { ...validText, kind: "imagem" }, { ...validText, text: undefined },
    { ...validText, text: " \n " }, { ...validText, text: 123 },
  ];
  for (const input of invalidInputs) {
    const result = await receiveMessageInput(input, { synthetic: true }, inbox);
    equal(result.status, "invalida");
    ok("fields" in result && result.fields.length > 0);
  }
  equal(calls, 0);
});

test("entrada retorna somente os campos inválidos sem valores ou payload", async () => {
  const inbox: IncomingMessageInbox = {
    async register() { throw new Error("Não deve ser chamado."); },
  };
  const result = await receiveMessageInput({ ...validText, phone: "numero-sintetico-invalido" },
    { privateSyntheticValue: "marcador-sintetico" }, inbox);
  deepEqual(result, { status: "invalida", fields: ["phone"] });
});

test("entrada aceita áudio e outros conteúdos sem texto e descarta texto extra dessas variantes", async () => {
  const commands: MessageRegistration[] = [];
  const inbox: IncomingMessageInbox = {
    async register(command) {
      commands.push(command);
      return { status: "registrada", messageId: "id-sintetico" };
    },
  };
  for (const kind of ["audio", "outro"]) {
    const result = await receiveMessageInput({ ...validText, kind }, { syntheticKind: kind }, inbox);
    equal(result.status, "registrada");
  }
  equal(commands.length, 2);
  for (const command of commands) {
    equal(command.enqueueProcessing, false);
    equal("text" in command.message, false);
  }
});

test("entrada encaminha a resposta de duplicata sem convertê-la em novo registro", async () => {
  const inbox: IncomingMessageInbox = {
    async register() { return { status: "duplicada", messageId: "id-original-sintetico" }; },
  };
  deepEqual(await receiveMessageInput(validText, null, inbox), { status: "duplicada", messageId: "id-original-sintetico" });
});
