import { deepEqual, equal } from "node:assert/strict";
import { test } from "node:test";
import type { Request, Response } from "express";
import type { HttpErrorResponder } from "../../../http/http-errors.js";
import { clearedSessionCookie, parseCookies, sessionCookie } from "./cookies.js";
import { createOriginGuard } from "./origin-guard.js";
import { safeNextPath } from "./require-session.js";

test("parser de cookie lê pares, ignora malformados e mantém o primeiro nome repetido", () => {
  deepEqual([...parseCookies(undefined)], []); deepEqual([...parseCookies("")], []);
  deepEqual(Object.fromEntries(parseCookies("a=1; copilot_session=abc_-; b = 2 ")), { a: "1", copilot_session: "abc_-", b: "2" });
  deepEqual(Object.fromEntries(parseCookies("x=primeiro; x=segundo")), { x: "primeiro" });
  deepEqual(Object.fromEntries(parseCookies("semvalor; =orfao; vazio=; c=%41%42; aspas=\"v\"")), { vazio: "", c: "AB", aspas: "v" });
  deepEqual(Object.fromEntries(parseCookies("ruim=%E0%A4%A; ok=1")), { ok: "1" });
  equal(parseCookies("t=a=b").get("t"), "a=b");
});

test("cookie de sessão é HttpOnly, SameSite=Lax, Path=/ e Max-Age do TTL; logout zera com os mesmos atributos", () => {
  equal(sessionCookie("tok", { sessionTtlHours: 12, cookieSecure: false }),
    "copilot_session=tok; HttpOnly; SameSite=Lax; Path=/; Max-Age=43200");
  equal(sessionCookie("tok", { sessionTtlHours: 1, cookieSecure: true }),
    "copilot_session=tok; HttpOnly; SameSite=Lax; Path=/; Max-Age=3600; Secure");
  equal(clearedSessionCookie({ sessionTtlHours: 12, cookieSecure: false }), "copilot_session=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0");
  equal(clearedSessionCookie({ sessionTtlHours: 12, cookieSecure: true }), "copilot_session=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0; Secure");
});

test("guarda de Origin bloqueia origem diferente em métodos que alteram estado e deixa passar o resto", () => {
  const run = (method: string, headers: Record<string, string>) => {
    const sent: unknown[] = []; let passed = false;
    const sendError: HttpErrorResponder = (_response, status, code) => { sent.push([status, code]); };
    const request = { method, get: (name: string) => headers[name.toLowerCase()] } as unknown as Request;
    createOriginGuard(sendError)(request, {} as Response, () => { passed = true; });
    return { sent, passed };
  };
  const host = { host: "127.0.0.1:3000" };
  deepEqual(run("POST", { ...host, origin: "http://127.0.0.1:3000" }), { sent: [], passed: true });
  deepEqual(run("POST", host), { sent: [], passed: true });
  for (const origin of ["http://evil.example", "https://127.0.0.1:3000", "http://localhost:3000", "null", "http://127.0.0.1:3001"]) {
    deepEqual(run("POST", { ...host, origin }), { sent: [[403, "forbidden_origin"]], passed: false }, origin);
  }
  for (const method of ["PUT", "PATCH", "DELETE"]) equal(run(method, { ...host, origin: "http://evil.example" }).passed, false);
  for (const method of ["GET", "HEAD"]) deepEqual(run(method, { ...host, origin: "http://evil.example" }), { sent: [], passed: true });
  equal(run("POST", { origin: "http://127.0.0.1:3000" }).passed, false);
});

test("retorno após login aceita só /admin e /simulator", () => {
  equal(safeNextPath("/admin"), "/admin"); equal(safeNextPath("/simulator"), "/simulator");
  for (const value of [undefined, "", "/", "//evil.example", "https://evil.example/admin", "/admin/../x", "/ADMIN", ["/simulator"], "/login"]) {
    equal(safeNextPath(value), "/admin");
  }
});
