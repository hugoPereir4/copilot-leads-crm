import { DatabaseConfigurationError, readDatabaseConfig } from "../config/database.js";
import { createDatabasePool } from "../infrastructure/database/pool.js";
import { PostgresAttendantStore } from "../modules/auth/infrastructure/postgres-attendant-store.js";
import { ScryptPasswordHasher } from "../modules/auth/infrastructure/scrypt-password-hasher.js";
import { runSeedDemoCommand } from "./attendant-admin.js";

// Não interativo: lê DEMO_USERNAME e DEMO_PASSWORD do ambiente e não toca no stdin.
async function main() {
  const pool = createDatabasePool(readDatabaseConfig(process.env));
  try {
    process.exitCode = await runSeedDemoCommand(process.env, {
      attendants: new PostgresAttendantStore(pool), hasher: new ScryptPasswordHasher(),
      out: (line) => console.info(line), err: (line) => console.error(line),
    });
  } finally { await pool.end(); }
}

try { await main(); }
catch (error) {
  console.error(error instanceof DatabaseConfigurationError ? error.message
    : "Não foi possível concluir o seed. Confira o PostgreSQL e se a migração de atendentes foi aplicada.");
  process.exitCode = 1;
}
