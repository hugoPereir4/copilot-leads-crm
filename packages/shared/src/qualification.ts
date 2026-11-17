export type QualificationSource = "simulated" | "gemini";
export type LeadQualification = {
  intent: "agendamento" | "informacoes" | null;
  serviceId: string | null;
  serviceName: string | null;
  period: string | null;
  summary: string | null;
  needsReview: boolean;
  source: QualificationSource;
  status: "processando" | "qualificado" | "revisao" | "falha";
};
