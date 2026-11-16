import { static as serveStatic, type Express } from "express";
import { fileURLToPath } from "node:url";
import { z } from "zod";
import type { DemoReadModel } from "../modules/simulator/application/demo-read-model.js";
import type { HttpErrorResponder } from "./http-errors.js";

export function installDemoRoutes(app: Express, sendError: HttpErrorResponder, read: DemoReadModel) {
  app.use("/api/demo", (_request, response, next) => { response.setHeader("Cache-Control", "no-store"); next(); });
  app.get("/api/demo/conversations", async (_request, response) => { response.json(await read.conversations()); });
  app.get("/api/demo/conversations/:id/messages", async (request, response) => {
    const id = z.uuid().safeParse(request.params.id);
    if (!id.success) { sendError(response, 400, "invalid_payload", "Conversa inválida."); return; }
    response.json(await read.messages(id.data));
  });
  app.get("/", (_request, response) => { response.redirect("/simulator"); });
  app.get(["/simulator", "/admin"], (_request, response) => {
    response.sendFile(fileURLToPath(new URL("../../../web/index.html", import.meta.url)));
  });
  app.use("/assets", serveStatic(fileURLToPath(new URL("../../../web/dist/", import.meta.url)), { index: false }));
}
