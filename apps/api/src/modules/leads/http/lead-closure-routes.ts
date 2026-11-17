import { json, type Express } from "express";
import type { HttpErrorResponder } from "../../../http/http-errors.js";
import { closeLead } from "../application/close-lead.js";
import type { LeadClosureStore } from "../application/lead-closure-store.js";

export function installLeadClosureRoutes(app: Express, sendError: HttpErrorResponder, store: LeadClosureStore) {
  app.post("/api/demo/leads/:id/close", (request, response, next) => {
    if (!request.is("application/json")) { sendError(response, 415, "unsupported_media_type", "Envie o corpo como application/json."); return; }
    next();
  }, json({ limit: "64kb" }), async (request, response) => {
    try {
      const result = await closeLead(request.params.id, request.body as unknown, store);
      if (result.status === "entrada_invalida") sendError(response, 400, "invalid_payload", "Identificador ou resultado de encerramento inválido.");
      else if (result.status === "nao_encontrado") sendError(response, 404, "lead_not_found", "Lead não encontrado.");
      else if (result.status === "estado_incompativel") sendError(response, 409, "invalid_lead_state", "O estado ou resultado atual não permite este encerramento.");
      else response.status(200).json(result);
    } catch { sendError(response, 500, "lead_closure_failed", "Não foi possível encerrar o atendimento. Tente novamente."); }
  });
}
