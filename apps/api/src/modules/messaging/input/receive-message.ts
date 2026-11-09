import type { IncomingMessageInbox, MessageReceipt } from "../application/incoming-message-inbox.js";
import { receiveMessage } from "../application/receive-message.js";
import { normalizedMessageSchema } from "../contracts/normalized-message.js";

export type ReceiveMessageInputResult = MessageReceipt | {
  readonly status: "invalida";
  readonly fields: readonly string[];
};

// Entrada interna para adapters; ainda não é controller nem endpoint HTTP.
export async function receiveMessageInput(
  input: unknown,
  rawPayload: unknown,
  inbox: IncomingMessageInbox,
): Promise<ReceiveMessageInputResult> {
  const result = normalizedMessageSchema.safeParse(input);
  if (!result.success) {
    // Retorna apenas caminhos: não expõe texto, payload ou valores inválidos.
    const fields = [...new Set(result.error.issues.map((issue) => issue.path.join(".") || "message"))];
    return { status: "invalida", fields };
  }
  return receiveMessage({ message: result.data, rawPayload }, inbox);
}
