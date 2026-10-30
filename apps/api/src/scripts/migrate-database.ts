import { fileURLToPath } from "node:url";
import { runner } from "node-pg-migrate";
import { DatabaseConfigurationError, readDatabaseConfig } from "../config/database.js";

async function main(): Promise<void> {
  const config = readDatabaseConfig(process.env);
  const migrations = await runner({
    databaseUrl: {
      ...config,
      application_name: "copilot-leads-migrations",
      connectionTimeoutMillis: 5000,
    },
    dir: fileURLToPath(new URL("../../migrations/", import.meta.url)),
    direction: "up",
    schema: "public",
    migrationsTable: "pgmigrations",
    checkOrder: true,
    singleTransaction: true,
    logger: {
      info: (message) => console.log(message),
      warn: () => console.warn("Aviso durante a execução das migrações."),
      error: () => console.error("A ferramenta de migrações encontrou uma falha."),
    },
  });

  console.log(`Migrações aplicadas nesta execução: ${migrations.length}.`);
}

void main().catch((error: unknown) => {
  console.error(error instanceof DatabaseConfigurationError
    ? error.message
    : "Não foi possível executar as migrações. Confira a conexão e os arquivos de migração.");
  process.exitCode = 1;
});
