import { createInterface } from "node:readline/promises";
import { stdin, stdout } from "node:process";
import { runManualGeminiDiagnostic } from "./diagnose-gemini.js";

const terminal = createInterface({ input: stdin, output: stdout });
try {
  const success = await runManualGeminiDiagnostic(process.env,
    async () => (await terminal.question('Digite "EXECUTAR" para autorizar as chamadas reais: ')).trim() === "EXECUTAR",
    (line) => console.info(line));
  if (!success) process.exitCode = 1;
} finally {
  terminal.close();
}
