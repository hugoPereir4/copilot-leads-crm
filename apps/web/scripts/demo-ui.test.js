import { equal, ok } from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { runInNewContext } from "node:vm";

const root = new URL("../", import.meta.url);
const html = readFileSync(new URL("index.html", root), "utf8");
const compiled = readFileSync(new URL("dist/demo.js", root), "utf8").replace(/^export\s*\{\s*\};?\s*$/m, "");

// DOM mínimo para testar eventos/estado do JS compilado; não é um navegador
// nem comprova aparência, layout, foco ou contraste visual.
class Element {
  children = []; attributes = new Map(); events = new Map(); textContent = "";
  value = ""; disabled = false; dataset = {}; className = ""; classList = { toggle() {} };
  append(...children) { this.children.push(...children); }
  replaceChildren(...children) { this.children = children; }
  setAttribute(key, value) { this.attributes.set(key, String(value)); }
  getAttribute(key) { return this.attributes.get(key); }
  removeAttribute(key) { this.attributes.delete(key); }
  addEventListener(event, callback) { this.events.set(event, callback); }
}
const flush = async () => { for (let i = 0; i < 4; i++) await new Promise(setImmediate); };
function nodes(element) { return [element, ...element.children.flatMap(nodes)]; }

async function page({ saved = "light", blockedStorage = false } = {}) {
  const elements = new Map();
  const element = (id) => { if (!elements.has(id)) elements.set(id, new Element()); return elements.get(id); };
  const document = { documentElement: new Element(), body: new Element(), getElementById: element, createElement: () => new Element() };
  const storage = new Map([["copilot-leads-theme", saved]]);
  const timers = []; let calls = 0, finish;
  let rows = [{ id: "conversation", phone: "+15550114921", status: "aguardando_humano", failedJobs: 0,
    lead: { id: "lead", stage: "novo", needsReview: true, summary: null } }];
  const fetch = async (url, options) => {
    if (options?.method === "POST") { calls++; return new Promise((resolve) => { finish = resolve; }); }
    return { ok: true, json: async () => url.endsWith("/messages") ? [] : structuredClone(rows) };
  };
  const context = { document, location: { pathname: "/admin" }, fetch, console, setTimeout: (callback) => timers.push(callback),
    matchMedia: () => ({ matches: true }), localStorage: {
      getItem(key) { if (blockedStorage) throw Error("Storage bloqueado"); return storage.get(key); },
      setItem(key, value) { if (blockedStorage) throw Error("Storage bloqueado"); storage.set(key, value); },
    } };
  runInNewContext(html.match(/<script>([\s\S]*?)<\/script>/)[1], context);
  runInNewContext(compiled, context); await flush();
  return { document, element, storage, timers, calls: () => calls,
    buttons: () => nodes(element("board")).filter((node) => node.className.includes("assume-button")),
    async complete(success) {
      if (success) rows = rows.map((row) => ({ ...row, status: "em_atendimento_humano", lead: { ...row.lead, stage: "em_atendimento" } }));
      finish({ ok: success, status: success ? 200 : 409, json: async () => success ? { status: "assumido" } : { message: "Estado incompatível." } });
      await flush();
    },
  };
}

test("build publica os seis estilos referenciados pelo HTML sem alterar seu conteúdo", () => {
  const styles = [...html.matchAll(/href="\/assets\/styles\/([^"]+)"/g)].map((match) => match[1]);
  equal(styles.length, 6);
  for (const name of styles) equal(readFileSync(new URL(`dist/styles/${name}`, root), "utf8"), readFileSync(new URL(`src/styles/${name}`, root), "utf8"));
});

test("tema salvo, alternância e preferência do sistema funcionam inclusive sem storage", async () => {
  for (const blockedStorage of [false, true]) {
    const ui = await page({ blockedStorage });
    equal(ui.document.documentElement.dataset.theme, blockedStorage ? "dark" : "light");
    ui.element("theme-toggle").events.get("click")();
    equal(ui.document.documentElement.dataset.theme, blockedStorage ? "light" : "dark");
    equal(ui.element("theme-toggle").getAttribute("aria-pressed"), String(!blockedStorage));
    ok(ui.element("theme-status").textContent.length > 0);
    if (!blockedStorage) equal(ui.storage.get("copilot-leads-theme"), "dark");
  }
});

test("assunção bloqueia cliques repetidos e move o card após confirmação", async () => {
  const ui = await page(); const [button] = ui.buttons(); ok(button);
  button.onclick(); button.onclick(); equal(ui.calls(), 1); equal(button.disabled, true);
  equal(button.textContent, "Assumindo…");
  await ui.complete(true);
  equal(ui.buttons().length, 0); ok(ui.element("handoff-status").textContent.includes("assumido"));
  const columns = ui.element("board").children;
  equal(nodes(columns[0]).filter((node) => node.className === "lead-card").length, 0);
  equal(nodes(columns[2]).filter((node) => node.className === "lead-card").length, 1);
  ok(nodes(columns[2]).some((node) => node.textContent === "Abrir no WhatsApp"));
});

test("falha mantém o card e informa erro acessível sem afirmar assunção", async () => {
  const ui = await page(); const [button] = ui.buttons(); button.onclick(); await ui.complete(false);
  equal(ui.element("handoff-status").getAttribute("role"), "alert");
  equal(ui.element("handoff-status").textContent, "Estado incompatível."); equal(button.disabled, false);
  equal(ui.buttons().length, 1);
});
