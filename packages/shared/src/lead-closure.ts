export type LeadClosureOutcome = "ganho" | "perdido";
export type LeadClosureReceipt = {
  status: "encerrado" | "ja_encerrado";
  leadId: string;
  conversationId: string;
  result: LeadClosureOutcome;
  conversationStatus: "encerrada";
  closedAt: string;
};
