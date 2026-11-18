import type { RequestHandler } from "express";
import type { HttpErrorResponder } from "../../../http/http-errors.js";
import type { AttendantAuth } from "../application/attendant-auth.js";
import { sessionTokenFrom } from "./cookies.js";

export const allowedNextPaths = ["/admin", "/simulator"] as const;

// Só caminhos conhecidos: evita redirecionamento aberto para outro site.
export function safeNextPath(value: unknown) {
  return allowedNextPaths.find((path) => path === value) ?? "/admin";
}

// Rotas JSON: sem sessão, 401 no formato de erro padrão. Com sessão, o atendente fica em response.locals.
export function createRequireSession(auth: Pick<AttendantAuth, "authenticate">, sendError: HttpErrorResponder): RequestHandler {
  return async (request, response, next) => {
    try {
      const result = await auth.authenticate(sessionTokenFrom(request));
      if (result.status !== "autenticado") {
        sendError(response, 401, "unauthenticated", "Sessão ausente ou expirada. Entre novamente.");
        return;
      }
      response.locals.attendant = result.attendant;
      next();
    } catch (error) { next(error); }
  };
}

// Páginas: sem sessão, 303 para o login com o retorno permitido.
export function createRequirePageSession(auth: Pick<AttendantAuth, "authenticate">): RequestHandler {
  return async (request, response, next) => {
    try {
      const result = await auth.authenticate(sessionTokenFrom(request));
      if (result.status !== "autenticado") {
        response.redirect(303, `/login?next=${encodeURIComponent(safeNextPath(request.path))}`);
        return;
      }
      response.locals.attendant = result.attendant;
      next();
    } catch (error) { next(error); }
  };
}
