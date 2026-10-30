import { z } from "zod";

const databaseEnvironmentSchema = z.object({
  POSTGRES_HOST: z.string().trim().min(1).default("127.0.0.1"),
  POSTGRES_PORT: z.coerce.number().int().min(1).max(65535).default(5432),
  POSTGRES_DB: z.string().trim().min(1),
  POSTGRES_USER: z.string().trim().min(1),
  POSTGRES_PASSWORD: z.string().min(1),
}).transform((environment) => ({
  host: environment.POSTGRES_HOST,
  port: environment.POSTGRES_PORT,
  database: environment.POSTGRES_DB,
  user: environment.POSTGRES_USER,
  password: environment.POSTGRES_PASSWORD,
}));

export type DatabaseConfig = z.output<typeof databaseEnvironmentSchema>;

export class DatabaseConfigurationError extends Error {
  constructor(fields: readonly string[]) {
    super(`Configuração do PostgreSQL inválida. Confira: ${fields.join(", ")}.`);
    this.name = "DatabaseConfigurationError";
  }
}

// Receber o ambiente como argumento permite validar sem abrir uma conexão.
export function readDatabaseConfig(
  environment: Readonly<Record<string, string | undefined>>,
): DatabaseConfig {
  const result = databaseEnvironmentSchema.safeParse(environment);

  if (!result.success) {
    const fields = [...new Set(result.error.issues.map((issue) => String(issue.path[0])))];
    // Informamos os nomes dos campos, sem incluir seus valores ou a senha.
    throw new DatabaseConfigurationError(fields);
  }

  return result.data;
}
