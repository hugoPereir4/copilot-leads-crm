import { z } from "zod";
import { passwordSchema, usernameSchema } from "../modules/auth/contracts/attendant.js";

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

// Acesso de demonstração (opcional). As credenciais são públicas por design: aparecem na tela de login.
// Vazio conta como ausente. Só uma das duas definida, ou valor fora do contrato, falha no startup
// com os nomes das variáveis, nunca os valores.
export type DemoAccess = { username: string; password: string };

export function readDemoAccessConfig(environment: Readonly<Record<string, string | undefined>>): DemoAccess | undefined {
  const rawUsername = environment.DEMO_USERNAME === "" ? undefined : environment.DEMO_USERNAME;
  const rawPassword = environment.DEMO_PASSWORD === "" ? undefined : environment.DEMO_PASSWORD;
  if (rawUsername === undefined && rawPassword === undefined) return undefined;
  const username = rawUsername === undefined ? undefined : usernameSchema.safeParse(rawUsername);
  const password = rawPassword === undefined ? undefined : passwordSchema.safeParse(rawPassword);
  const fields = [...(username?.success ? [] : ["DEMO_USERNAME"]), ...(password?.success ? [] : ["DEMO_PASSWORD"])];
  if (!username?.success || !password?.success) throw new AuthConfigurationError(fields);
  return { username: username.data, password: password.data };
}
