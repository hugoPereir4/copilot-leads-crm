import { deepEqual, throws } from "node:assert/strict";
import { test } from "node:test";
import { HttpConfigurationError, readHttpConfig } from "./http.js";

test("configuração HTTP usa porta padrão e aceita porta explícita", () => {
  deepEqual(readHttpConfig({}), { port: 3000 });
  for (const port of [1, 3001, 65535]) deepEqual(readHttpConfig({ API_PORT: String(port) }), { port });
});

test("configuração HTTP rejeita porta vazia, fracionária ou fora do intervalo", () => {
  for (const API_PORT of ["", "0", "-1", "65536", "3000.5", "invalida"]) {
    throws(() => readHttpConfig({ API_PORT }), HttpConfigurationError);
  }
});

test("erro de configuração HTTP não inclui o valor inválido", () => {
  throws(() => readHttpConfig({ API_PORT: "marcador-sintetico" }), {
    name: "HttpConfigurationError", message: "Configuração HTTP inválida. Confira: API_PORT.",
  });
});
