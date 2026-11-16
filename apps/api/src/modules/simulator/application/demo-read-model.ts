import type { DemoConversation, DemoMessage } from "@copilot-leads/shared";
export interface DemoReadModel {
  conversations(): Promise<DemoConversation[]>;
  messages(conversationId: string): Promise<DemoMessage[]>;
}
