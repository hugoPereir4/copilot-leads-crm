import { z } from "zod";
import type { BusinessProfile } from "../../business-profile/contracts/business-profile.js";
import type { LeadQualification, QualificationSource } from "@copilot-leads/shared";

const nullableText = z.string().trim().min(1).max(200).nullable();
export const qualificationCandidateSchema = z.strictObject({
  intent: z.enum(["agendamento", "informacoes"]).nullable(),
  serviceId: nullableText,
  period: nullableText,
  summary: z.string().trim().min(1).max(500).nullable(),
  needsReview: z.boolean(),
  evidence: z.strictObject({ intent: nullableText, service: nullableText, period: nullableText }),
});
export type QualificationCandidate = z.output<typeof qualificationCandidateSchema>;
export const qualificationResultSchema = z.strictObject({
  intent: z.enum(["agendamento", "informacoes"]).nullable(), serviceId: nullableText, serviceName: nullableText,
  period: nullableText, summary: z.string().trim().min(1).max(500).nullable(), needsReview: z.boolean(),
  source: z.enum(["simulated", "gemini"]), status: z.enum(["qualificado", "revisao", "falha"]),
}).refine((value) => value.status !== "qualificado" || (value.intent === "agendamento" && value.serviceId !== null
  && value.serviceName !== null && value.period !== null), "Qualificação incompleta.")
  .refine((value) => value.status === "qualificado" || value.needsReview, "Revisão obrigatória.");
export type QualificationInput = {
  business: { name: string; services: { id: string; name: string }[] };
  previousMessages: string[];
  currentMessage: string;
  truncated: boolean;
};
export type QualificationProfile = Pick<BusinessProfile, "name" | "services">;
export type QualificationFailureCode = "timeout" | "rate_limited" | "invalid_output" | "qualifier_failure" | "interrupted" | "context_limit";
export type QualificationDiagnosticCategory = "configuration_error" | "network_error" | "timeout" | "http_400" | "http_401" | "http_403"
  | "http_404" | "http_429" | "http_5xx" | "http_other" | "internal_error";
export type QualificationDiagnostic = {
  diagnosticId: string;
  category: QualificationDiagnosticCategory;
  httpStatus?: number;
  providerCode?: string;
  networkCode?: string;
  providerField?: string;
  providerDetail?: "unsupported_schema_field" | "invalid_enum" | "invalid_schema_type" | "required_field_invalid" | "request_field_invalid";
};
export class QualificationError extends Error {
  constructor(readonly code: QualificationFailureCode, readonly diagnostic?: QualificationDiagnostic) {
    super(`Falha de qualificação: ${code}.`);
  }
}
export interface LeadQualifier {
  readonly source: QualificationSource;
  qualify(input: QualificationInput, signal: AbortSignal): Promise<unknown>;
}
export function failedQualification(source: QualificationSource): LeadQualification {
  return { intent: null, serviceId: null, serviceName: null, period: null, summary: null,
    needsReview: true, source, status: "falha" };
}
