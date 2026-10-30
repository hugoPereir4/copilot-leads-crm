import { Pool } from "pg";
import type { DatabaseConfig } from "../../config/database.js";

export function createDatabasePool(config: DatabaseConfig): Pool {
  const pool = new Pool({
    ...config,
    application_name: "copilot-leads-api",
    max: 5,
    connectionTimeoutMillis: 5000,
    idleTimeoutMillis: 10000,
    statement_timeout: 5000,
  });

  // Uma conexão ociosa pode cair entre consultas. O pool descarta essa conexão.
  pool.on("error", () => {
    console.error("Uma conexão ociosa com o PostgreSQL foi interrompida.");
  });

  return pool;
}
