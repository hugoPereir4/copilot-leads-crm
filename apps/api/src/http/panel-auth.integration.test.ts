import { deepEqual, equal, match, ok } from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { Client } from "pg";
import { readDatabaseConfig } from "../config/database.js";
import { createDatabasePool } from "../infrastructure/database/pool.js";
import { createAttendant } from "../modules/auth/application/manage-attendants.js";
import type { AuthLogEvent } from "../modules/auth/http/auth-routes.js";
import { PostgresAttendantStore } from "../modules/auth/infrastructure/postgres-attendant-store.js";
import { ScryptPasswordHasher } from "../modules/auth/infrastructure/scrypt-password-hasher.js";
import { PostgresIncomingMessageInbox } from "../modules/messaging/infrastructure/postgres-incoming-message-inbox.js";
import { runAttendantCommand } from "../scripts/attendant-admin.js";
import { createHttpApp } from "./app.js";
import { listenHttp } from "./listen-http.js";
import { installPanel } from "./panel.js";

// Mesma composição do demo.ts (installPanel); só hasher, relógio e log são trocados.
test("autenticação do painel por HTTP em banco descartável", { timeout: 60000 }, async (t) => {
  const { runner } = await import("node-pg-migrate");
  const config = readDatabaseConfig(process.env);
  if (!["localhost", "127.0.0.1", "::1"].includes(config.host)) throw new Error("Teste exige PostgreSQL local.");
  const database = `copilot_auth_test_${randomUUID().replaceAll("-", "")}`;
  const admin = new Client({ ...config, connectionTimeoutMillis: 5000 });
  const pool = createDatabasePool({ ...config, database });
  const hasher = new ScryptPasswordHasher({ logN: 10, r: 8, p: 1, maxmem: 32 * 1024 * 1024 });
  const attendants = new PostgresAttendantStore(pool);
  const password = "senha-sintetica-auth";
  const events: AuthLogEvent[] = [];
  let offset = 0;
  let created = false;
  let server: Awaited<ReturnType<typeof listenHttp>> | undefined;
  let url = "", host = "";

  const login = (body: unknown, headers: Record<string, string> = {}) => fetch(`${url}/api/auth/login`, {
    method: "POST", headers: { "Content-Type": "application/json", ...headers }, body: typeof body === "string" ? body : JSON.stringify(body) });
  async function session(username = "atendente.teste", secret = password) {
    const response = await login({ username, password: secret }); equal(response.status, 200);
    const cookie = response.headers.get("set-cookie")?.split(";")[0];
    if (!cookie) throw new Error("Login sem cookie.");
    return cookie;
  }
  const get = (path: string, cookie?: string) => fetch(`${url}${path}`, { redirect: "manual", ...(cookie ? { headers: { Cookie: cookie } } : {}) });

  try {
    await admin.connect(); await admin.query(`CREATE DATABASE "${database}" TEMPLATE template0;`); created = true;
    const client = new Client({ ...config, database, connectionTimeoutMillis: 5000 });
    try {
      await client.connect();
      await runner({ dbClient: client, dir: fileURLToPath(new URL("../../migrations/", import.meta.url)), direction: "up",
        schema: "public", migrationsTable: "pgmigrations", checkOrder: true, singleTransaction: true,
        logger: { info: () => {}, warn: () => {}, error: () => {} } });
    } finally { await client.end(); }
    server = await listenHttp(createHttpApp(new PostgresIncomingMessageInbox(pool), () => {},
      (app, sendError) => installPanel(app, sendError, pool, { auth: { sessionTtlHours: 12, cookieSecure: false }, hasher,
        clock: () => new Date(Date.now() + offset), log: (event) => events.push(event) })), 0);
    const address = server.address(); ok(address && typeof address !== "string");
    host = `127.0.0.1:${address.port}`; url = `http://${host}`;
    equal((await createAttendant({ username: "atendente.teste", displayName: "Atendente Sintético", password }, { attendants, hasher })).status, "criado");
    t.beforeEach(() => { offset = 0; events.length = 0; });

    await t.test("login certo devolve o atendente e um cookie de sessão com os atributos esperados", async () => {
      const response = await login({ username: " ATENDENTE.TESTE ", password });
      equal(response.status, 200); equal(response.headers.get("cache-control"), "no-store");
      const body = await response.json() as Record<string, unknown>;
      deepEqual(Object.keys(body).sort(), ["displayName", "id", "username"]);
      equal(body.username, "atendente.teste"); equal(body.displayName, "Atendente Sintético");
      const cookie = response.headers.get("set-cookie") ?? "";
      match(cookie, /^copilot_session=[A-Za-z0-9_-]{43}; HttpOnly; SameSite=Lax; Path=\/; Max-Age=43200$/);
      const token = cookie.split(";")[0]!.slice("copilot_session=".length);
      const stored = await pool.query<{ token_hash: Buffer }>("SELECT token_hash FROM public.attendant_sessions WHERE attendant_id = $1;", [body.id]);
      ok(stored.rows.some((row) => row.token_hash.equals(createHash("sha256").update(token).digest())));
      ok(!stored.rows.some((row) => row.token_hash.toString("utf8").includes(token)));
      deepEqual(events.map((event) => event.event), ["auth_login_succeeded"]);
      ok(!JSON.stringify(events).includes(token) && !JSON.stringify(events).includes(password) && !JSON.stringify(events).includes("atendente.teste"));
      const me = await get("/api/auth/me", cookie.split(";")[0]); equal(me.status, 200);
      deepEqual(await me.json(), body);
    });

    await t.test("senha errada e usuário inexistente recebem o mesmo 401; corpo inválido recebe 400, 413 ou 415", async () => {
      const bodies = [];
      for (const credentials of [{ username: "atendente.teste", password: "senha-errada-123" }, { username: "inexistente", password }, { username: "x", password: "curta" }]) {
        const response = await login(credentials); equal(response.status, 401); equal(response.headers.get("set-cookie"), null);
        const body = await response.json() as { code: string; message: string; correlationId: string };
        equal(body.correlationId, response.headers.get("x-correlation-id"));
        bodies.push({ code: body.code, message: body.message });
      }
      deepEqual(bodies, Array(3).fill({ code: "invalid_credentials", message: "Usuário ou senha inválidos." }));
      deepEqual(events.map((event) => [event.event, "reason" in event ? event.reason : undefined]), Array(3).fill(["auth_login_failed", "invalid_credentials"]));
      ok(!JSON.stringify(events).includes("inexistente") && !JSON.stringify(events).includes("senha-errada"));
      for (const body of [{}, { username: "atendente.teste" }, { username: "atendente.teste", password, extra: true }, [], { username: 1, password }]) {
        const response = await login(body); equal(response.status, 400); equal((await response.json() as { code: string }).code, "invalid_payload");
      }
      // JSON malformado ou primitivo é recusado pelo parser, como na rota de encerramento.
      for (const raw of ["{\"username\":", "\"texto\""]) {
        const response = await login(raw); equal(response.status, 400); equal((await response.json() as { code: string }).code, "invalid_json");
      }
      equal((await login(JSON.stringify({ username: "atendente.teste", password: "x".repeat(70_000) }))).status, 413);
      equal((await fetch(`${url}/api/auth/login`, { method: "POST", headers: { "Content-Type": "text/plain" }, body: "atendente.teste" })).status, 415);
    });

    await t.test("rotas de /api/demo e /api/auth/me exigem sessão: 401 sem cookie e com token alterado", async () => {
      const id = randomUUID();
      const cookie = await session(); const token = cookie.split("=")[1]!;
      const altered = `copilot_session=${token.slice(0, -1)}${token.endsWith("A") ? "B" : "A"}`;
      for (const [method, path, body] of [["GET", "/api/demo/conversations"], ["GET", `/api/demo/conversations/${id}/messages`],
        ["POST", `/api/demo/leads/${id}/assume`], ["POST", `/api/demo/leads/${id}/close`, "{\"result\":\"ganho\"}"], ["GET", "/api/auth/me"]] as const) {
        for (const credential of [undefined, altered, "copilot_session=malformado", `outro=${token}`]) {
          const response = await fetch(`${url}${path}`, { method, headers: { "Content-Type": "application/json", ...(credential ? { Cookie: credential } : {}) },
            ...(body ? { body } : {}) });
          equal(response.status, 401, `${method} ${path} ${credential ?? "sem cookie"}`);
          const error = await response.json() as { code: string; correlationId: string };
          equal(error.code, "unauthenticated"); equal(error.correlationId, response.headers.get("x-correlation-id"));
        }
      }
      equal((await get("/api/demo/conversations", cookie)).status, 200);
      equal((await fetch(`${url}/api/demo/leads/${id}/assume`, { method: "POST", headers: { Cookie: cookie } })).status, 404);
    });

    await t.test("páginas protegidas redirecionam para o login com next permitido; /login com sessão redireciona", async () => {
      for (const path of ["/admin", "/simulator"]) {
        const response = await get(path); equal(response.status, 303);
        equal(response.headers.get("location"), `/login?next=${encodeURIComponent(path)}`);
      }
      const page = await get("/login"); equal(page.status, 200); ok((await page.text()).includes("Entrar no painel"));
      equal(page.headers.get("cache-control"), "no-store");
      const cookie = await session();
      for (const path of ["/admin", "/simulator"]) {
        const response = await get(path, cookie); equal(response.status, 200); ok((await response.text()).includes("Copilot Leads"));
      }
      for (const [next, location] of [["", "/admin"], ["?next=%2Fsimulator", "/simulator"], ["?next=%2Fadmin", "/admin"],
        ["?next=https%3A%2F%2Fevil.example", "/admin"], ["?next=%2F%2Fevil.example", "/admin"], ["?next=%2Fsimulator&next=%2Fadmin", "/admin"]]) {
        const response = await get(`/login${next}`, cookie); equal(response.status, 303); equal(response.headers.get("location"), location);
      }
      equal((await get("/")).headers.get("location"), "/simulator");
      equal((await get("/assets/login.js")).status, 200); equal((await get("/assets/styles/login.css")).status, 200);
    });

    await t.test("logout invalida a sessão, limpa o cookie e é idempotente", async () => {
      const cookie = await session(); const other = await session();
      const logout = await fetch(`${url}/api/auth/logout`, { method: "POST", headers: { Cookie: cookie } });
      equal(logout.status, 204); equal(logout.headers.get("set-cookie"), "copilot_session=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0");
      equal((await get("/api/auth/me", cookie)).status, 401); equal((await get("/admin", cookie)).status, 303);
      equal((await get("/api/auth/me", other)).status, 200);
      for (const headers of [{ Cookie: cookie }, {}, { Cookie: "copilot_session=malformado" }] as Record<string, string>[]) {
        equal((await fetch(`${url}/api/auth/logout`, { method: "POST", headers })).status, 204);
      }
    });

    await t.test("set-password pelo CLI apaga todas as sessões do atendente", async () => {
      const first = await session(), second = await session();
      const newPassword = "nova-senha-sintetica";
      const output: string[] = [];
      equal(await runAttendantCommand(["set-password", "atendente.teste"], { attendants, hasher, readPassword: async () => newPassword,
        out: (line) => output.push(line), err: (line) => output.push(line) }), 0);
      ok(!output.join("\n").includes(newPassword));
      for (const cookie of [first, second]) equal((await get("/api/auth/me", cookie)).status, 401);
      equal((await login({ username: "atendente.teste", password })).status, 401);
      await session("atendente.teste", newPassword);
      equal(await runAttendantCommand(["set-password", "atendente.teste"], { attendants, hasher, readPassword: async () => password,
        out: () => {}, err: () => {} }), 0);
    });

    await t.test("sessão expirada pelo relógio dá 401 e é apagada no login seguinte", async () => {
      const cookie = await session();
      offset = 12 * 3_600_000 - 60_000; equal((await get("/api/auth/me", cookie)).status, 200);
      offset = 12 * 3_600_000 + 1; equal((await get("/api/auth/me", cookie)).status, 401);
      equal((await get("/api/demo/conversations", cookie)).status, 401);
      equal((await get("/admin", cookie)).status, 303);
      await session();
      equal((await pool.query("SELECT 1 FROM public.attendant_sessions WHERE expires_at <= $1;", [new Date(Date.now() + offset)])).rowCount, 0);
    });

    await t.test("Origin diferente do Host dá 403 nas rotas que alteram estado; sem Origin passa", async () => {
      const cookie = await session();
      for (const origin of ["http://evil.example", "null", `https://${host}`]) {
        const response = await login({ username: "atendente.teste", password }, { Origin: origin });
        equal(response.status, 403); equal((await response.json() as { code: string }).code, "forbidden_origin");
        equal(response.headers.get("set-cookie"), null);
        equal((await fetch(`${url}/api/demo/leads/${randomUUID()}/assume`, { method: "POST", headers: { Cookie: cookie, Origin: origin } })).status, 403);
        equal((await fetch(`${url}/api/auth/logout`, { method: "POST", headers: { Cookie: cookie, Origin: origin } })).status, 403);
      }
      equal((await get("/api/auth/me", cookie)).status, 200);
      equal((await login({ username: "atendente.teste", password }, { Origin: url })).status, 200);
      equal((await login({ username: "atendente.teste", password })).status, 200);
      equal((await fetch(`${url}/api/demo/conversations`, { headers: { Cookie: cookie, Origin: "http://evil.example" } })).status, 200);
    });

    await t.test("webhook do simulador continua aberto, sem cookie e sem checagem de Origin", async () => {
      const response = await fetch(`${url}/webhooks/simulator`, { method: "POST", headers: { "Content-Type": "application/json", Origin: "http://evil.example" },
        body: JSON.stringify({ id: randomUUID(), from: "+15550119999", fromMe: false, type: "text", body: "Olá", timestamp: new Date().toISOString() }) });
      equal(response.status, 200); equal((await response.json() as { status: string }).status, "registrada");
    });
  } finally {
    try {
      if (server) { server.closeAllConnections(); await new Promise<void>((resolve, reject) => server!.close((error) => error ? reject(error) : resolve())); }
      await pool.end(); if (created) await admin.query(`DROP DATABASE "${database}" WITH (FORCE);`);
    } finally { await admin.end(); }
  }
});
