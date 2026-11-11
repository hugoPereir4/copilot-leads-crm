import { z } from "zod";

const httpEnvironmentSchema = z.object({
  API_PORT: z.coerce.number().int().min(1).max(65535).default(3000),
}).transform((environment) => ({ port: environment.API_PORT }));

export class HttpConfigurationError extends Error {
  constructor() {
    super("Configuração HTTP inválida. Confira: API_PORT.");
    this.name = "HttpConfigurationError";
  }
}

export function readHttpConfig(environment: Readonly<Record<string, string | undefined>>) {
  const result = httpEnvironmentSchema.safeParse(environment);
  if (!result.success) throw new HttpConfigurationError();
  return result.data;
}
