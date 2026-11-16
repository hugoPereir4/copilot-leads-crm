export interface ReceptionLeadStore {
  upsert(input: { conversationId: string; contactId: string; needsReview: boolean }): Promise<void>;
}
