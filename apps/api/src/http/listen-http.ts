import { once } from "node:events";
import { createServer } from "node:http";
import type { Express } from "express";

export async function listenHttp(app: Express, port: number) {
  const server = createServer(app);
  server.listen(port, "127.0.0.1");
  await once(server, "listening");
  return server;
}
