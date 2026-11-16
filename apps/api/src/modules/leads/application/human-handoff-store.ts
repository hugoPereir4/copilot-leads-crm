import type { HumanHandoffReceipt } from "@copilot-leads/shared";

export type HumanHandoffResult = HumanHandoffReceipt | { status: "nao_encontrado" | "estado_incompativel" };

export interface HumanHandoffStore {
  assume(leadId: string): Promise<HumanHandoffResult>;
}
