import type { QualificationConfig } from "../../../config/qualification.js";
import type { LeadQualifier, QualificationDiagnostic } from "../contracts/qualification.js";
import { SimulatedLeadQualifier } from "./simulated-lead-qualifier.js";

export type LeadQualifierHooks = { onRetry?: (diagnostic: QualificationDiagnostic) => void };

export async function createLeadQualifier(config: QualificationConfig, hooks: LeadQualifierHooks = {},
  loadGemini = async (): Promise<LeadQualifier> => {
    const { GeminiLeadQualifier } = await import("./gemini-lead-qualifier.js");
    return new GeminiLeadQualifier(config, undefined, hooks.onRetry);
  }): Promise<LeadQualifier> {
  return config.source === "simulated" ? new SimulatedLeadQualifier() : loadGemini();
}
