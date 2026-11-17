import { z } from "zod";

const schema = z.object({
  QUALIFIER_PROVIDER: z.enum(["simulated", "gemini"]).default("simulated"),
  GEMINI_API_KEY: z.string().trim().optional(),
  GEMINI_MODEL: z.literal("gemini-3.1-flash-lite").default("gemini-3.1-flash-lite"),
  QUALIFIER_TIMEOUT_MS: z.coerce.number().int().min(100).max(30000).default(8000),
  QUALIFIER_MAX_CONTEXT_CHARS: z.coerce.number().int().min(1000).max(20000).default(8000),
  QUALIFIER_MAX_OUTPUT_CHARS: z.coerce.number().int().min(500).max(12000).default(4000),
}).superRefine((value, context) => {
  if (value.QUALIFIER_PROVIDER === "gemini" && !value.GEMINI_API_KEY) context.addIssue({ code: "custom", path: ["GEMINI_API_KEY"], message: "Obrigatória." });
});
export class QualificationConfigurationError extends Error {
  constructor(fields: string[]) { super(`Configuração do qualificador inválida. Confira: ${fields.join(", ")}.`); }
}
export function readQualificationConfig(environment: Readonly<Record<string, string | undefined>>) {
  const result = schema.safeParse(environment);
  if (!result.success) throw new QualificationConfigurationError([...new Set(result.error.issues.map((issue) => String(issue.path[0])))]);
  return { source: result.data.QUALIFIER_PROVIDER, apiKey: result.data.GEMINI_API_KEY, model: result.data.GEMINI_MODEL,
    timeoutMs: result.data.QUALIFIER_TIMEOUT_MS, maxContextChars: result.data.QUALIFIER_MAX_CONTEXT_CHARS,
    maxOutputChars: result.data.QUALIFIER_MAX_OUTPUT_CHARS };
}
export type QualificationConfig = ReturnType<typeof readQualificationConfig>;
