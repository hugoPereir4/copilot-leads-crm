import { readFile } from "node:fs/promises";
import { readHttpConfig } from "../config/http.js";

async function main() {
  try {
    const config = readHttpConfig(process.env);
    const body = await readFile(new URL("../../examples/simulator/text-message.json", import.meta.url), "utf8");
    const response = await fetch(`http://127.0.0.1:${config.port}/webhooks/simulator`, {
      method: "POST", headers: { "Content-Type": "application/json" }, body,
      signal: AbortSignal.timeout(10000),
    });
    const result: unknown = await response.json();
    console.info(`HTTP ${response.status}: ${JSON.stringify(result)}`);
    if (!response.ok) process.exitCode = 1;
  } catch {
    console.error("Não foi possível enviar o exemplo. Confira API_PORT e se a API está em execução.");
    process.exitCode = 1;
  }
}

void main();
