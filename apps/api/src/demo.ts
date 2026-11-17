import { readDatabaseConfig } from "./config/database.js";
import { readHttpConfig } from "./config/http.js";
import { createHttpApp } from "./http/app.js";
import { installDemoRoutes } from "./http/demo-routes.js";
import { listenHttp } from "./http/listen-http.js";
import { createDatabasePool } from "./infrastructure/database/pool.js";
import { PostgresDemoReadModel } from "./infrastructure/simulator/postgres-demo-read-model.js";
import { PostgresSimulatorEffects } from "./infrastructure/simulator/postgres-simulator-effects.js";
import { JsonBusinessProfileReader } from "./modules/business-profile/infrastructure/json-business-profile-reader.js";
import { recoverExpiredJobs } from "./modules/jobs/application/recover-expired-jobs.js";
import { PostgresJobQueue } from "./modules/jobs/infrastructure/postgres-job-queue.js";
import { PostgresIncomingMessageInbox } from "./modules/messaging/infrastructure/postgres-incoming-message-inbox.js";
import { PostgresMessageProcessingContextReader } from "./modules/messaging/infrastructure/postgres-message-processing-context-reader.js";
import { PostgresMessageResponsePlanReader } from "./modules/messaging/infrastructure/postgres-message-response-plan-reader.js";
import { PostgresMessageResponsePlanStore } from "./modules/messaging/infrastructure/postgres-message-response-plan-store.js";
import { SimulatorProcessor } from "./modules/simulator/application/simulator-processor.js";
import { PostgresHumanHandoffStore } from "./modules/leads/infrastructure/postgres-human-handoff-store.js";
import { installHumanHandoffRoutes } from "./modules/leads/http/human-handoff-routes.js";
import { installLeadClosureRoutes } from "./modules/leads/http/lead-closure-routes.js";
import { PostgresLeadClosureStore } from "./modules/leads/infrastructure/postgres-lead-closure-store.js";
import { readQualificationConfig, QualificationConfigurationError } from "./config/qualification.js";
import { createLeadQualifier } from "./modules/leads/infrastructure/create-lead-qualifier.js";
import { QualifyMessage } from "./modules/leads/application/qualify-message.js";
import { PostgresQualificationExecutionStore } from "./modules/leads/infrastructure/postgres-qualification-execution-store.js";

async function main() {
  const qualificationConfig = readQualificationConfig(process.env);
  const qualifier = await createLeadQualifier(qualificationConfig);
  const pool = createDatabasePool(readDatabaseConfig(process.env));
  try {
    // Falhar antes de consumir jobs se a migração da entrega não foi aplicada.
    await pool.query("SELECT id FROM public.leads LIMIT 0;");
    await pool.query("SELECT message_id FROM public.qualification_runs LIMIT 0;");
    const queue = new PostgresJobQueue(pool, true);
    const processor = new SimulatorProcessor({ queue, profile: new JsonBusinessProfileReader(),
      contexts: new PostgresMessageProcessingContextReader(pool), plans: new PostgresMessageResponsePlanReader(pool),
      planStore: new PostgresMessageResponsePlanStore(pool), effects: new PostgresSimulatorEffects(pool),
      qualification: new QualifyMessage(new PostgresQualificationExecutionStore(pool), qualifier, qualificationConfig),
      report: (jobId, code) => console.error(JSON.stringify({ level: "warn", code, jobId })),
    });
    const read = new PostgresDemoReadModel(pool);
    const app = createHttpApp(new PostgresIncomingMessageInbox(pool), undefined,
      (app, sendError) => {
        installDemoRoutes(app, sendError, read);
        installHumanHandoffRoutes(app, sendError, new PostgresHumanHandoffStore(pool));
        installLeadClosureRoutes(app, sendError, new PostgresLeadClosureStore(pool));
      });
    const server = await listenHttp(app, readHttpConfig(process.env).port);
    let stopping = false;
    const worker = (async () => {
      let nextRecovery = 0;
      while (!stopping) {
        try {
          if (Date.now() >= nextRecovery) {
            await recoverExpiredJobs(queue); nextRecovery = Date.now() + 30000;
          }
          if (await processor.processOne()) continue;
        } catch { console.error(JSON.stringify({ level: "error", code: "simulator_worker_unavailable" })); }
        await new Promise((resolve) => setTimeout(resolve, 250));
      }
    })();
    const stop = () => {
      if (stopping) return;
      stopping = true;
      server.close(() => { void worker.then(() => pool.end()).catch(() => { process.exitCode = 1; }); });
    };
    process.once("SIGINT", stop); process.once("SIGTERM", stop);
    console.info(`Demonstração local: http://127.0.0.1:${readHttpConfig(process.env).port}/simulator e /admin`);
  } catch {
    await pool.end();
    console.error("Não foi possível iniciar a demonstração. Confira PostgreSQL, migrações de leads/qualificação e porta HTTP.");
    process.exitCode = 1;
  }
}
void main().catch((error: unknown) => { console.error(error instanceof QualificationConfigurationError ? error.message : "Configuração da demonstração inválida."); process.exitCode = 1; });
