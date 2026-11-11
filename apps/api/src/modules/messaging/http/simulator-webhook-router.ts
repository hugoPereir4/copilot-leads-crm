import { Router, json } from "express";
import type { Request } from "express";
import type { HttpErrorResponder } from "../../../http/http-errors.js";
import type { IncomingMessageInbox } from "../application/incoming-message-inbox.js";
import { adaptSimulatorMessage } from "../adapters/simulator-message.js";
import { receiveMessageInput } from "../input/receive-message.js";

export function createSimulatorWebhookRouter(inbox: IncomingMessageInbox, sendError: HttpErrorResponder) {
  const router = Router();
  router.post("/", (request, response, next) => {
    if (!request.is("application/json")) {
      sendError(response, 415, "unsupported_media_type", "Envie o corpo como application/json.");
      return;
    }
    next();
  }, json({ limit: "64kb" }), async (request: Request<Record<string, string>, unknown, unknown>, response) => {
    const original = request.body;
    const adapted = adaptSimulatorMessage(original);
    if (adapted.status === "invalida") {
      sendError(response, 400, "invalid_payload", "Payload do simulador inválido.", adapted.fields);
      return;
    }
    if (adapted.status === "ignorada") {
      response.status(200).json(adapted);
      return;
    }
    const result = await receiveMessageInput(adapted.message, original, inbox);
    if (result.status === "invalida") {
      sendError(response, 400, "invalid_payload", "Mensagem normalizada inválida.", result.fields);
      return;
    }
    // O sucesso só é enviado depois da confirmação da persistência.
    response.status(200).json(result);
  });
  return router;
}
