import { createInterface } from "node:readline/promises";
import { stdin, stdout } from "node:process";
import { Writable } from "node:stream";
import { DatabaseConfigurationError, readDatabaseConfig } from "../config/database.js";
import { createDatabasePool } from "../infrastructure/database/pool.js";
import { PostgresAttendantStore } from "../modules/auth/infrastructure/postgres-attendant-store.js";
import { ScryptPasswordHasher } from "../modules/auth/infrastructure/scrypt-password-hasher.js";
import { runAttendantCommand } from "./attendant-admin.js";

// O readline escreve o que é digitado na saída; enquanto a senha é lida, essa saída é descartada.
let muted = false;
const output = new Writable({ write(chunk, _encoding, callback) { if (!muted) stdout.write(chunk); callback(); } });
const terminal = createInterface({ input: stdin, output, terminal: stdin.isTTY === true });

async function readPassword(prompt: string) {
  stdout.write(prompt);
  muted = true;
  try { return await terminal.question(""); }
  finally { muted = false; stdout.write("\n"); }
}

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
    : "Não foi possível concluir o comando. Confira o PostgreSQL e se a migração de atendentes foi aplicada.");
  process.exitCode = 1;
} finally { terminal.close(); }
