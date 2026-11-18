import type { RequestHandler } from "express";
import type { HttpErrorResponder } from "../../../http/http-errors.js";

// CSRF por checagem de Origin: o navegador envia Origin em requisições que alteram estado.
// Sem Origin (curl, Postman, testes), a requisição passa; o cookie SameSite=Lax cobre o resto.
export function createOriginGuard(sendError: HttpErrorResponder): RequestHandler {
  return (request, response, next) => {
    if (request.method === "GET" || request.method === "HEAD") { next(); return; }
    const origin = request.get("origin");
    if (origin !== undefined && origin !== `http://${request.get("host") ?? ""}`) {
      sendError(response, 403, "forbidden_origin", "Origem da requisição não permitida.");
      return;
    }
    next();
  };
}
