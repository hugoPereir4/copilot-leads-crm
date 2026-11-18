import { json, type Express, type Response } from "express";
import type { AuthConfig } from "../../../config/auth.js";
import type { HttpErrorResponder } from "../../../http/http-errors.js";
import type { AttendantAuth } from "../application/attendant-auth.js";
import { clearedSessionCookie, sessionCookie, sessionTokenFrom } from "./cookies.js";
import { createRequireSession } from "./require-session.js";

// Nunca contém usuário, senha, hash ou token.
export type AuthLogEvent =
  | { level: "info"; event: "auth_login_succeeded"; attendantId: string; correlationId: string }
  | { level: "warn" | "error"; event: "auth_login_failed"; reason: "invalid_payload" | "invalid_credentials" | "internal_error"; correlationId: string }
  | { level: "error"; event: "auth_logout_failed"; correlationId: string };

const correlationOf = (response: Response) => String(response.getHeader("X-Correlation-ID") ?? "");

export function installAuthRoutes(app: Express, sendError: HttpErrorResponder, auth: AttendantAuth, config: AuthConfig,
  log: (event: AuthLogEvent) => void) {
  app.use("/api/auth", (_request, response, next) => { response.setHeader("Cache-Control", "no-store"); next(); });

  app.post("/api/auth/login", (request, response, next) => {
    if (!request.is("application/json")) { sendError(response, 415, "unsupported_media_type", "Envie o corpo como application/json."); return; }
    next();
  }, json({ limit: "64kb" }), async (request, response) => {
    const correlationId = correlationOf(response);
    try {
      const result = await auth.login(request.body as unknown);
      if (result.status === "entrada_invalida") {
        log({ level: "warn", event: "auth_login_failed", reason: "invalid_payload", correlationId });
        sendError(response, 400, "invalid_payload", "Informe usuário e senha.");
      } else if (result.status === "credenciais_invalidas") {
        log({ level: "warn", event: "auth_login_failed", reason: "invalid_credentials", correlationId });
        sendError(response, 401, "invalid_credentials", "Usuário ou senha inválidos.");
      } else {
        response.setHeader("Set-Cookie", sessionCookie(result.token, config));
        log({ level: "info", event: "auth_login_succeeded", attendantId: result.attendant.id, correlationId });
        response.status(200).json(result.attendant);
      }
    } catch {
      log({ level: "error", event: "auth_login_failed", reason: "internal_error", correlationId });
      sendError(response, 500, "auth_login_failed", "Não foi possível entrar. Tente novamente.");
    }
  });

  app.get("/api/auth/me", createRequireSession(auth, sendError), (_request, response) => {
    response.status(200).json(response.locals.attendant);
  });

  // Idempotente e sem exigir sessão válida: apaga a sessão do cookie, se houver, e sempre limpa o cookie.
  app.post("/api/auth/logout", async (request, response) => {
    try { await auth.logout(sessionTokenFrom(request)); }
    catch { log({ level: "error", event: "auth_logout_failed", correlationId: correlationOf(response) }); }
    response.setHeader("Set-Cookie", clearedSessionCookie(config));
    response.status(204).end();
  });
}
