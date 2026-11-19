export type DemoConversation = {
  id: string; phone: string; status: string; failedJobs: number;
  // Nome de perfil do WhatsApp informado pelo provedor; null quando ausente.
  contactName: string | null;
  lead: { id: string; stage: string; needsReview: boolean; summary: string | null;
    qualification: import("./qualification.js").LeadQualification | null } | null;
};
export type DemoMessage = {
  id: string; direction: "entrada" | "saida"; senderType: string; kind: string;
  body: string | null; createdAt: string;
};
