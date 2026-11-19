import { equal, ok, throws } from "node:assert/strict";
import { execFile } from "node:child_process";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import type { Pool } from "pg";
import type { DemoAccess } from "../config/auth.js";
import type { IncomingMessageInbox } from "../modules/messaging/application/incoming-message-inbox.js";
import { createHttpApp } from "./app.js";
import { listenHttp } from "./listen-http.js";
import { escapeHtml, loginPageWithDemoAccess } from "./login-page.js";
import { installPanel } from "./panel.js";

const loginHtml = readFileSync(fileURLToPath(new URL("../../../web/login.html", import.meta.url)), "utf8");
const hostile: DemoAccess = { username: "demo", password: `<script>alert("x")</script>&'` };

test("escape HTML cobre &, <, >, aspas e apóstrofo", () => {
  equal(escapeHtml(`<a href="x">&'</a>`), "&lt;a href=&quot;x&quot;&gt;&amp;&#39;&lt;/a&gt;");
});

test("login.html versionado não contém bloco nem credenciais de demonstração", () => {
  ok(!loginHtml.includes("Acesso de demonstração")); ok(!loginHtml.includes("demo-access"));
});

test("bloco de demonstração entra antes do formulário, com valores escapados", () => {
  const page = loginPageWithDemoAccess(loginHtml, hostile);
  ok(page.indexOf("Acesso de demonstração") < page.indexOf('<form id="login-form"'));
  ok(page.includes("&lt;script&gt;alert(&quot;x&quot;)&lt;/script&gt;&amp;&#39;")); ok(!page.includes(hostile.password));
  equal(page.replace(/<section class="demo-access"[\s\S]*?<\/section>\s*/, ""), loginHtml);
  throws(() => loginPageWithDemoAccess("<html></html>", hostile), /formulário esperado/);
});

async function getLogin(demoAccess?: DemoAccess) {
  const inbox: IncomingMessageInbox = { async register() { throw new Error("não usado"); } };
  // Sem cookie, GET /login não consulta o banco: um pool vazio basta.
  const app = createHttpApp(inbox, () => {}, (express, sendError) => installPanel(express, sendError, {} as Pool,
    { auth: { sessionTtlHours: 12, cookieSecure: false }, log: () => {}, ...(demoAccess ? { demoAccess } : {}) }));
  const server = await listenHttp(app, 0);
  try {
    const address = server.address(); ok(address && typeof address !== "string");
    const response = await fetch(`http://127.0.0.1:${address.port}/login`);
    return { status: response.status, type: response.headers.get("content-type"), cache: response.headers.get("cache-control"), body: await response.text() };
  } finally { await new Promise<void>((resolve) => server.close(() => resolve())); }
}

test("GET /login sem variáveis de demonstração devolve o login.html de hoje", async () => {
  const page = await getLogin();
  equal(page.status, 200); ok(page.type?.startsWith("text/html")); equal(page.cache, "no-store");
  equal(page.body, loginHtml);
});

test("GET /login com variáveis de demonstração mostra o bloco com usuário e senha escapados", async () => {
  const page = await getLogin(hostile);
  equal(page.status, 200); ok(page.type?.startsWith("text/html")); equal(page.cache, "no-store");
  ok(page.body.includes("Acesso de demonstração")); ok(page.body.includes("<code>demo</code>"));
  ok(page.body.includes("&lt;script&gt;")); ok(!page.body.includes(hostile.password));
  const plain = await getLogin({ username: "demo", password: "senha-demo-sintetica" });
  ok(plain.body.includes("<code>senha-demo-sintetica</code>"));
});

test("startup da demonstração falha com só uma variável, sem imprimir o valor", { timeout: 30000 }, async () => {
  const script = fileURLToPath(new URL("../demo.js", import.meta.url));
  const run = (environment: Record<string, string>) => promisify(execFile)(process.execPath, [script],
    { env: { PATH: process.env.PATH ?? "", SystemRoot: process.env.SystemRoot ?? "", ...environment }, timeout: 20000 })
    .then(() => ({ code: 0, stderr: "" }), (error: { code: number; stderr: string }) => ({ code: error.code, stderr: error.stderr }));
  const secret = "senha-demo-sintetica";
  for (const [environment, name] of [[{ DEMO_USERNAME: "demo" }, "DEMO_PASSWORD"], [{ DEMO_PASSWORD: secret }, "DEMO_USERNAME"]] as const) {
    const result = await run(environment);
    equal(result.code, 1); ok(result.stderr.includes("configuration_error")); ok(result.stderr.includes(name)); ok(!result.stderr.includes(secret));
  }
  // Sem as duas, a configuração de demonstração passa; o processo só para depois, na configuração do banco (ausente aqui).
  const none = await run({});
  equal(none.code, 1); ok(!none.stderr.includes("DEMO_")); ok(none.stderr.includes("Configuração da demonstração inválida."));
});
