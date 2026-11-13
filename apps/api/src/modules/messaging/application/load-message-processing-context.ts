import type { MessageProcessingContext } from "../contracts/message-processing-context.js";
import type { MessageProcessingContextReader } from "./message-processing-context-reader.js";

export async function loadMessageProcessingContext(
  messageId: string,
  reader: MessageProcessingContextReader,
): Promise<MessageProcessingContext | undefined> {
  return reader.findByMessageId(messageId);
}
