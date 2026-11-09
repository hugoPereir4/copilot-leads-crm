import type { IncomingMessageInbox, IncomingMessageInput, MessageReceipt } from "./incoming-message-inbox.js";

export async function receiveMessage(
  input: IncomingMessageInput,
  inbox: IncomingMessageInbox,
): Promise<MessageReceipt> {
  // Na V1, mídia é registrada, mas não deve gerar processamento na fila.
  return inbox.register({ ...input, enqueueProcessing: input.message.kind === "texto" });
}
