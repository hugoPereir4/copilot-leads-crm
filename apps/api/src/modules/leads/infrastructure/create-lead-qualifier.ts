import type { QualificationConfig } from "../../../config/qualification.js";
import type { LeadQualifier } from "../contracts/qualification.js";
import { SimulatedLeadQualifier } from "./simulated-lead-qualifier.js";

export async function createLeadQualifier(config: QualificationConfig,
  loadGemini = async (): Promise<LeadQualifier> => {
    const { GeminiLeadQualifier } = await import("./gemini-lead-qualifier.js");
    return new GeminiLeadQualifier(config);
  }): Promise<LeadQualifier> {
  return config.source === "simulated" ? new SimulatedLeadQualifier() : loadGemini();
}
