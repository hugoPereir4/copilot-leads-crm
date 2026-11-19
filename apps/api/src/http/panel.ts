import { static as serveStatic, type Express, type RequestHandler } from "express";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import type { Pool } from "pg";
import type { AuthConfig, DemoAccess } from "../config/auth.js";
import { PostgresDemoReadModel } from "../infrastructure/simulator/postgres-demo-read-model.js";
import { createAttendantAuth } from "../modules/auth/application/attendant-auth.js";
import type { Clock, PasswordHasher } from "../modules/auth/application/ports.js";
import { installAuthRoutes, type AuthLogEvent } from "../modules/auth/http/auth-routes.js";
import { sessionTokenFrom } from "../modules/auth/http/cookies.js";
import { createOriginGuard } from "../modules/auth/http/origin-guard.js";
import { createRequirePageSession, createRequireSession, safeNextPath } from "../modules/auth/http/require-session.js";
import { PostgresAttendantStore } from "../modules/auth/infrastructure/postgres-attendant-store.js";
import { PostgresSessionStore } from "../modules/auth/infrastructure/postgres-session-store.js";
import { ScryptPasswordHasher } from "../modules/auth/infrastructure/scrypt-password-hasher.js";
import { sessionTokens } from "../modules/auth/infrastructure/session-tokens.js";
import { installHumanHandoffRoutes } from "../modules/leads/http/human-handoff-routes.js";
import { installLeadClosureRoutes } from "../modules/leads/http/lead-closure-routes.js";
import { PostgresHumanHandoffStore } from "../modules/leads/infrastructure/postgres-human-handoff-store.js";
import { PostgresLeadClosureStore } from "../modules/leads/infrastructure/postgres-lead-closure-store.js";
import { installDemoRoutes } from "./demo-routes.js";
import type { HttpErrorResponder } from "./http-errors.js";
import { loginPageWithDemoAccess } from "./login-page.js";

export type PanelOptions = {
  auth: AuthConfig;
  // Só os testes trocam hasher e relógio; a composição continua a mesma.
  hasher?: PasswordHasher;
  clock?: Clock;
  log?: (event: AuthLogEvent) => void;
  // Opcional: mostra usuário e senha de demonstração na tela de login (readDemoAccessConfig).
  demoAccess?: DemoAccess;
};

const webFile = (path: string) => fileURLToPath(new URL(`../../../web/${path}`, import.meta.url));

// Composição única do painel (autenticação, páginas e rotas JSON), usada por demo.ts e pela suíte de integração.
// O webhook continua fora daqui e aberto, instalado por createHttpApp.
export function installPanel(app: Express, sendError: HttpErrorResponder, pool: Pool, options: PanelOptions) {
  const log = options.log ?? ((event) => (event.level === "info" ? console.info : console.error)(JSON.stringify(event)));
  const auth = createAttendantAuth({ attendants: new PostgresAttendantStore(pool), sessions: new PostgresSessionStore(pool),
    hasher: options.hasher ?? new ScryptPasswordHasher(), tokens: sessionTokens, clock: options.clock ?? (() => new Date()),
    sessionTtlHours: options.auth.sessionTtlHours });

  // CSRF: antes de qualquer rota sob /api.
  app.use("/api", createOriginGuard(sendError));
  installAuthRoutes(app, sendError, auth, options.auth, log);

  // Páginas autenticadas não ficam no cache: depois do logout, voltar não mostra o painel.
  const noStore: RequestHandler = (_request, response, next) => { response.setHeader("Cache-Control", "no-store"); next(); };
  // Sem acesso de demonstração, /login continua servindo o arquivo como antes.
  const demoLoginPage = options.demoAccess ? loginPageWithDemoAccess(readFileSync(webFile("login.html"), "utf8"), options.demoAccess) : undefined;
  app.get("/", (_request, response) => { response.redirect("/simulator"); });
  app.get("/login", noStore, async (request, response, next) => {
    try {
      const session = await auth.authenticate(sessionTokenFrom(request));
      if (session.status === "autenticado") { response.redirect(303, safeNextPath(request.query.next)); return; }
      if (demoLoginPage === undefined) response.sendFile(webFile("login.html"));
      else response.type("html").send(demoLoginPage);
    } catch (error) { next(error); }
  });
  app.get(["/simulator", "/admin"], noStore, createRequirePageSession(auth), (_request, response) => {
    response.sendFile(webFile("index.html"));
  });
  app.use("/assets", serveStatic(webFile("dist/"), { index: false }));

  app.use("/api/demo", createRequireSession(auth, sendError));
  installDemoRoutes(app, sendError, new PostgresDemoReadModel(pool));
  installHumanHandoffRoutes(app, sendError, new PostgresHumanHandoffStore(pool));
  installLeadClosureRoutes(app, sendError, new PostgresLeadClosureStore(pool));
}
