export type HumanHandoffReceipt = {
  status: "assumido" | "ja_assumido";
  leadId: string;
  conversationId: string;
  stage: "em_atendimento";
  conversationStatus: "em_atendimento_humano";
};
