import { deepEqual, equal, ok, throws } from "node:assert/strict";
import { test } from "node:test";
import { AuthConfigurationError, readAuthConfig, readDemoAccessConfig } from "./auth.js";

test("configuração de autenticação usa padrões seguros para o loopback", () => {
  deepEqual(readAuthConfig({}), { sessionTtlHours: 12, cookieSecure: false });
  deepEqual(readAuthConfig({ SESSION_TTL_HOURS: "1", SESSION_COOKIE_SECURE: "true" }), { sessionTtlHours: 1, cookieSecure: true });
  equal(readAuthConfig({ SESSION_TTL_HOURS: "24", SESSION_COOKIE_SECURE: "false" }).sessionTtlHours, 24);
});

test("configuração de autenticação rejeita valores fora do contrato sem expor o valor", () => {
  for (const [name, value] of [["SESSION_TTL_HOURS", "0"], ["SESSION_TTL_HOURS", "25"], ["SESSION_TTL_HOURS", "1.5"],
    ["SESSION_TTL_HOURS", "valor_sintetico"], ["SESSION_COOKIE_SECURE", "TRUE"], ["SESSION_COOKIE_SECURE", "1"],
    ["SESSION_COOKIE_SECURE", "valor_sintetico"]] as const) {
    throws(() => readAuthConfig({ [name]: value }), (error: unknown) => {
      ok(error instanceof AuthConfigurationError);
      ok(error.message.includes(name)); ok(!error.message.includes("valor_sintetico"));
      return true;
    });
  }
  throws(() => readAuthConfig({ SESSION_TTL_HOURS: "0", SESSION_COOKIE_SECURE: "x" }),
    /SESSION_TTL_HOURS, SESSION_COOKIE_SECURE/);
});

test("acesso de demonstração é opcional: ausente ou vazio desliga o bloco", () => {
  equal(readDemoAccessConfig({}), undefined);
  equal(readDemoAccessConfig({ DEMO_USERNAME: "", DEMO_PASSWORD: "" }), undefined);
  deepEqual(readDemoAccessConfig({ DEMO_USERNAME: " Demo ", DEMO_PASSWORD: " senha sintetica " }),
    { username: "demo", password: " senha sintetica " });
});

test("acesso de demonstração falha com só uma variável ou valor inválido, citando só os nomes", () => {
  const secret = "senha-sintetica-demo";
  for (const [environment, expected] of [
    [{ DEMO_USERNAME: "demo" }, "DEMO_PASSWORD"], [{ DEMO_USERNAME: "demo", DEMO_PASSWORD: "" }, "DEMO_PASSWORD"],
    [{ DEMO_PASSWORD: secret }, "DEMO_USERNAME"], [{ DEMO_USERNAME: "", DEMO_PASSWORD: secret }, "DEMO_USERNAME"],
    [{ DEMO_USERNAME: "demo", DEMO_PASSWORD: "curta-11ch" }, "DEMO_PASSWORD"],
    [{ DEMO_USERNAME: "Nome Invalido!", DEMO_PASSWORD: secret }, "DEMO_USERNAME"],
  ] as const) {
    throws(() => readDemoAccessConfig(environment), (error: unknown) => {
      ok(error instanceof AuthConfigurationError);
      equal(error.message, `Configuração de autenticação inválida. Confira: ${expected}.`);
      ok(!error.message.includes(secret)); ok(!error.message.includes("curta-11ch")); ok(!error.message.includes("Invalido"));
      return true;
    });
  }
});
