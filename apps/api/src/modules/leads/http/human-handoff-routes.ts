import type { Express } from "express";
import type { HttpErrorResponder } from "../../../http/http-errors.js";
import { assumeHumanAttendance } from "../application/assume-human-attendance.js";
import type { HumanHandoffStore } from "../application/human-handoff-store.js";

export function installHumanHandoffRoutes(app: Express, sendError: HttpErrorResponder, store: HumanHandoffStore) {
  // Comando sem body: somente o UUID da URL é necessário.
  app.post("/api/demo/leads/:id/assume", async (request, response) => {
    try {
      const result = await assumeHumanAttendance(request.params.id, store);
      if (result.status === "entrada_invalida") {
        sendError(response, 400, "invalid_payload", "Identificador do lead inválido.", ["id"]);
      } else if (result.status === "nao_encontrado") {
        sendError(response, 404, "lead_not_found", "Lead não encontrado.");
      } else if (result.status === "estado_incompativel") {
        sendError(response, 409, "invalid_lead_state", "O estado atual não permite assumir este atendimento.");
      } else { response.status(200).json(result); }
    } catch { sendError(response, 500, "human_handoff_failed", "Não foi possível assumir o atendimento. Tente novamente."); }
  });
}
