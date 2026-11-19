import { stdin, stdout } from "node:process";
import { DatabaseConfigurationError, readDatabaseConfig } from "../config/database.js";
import { createDatabasePool } from "../infrastructure/database/pool.js";
import { PostgresAttendantStore } from "../modules/auth/infrastructure/postgres-attendant-store.js";
import { ScryptPasswordHasher } from "../modules/auth/infrastructure/scrypt-password-hasher.js";
import { runAttendantCommand } from "./attendant-admin.js";
import { createPasswordReader, PasswordInputCancelled } from "./terminal-password.js";

// Sem readline: o stdin só é tocado quando a primeira senha é pedida.
// Ctrl+C restaura o terminal (feito pelo leitor) e sai com código 1.
let reader: ((prompt: string) => Promise<string>) | undefined;
const readPassword = (prompt: string) => (reader ??= createPasswordReader(stdin, stdout, () => process.exit(1)))(prompt);

async function main() {
  const pool = createDatabasePool(readDatabaseConfig(process.env));
  try {
    process.exitCode = await runAttendantCommand(process.argv.slice(2), {
      attendants: new PostgresAttendantStore(pool), hasher: new ScryptPasswordHasher(), readPassword,
      out: (line) => console.info(line), err: (line) => console.error(line),
    });
  } finally { await pool.end(); }
}

try { await main(); }
catch (error) {
  console.error(error instanceof DatabaseConfigurationError ? error.message
    : error instanceof PasswordInputCancelled ? error.message
      : "Não foi possível concluir o comando. Confira o PostgreSQL e se a migração de atendentes foi aplicada.");
  process.exitCode = 1;
}
