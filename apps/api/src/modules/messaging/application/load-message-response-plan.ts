import type { MessageResponsePlanSnapshot } from "../contracts/message-response-plan-snapshot.js";
import type { MessageResponsePlanReader } from "./message-response-plan-reader.js";

export async function loadMessageResponsePlan(
  messageId: string,
  reader: MessageResponsePlanReader,
): Promise<MessageResponsePlanSnapshot | undefined> {
  return reader.findByMessageId(messageId);
}
