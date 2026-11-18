import { deepEqual, equal, ok } from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { runInNewContext } from "node:vm";

const root = new URL("../", import.meta.url);
const html = readFileSync(new URL("login.html", root), "utf8");
const compiled = readFileSync(new URL("dist/login.js", root), "utf8").replace(/^export\s*\{\s*\};?\s*$/m, "");

// DOM mínimo, como em demo-ui.test.js: testa estado e eventos, não aparência.
class Element {
  attributes = new Map(); events = new Map(); textContent = ""; value = ""; disabled = false; dataset = {}; focused = 0;
  setAttribute(key, value) { this.attributes.set(key, String(value)); }
  getAttribute(key) { return this.attributes.get(key); }
  addEventListener(event, callback) { this.events.set(event, callback); }
  focus() { this.focused++; }
}
const flush = async () => { for (let i = 0; i < 4; i++) await new Promise(setImmediate); };

function page(search = "") {
  const elements = new Map();
  const element = (id) => { if (!elements.has(id)) elements.set(id, new Element()); return elements.get(id); };
  const document = { documentElement: new Element(), getElementById: element };
  const requests = [], assigned = []; let respond;
  const fetch = (url, options) => { requests.push({ url, ...options }); return new Promise((resolve) => { respond = resolve; }); };
  const context = { document, fetch, URLSearchParams, console, matchMedia: () => ({ matches: false }),
    localStorage: { getItem: () => null }, location: { search, assign(url) { assigned.push(url); } } };
  runInNewContext(html.match(/<script>([\s\S]*?)<\/script>/)[1], context);
  runInNewContext(compiled, context);
  const submit = () => element("login-form").events.get("submit")({ preventDefault() {} });
  return { element, requests, assigned, submit, async reply(response) { respond(response); await flush(); } };
}

test("login envia JSON, desabilita o botão durante o envio e vai para o next permitido", async () => {
  const ui = page("?next=%2Fsimulator");
  ui.element("username").value = "hugo"; ui.element("password").value = "senha-sintetica-12";
  ui.submit(); ui.submit();
  equal(ui.requests.length, 1); equal(ui.element("login-submit").disabled, true);
  equal(ui.element("login-submit").textContent, "Entrando…");
  equal(ui.requests[0].url, "/api/auth/login"); equal(ui.requests[0].method, "POST");
  equal(ui.requests[0].headers["Content-Type"], "application/json");
  deepEqual(JSON.parse(ui.requests[0].body), { username: "hugo", password: "senha-sintetica-12" });
  await ui.reply({ ok: true, status: 200, json: async () => ({ id: "id", username: "hugo", displayName: "Hugo" }) });
  deepEqual(ui.assigned, ["/simulator"]); equal(ui.element("login-submit").disabled, true);
});

test("401 mostra a mensagem genérica, limpa a senha e reabilita o botão", async () => {
  const ui = page();
  ui.element("username").value = "hugo"; ui.element("password").value = "senha-errada-123";
  ui.submit();
  await ui.reply({ ok: false, status: 401, json: async () => ({ code: "invalid_credentials", message: "Usuário ou senha inválidos." }) });
  equal(ui.element("login-error").textContent, "Usuário ou senha inválidos.");
  equal(ui.element("password").value, ""); equal(ui.element("username").value, "hugo"); ok(ui.element("password").focused > 0);
  equal(ui.element("login-submit").disabled, false); equal(ui.element("login-submit").textContent, "Entrar");
  deepEqual(ui.assigned, []);
});

test("next fora da lista vira /admin e campos vazios não chegam à API", async () => {
  for (const search of ["", "?next=https%3A%2F%2Fevil.example", "?next=%2F%2Fevil.example", "?next=%2Flogin"]) {
    const ui = page(search);
    ui.submit(); equal(ui.requests.length, 0); equal(ui.element("login-error").textContent, "Informe usuário e senha.");
    ui.element("username").value = "hugo"; ui.element("password").value = "senha-sintetica-12"; ui.submit();
    await ui.reply({ ok: true, status: 200, json: async () => ({}) });
    deepEqual(ui.assigned, ["/admin"]);
  }
  const failed = page();
  failed.element("username").value = "hugo"; failed.element("password").value = "senha-sintetica-12"; failed.submit();
  await failed.reply({ ok: false, status: 500, json: async () => ({ message: "Não foi possível entrar. Tente novamente." }) });
  equal(failed.element("login-error").textContent, "Não foi possível entrar. Tente novamente.");
  equal(failed.element("password").value, "senha-sintetica-12"); equal(failed.element("login-submit").disabled, false);
});
