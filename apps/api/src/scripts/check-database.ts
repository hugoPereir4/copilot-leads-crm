import { DatabaseConfigurationError, readDatabaseConfig } from "../config/database.js";
import { createDatabasePool } from "../infrastructure/database/pool.js";

async function main(): Promise<void> {
  const config = readDatabaseConfig(process.env);
  const pool = createDatabasePool(config);

  try {
    const result = await pool.query<{ database: string; username: string }>(
      "SELECT current_database() AS database, current_user AS username;",
    );
    const connection = result.rows[0];

    if (connection === undefined) {
      throw new Error("A consulta de conexão não retornou uma linha.");
    }

    console.log(`Conexão validada. Banco: ${connection.database}. Usuário: ${connection.username}.`);
  } finally {
    await pool.end();
  }
}

void main().catch((error: unknown) => {
  console.error(error instanceof DatabaseConfigurationError
    ? error.message
    : "Não foi possível consultar o PostgreSQL. Confira o serviço, o endereço, a porta e as credenciais.");
  process.exitCode = 1;
});
