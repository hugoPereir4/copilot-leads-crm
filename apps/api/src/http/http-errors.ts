import { randomUUID } from "node:crypto";
import type { ErrorRequestHandler, Response } from "express";

export type HttpErrorEvent = { level: "warn" | "error"; code: string; correlationId: string };
export type HttpErrorReporter = (event: HttpErrorEvent) => void;
export type HttpErrorResponder = (
  response: Response, status: number, code: string, message: string, fields?: readonly string[],
) => void;

export function createHttpErrorResponder(report: HttpErrorReporter): HttpErrorResponder {
  return (response, status, code, message, fields) => {
    const header = response.getHeader("X-Correlation-ID");
    const correlationId = typeof header === "string" ? header : randomUUID();
    response.setHeader("X-Correlation-ID", correlationId);
    report({ level: status >= 500 ? "error" : "warn", code, correlationId });
    response.status(status).json({
      code, message, correlationId, ...(fields === undefined ? {} : { details: { fields } }),
    });
  };
}

export function createHttpErrorHandler(sendError: HttpErrorResponder): ErrorRequestHandler {
  return (error: unknown, _request, response, next) => {
    if (response.headersSent) { next(error); return; }
    const type = error !== null && typeof error === "object" && "type" in error ? error.type : undefined;
    if (type === "entity.parse.failed") {
      sendError(response, 400, "invalid_json", "Corpo JSON inválido.");
    } else if (type === "entity.too.large") {
      sendError(response, 413, "payload_too_large", "Corpo da requisição excede o limite permitido.");
    } else if (type === "charset.unsupported" || type === "encoding.unsupported") {
      sendError(response, 415, "unsupported_media_type", "Codificação do corpo não suportada.");
    } else {
      sendError(response, 500, "internal_error", "Não foi possível receber a mensagem. Tente novamente.");
    }
  };
}
