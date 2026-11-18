import { z } from "zod";

const authEnvironmentSchema = z.object({
  SESSION_TTL_HOURS: z.coerce.number().int().min(1).max(24).default(12),
  SESSION_COOKIE_SECURE: z.enum(["true", "false"]).default("false"),
}).transform((environment) => ({
  sessionTtlHours: environment.SESSION_TTL_HOURS,
  cookieSecure: environment.SESSION_COOKIE_SECURE === "true",
}));

export type AuthConfig = z.output<typeof authEnvironmentSchema>;

export class AuthConfigurationError extends Error {
  // Só nomes de variáveis: valores do ambiente nunca entram na mensagem.
  constructor(fields: string[]) {
    super(`Configuração de autenticação inválida. Confira: ${fields.join(", ")}.`);
    this.name = "AuthConfigurationError";
  }
}

export function readAuthConfig(environment: Readonly<Record<string, string | undefined>>): AuthConfig {
  const result = authEnvironmentSchema.safeParse(environment);
  if (!result.success) {
    throw new AuthConfigurationError([...new Set(result.error.issues.map((issue) => String(issue.path[0])))]);
  }
  return result.data;
}
