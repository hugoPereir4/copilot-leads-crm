import { z } from "zod";

// O SDK envia httpOptions.timeout ao Google como prazo do servidor; abaixo de 10 s a API responde 400 INVALID_ARGUMENT.
export const GEMINI_MIN_TIMEOUT_MS = 10000;
const geminiTimeoutMessage = `com QUALIFIER_PROVIDER=gemini o mínimo é ${GEMINI_MIN_TIMEOUT_MS} ms (prazo mínimo exigido pelo Google).`;

const schema = z.object({
  QUALIFIER_PROVIDER: z.enum(["simulated", "gemini"]).default("simulated"),
  GEMINI_API_KEY: z.string().trim().optional(),
  GEMINI_MODEL: z.literal("gemini-3.1-flash-lite").default("gemini-3.1-flash-lite"),
  QUALIFIER_TIMEOUT_MS: z.coerce.number().int().min(100).max(30000).default(25000),
  QUALIFIER_MAX_CONTEXT_CHARS: z.coerce.number().int().min(1000).max(20000).default(8000),
  QUALIFIER_MAX_OUTPUT_CHARS: z.coerce.number().int().min(500).max(12000).default(4000),
}).superRefine((value, context) => {
  if (value.QUALIFIER_PROVIDER === "gemini" && !value.GEMINI_API_KEY) context.addIssue({ code: "custom", path: ["GEMINI_API_KEY"], message: "Obrigatória." });
  if (value.QUALIFIER_PROVIDER === "gemini" && value.QUALIFIER_TIMEOUT_MS < GEMINI_MIN_TIMEOUT_MS) {
    context.addIssue({ code: "custom", path: ["QUALIFIER_TIMEOUT_MS"], message: geminiTimeoutMessage });
  }
});
export class QualificationConfigurationError extends Error {
  // Só mensagens próprias (custom) entram no texto; mensagens do Zod e valores recebidos ficam fora para não vazar segredos.
  constructor(fields: string[], details: string[] = []) {
    super(`Configuração do qualificador inválida. Confira: ${fields.join(", ")}.${details.length ? ` ${details.join(" ")}` : ""}`);
  }
}
export function readQualificationConfig(environment: Readonly<Record<string, string | undefined>>) {
  const result = schema.safeParse(environment);
  if (!result.success) {
    const issues = result.error.issues;
    throw new QualificationConfigurationError([...new Set(issues.map((issue) => String(issue.path[0])))],
      issues.filter((issue) => issue.code === "custom" && issue.path[0] === "QUALIFIER_TIMEOUT_MS")
        .map((issue) => `QUALIFIER_TIMEOUT_MS: ${issue.message}`));
  }
  return { source: result.data.QUALIFIER_PROVIDER, apiKey: result.data.GEMINI_API_KEY, model: result.data.GEMINI_MODEL,
    timeoutMs: result.data.QUALIFIER_TIMEOUT_MS, maxContextChars: result.data.QUALIFIER_MAX_CONTEXT_CHARS,
    maxOutputChars: result.data.QUALIFIER_MAX_OUTPUT_CHARS };
}
export type QualificationConfig = ReturnType<typeof readQualificationConfig>;
