import { deepEqual, equal, ok, throws } from "node:assert/strict";
import { test } from "node:test";
import { AuthConfigurationError, readAuthConfig } from "./auth.js";

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
