import { randomUUID } from "node:crypto";
import express from "express";
import type { IncomingMessageInbox } from "../modules/messaging/application/incoming-message-inbox.js";
import { createSimulatorWebhookRouter } from "../modules/messaging/http/simulator-webhook-router.js";
import { createHttpErrorHandler, createHttpErrorResponder } from "./http-errors.js";
import type { HttpErrorReporter } from "./http-errors.js";

export function createHttpApp(
  inbox: IncomingMessageInbox,
  reportError: HttpErrorReporter = (event) => console.error(JSON.stringify(event)),
) {
  const app = express();
  const sendError = createHttpErrorResponder(reportError);
  app.disable("x-powered-by");
  app.use((_request, response, next) => {
    response.setHeader("X-Correlation-ID", randomUUID());
    next();
  });
  app.use("/webhooks/simulator", createSimulatorWebhookRouter(inbox, sendError));
  app.use((_request, response) => sendError(response, 404, "route_not_found", "Rota não encontrada."));
  // Middleware de erro tem quatro argumentos e fica depois das rotas.
  app.use(createHttpErrorHandler(sendError));
  return app;
}
