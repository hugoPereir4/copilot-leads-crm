import type { LeadClosureOutcome, LeadClosureReceipt } from "@copilot-leads/shared";

export type LeadClosureCommand = { leadId: string; result: LeadClosureOutcome };
export type LeadClosureResult = LeadClosureReceipt | { status: "nao_encontrado" | "estado_incompativel" };
export interface LeadClosureStore {
  close(command: LeadClosureCommand): Promise<LeadClosureResult>;
}
