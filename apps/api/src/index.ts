import type { Pool } from "pg";
import { DatabaseConfigurationError, readDatabaseConfig } from "./config/database.js";
import { HttpConfigurationError, readHttpConfig } from "./config/http.js";
import { createHttpApp } from "./http/app.js";
import { listenHttp } from "./http/listen-http.js";
import { createDatabasePool } from "./infrastructure/database/pool.js";
import { PostgresIncomingMessageInbox } from "./modules/messaging/infrastructure/postgres-incoming-message-inbox.js";

async function main() {
  let pool: Pool | undefined;
  try {
    const httpConfig = readHttpConfig(process.env);
    pool = createDatabasePool(readDatabaseConfig(process.env));
    await pool.query("SELECT 1;");
    const app = createHttpApp(new PostgresIncomingMessageInbox(pool));
    const server = await listenHttp(app, httpConfig.port);
    const activePool = pool;
    let closing = false;
    const shutdown = () => {
      if (closing) return;
      closing = true;
      // Primeiro termina as requisições; depois encerra suas conexões de banco.
      server.close((error) => {
        if (error) process.exitCode = 1;
        void activePool.end().catch(() => {
          console.error("Não foi possível encerrar todas as conexões da API.");
          process.exitCode = 1;
        });
      });
    };
    process.once("SIGINT", shutdown);
    process.once("SIGTERM", shutdown);
    console.info(`API disponível em http://127.0.0.1:${httpConfig.port}`);
  } catch (error) {
    console.error(error instanceof DatabaseConfigurationError || error instanceof HttpConfigurationError
      ? error.message : "Não foi possível iniciar a API. Confira o PostgreSQL e a disponibilidade da porta.");
    process.exitCode = 1;
    try { await pool?.end(); } catch { /* A falha de inicialização já foi informada sem valores sensíveis. */ }
  }
}

void main();
