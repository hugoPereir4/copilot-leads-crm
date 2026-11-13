import { equal, rejects } from "node:assert/strict";
import { test } from "node:test";
import type { MessageProcessingContext } from "../contracts/message-processing-context.js";
import { loadMessageProcessingContext } from "./load-message-processing-context.js";
import type { MessageProcessingContextReader } from "./message-processing-context-reader.js";

const messageId = "00000000-0000-4000-8000-000000000001";

test("carga de contexto consulta o ID recebido e preserva o resultado da porta", async () => {
  let received: string | undefined;
  const context: MessageProcessingContext = {
    message: {
      id: messageId, provider: "simulador", externalId: "contexto-sintetico",
      direction: "entrada", senderType: "contato", kind: "texto", body: "Mensagem sintética",
      createdAt: new Date("2026-11-13T12:00:00Z"),
    },
    conversation: { id: "00000000-0000-4000-8000-000000000002", status: "em_atendimento_humano" },
    contact: { id: "00000000-0000-4000-8000-000000000003", phone: "+15550114913", displayName: null },
  };
  const reader: MessageProcessingContextReader = {
    async findByMessageId(id) { received = id; return context; },
  };
  equal(await loadMessageProcessingContext(messageId, reader), context);
  equal(received, messageId);
});

test("mensagem inexistente preserva ausência de contexto sem fabricar dados", async () => {
  const reader: MessageProcessingContextReader = { async findByMessageId() { return undefined; } };
  equal(await loadMessageProcessingContext(messageId, reader), undefined);
});

test("carga de contexto propaga falhas sem confundir indisponibilidade com ausência", async () => {
  const failure = new Error("Falha sintética de leitura.");
  const reader: MessageProcessingContextReader = { async findByMessageId() { throw failure; } };
  await rejects(loadMessageProcessingContext(messageId, reader), (error: unknown) => error === failure);
});
