import { deepEqual, equal, ok } from "node:assert/strict";
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
  // <dialog> e foco mínimos: close() dispara "close", como o botão e o Esc no navegador.
  open = false;
  showModal() { this.open = true; }
  close() { if (!this.open) return; this.open = false; this.events.get("close")?.(); }
  focus() { Element.focused = this; }
  static focused = undefined;
}
const flush = async () => { for (let i = 0; i < 4; i++) await new Promise(setImmediate); };
function nodes(element) { return [element, ...element.children.flatMap(nodes)]; }

async function page({ saved = "light", blockedStorage = false, inAttendance = false, confirm = true, qualification = null, qualified = false,
  unauthorized = false, path = "/admin", contactName = null, extraRows = [], messages = [] } = {}) {
  const elements = new Map();
  const element = (id) => { if (!elements.has(id)) elements.set(id, new Element()); return elements.get(id); };
  const document = { documentElement: new Element(), body: new Element(), getElementById: element, createElement: () => new Element() };
  const storage = new Map([["copilot-leads-theme", saved]]);
  const timers = [], assigned = [], logouts = []; let calls = 0, finish, lastPost, confirmations = 0;
  let rows = [{ id: "conversation", phone: "+15550114921", contactName, status: inAttendance ? "em_atendimento_humano" : "aguardando_humano", failedJobs: 0,
    lead: { id: "lead", stage: inAttendance ? "em_atendimento" : qualified ? "qualificado" : "novo", needsReview: true, summary: qualification?.summary ?? null, qualification } },
    ...extraRows];
  const fetched = [];
  const fetch = async (url, options) => {
    fetched.push(url);
    if (url === "/api/auth/logout") { logouts.push(options); return { ok: true, status: 204 }; }
    if (unauthorized) return { ok: false, status: 401, json: async () => ({ code: "unauthenticated", message: "Sessão ausente ou expirada." }) };
    if (url === "/api/auth/me") return { ok: true, status: 200, json: async () => ({ id: "atendente", username: "hugo", displayName: "Atendente Sintético" }) };
    if (options?.method === "POST") { calls++; lastPost = { url, ...options }; return new Promise((resolve) => { finish = resolve; }); }
    return { ok: true, status: 200, json: async () => url.endsWith("/messages") ? structuredClone(messages) : structuredClone(rows) };
  };
  const location = { pathname: path, assign(url) { assigned.push(url); } };
  const context = { document, location, fetch, console, crypto: { randomUUID: () => "id-sintetico" }, setTimeout: (callback) => timers.push(callback),
    window: { confirm: () => { confirmations++; return confirm; } },
    matchMedia: () => ({ matches: true }), localStorage: {
      getItem(key) { if (blockedStorage) throw Error("Storage bloqueado"); return storage.get(key); },
      setItem(key, value) { if (blockedStorage) throw Error("Storage bloqueado"); storage.set(key, value); },
    } };
  runInNewContext(html.match(/<script>([\s\S]*?)<\/script>/)[1], context);
  runInNewContext(compiled, context); await flush();
  return { document, element, storage, timers, fetched, assigned, logouts, calls: () => calls, confirmations: () => confirmations, lastPost: () => lastPost,
    buttons: () => nodes(element("board")).filter((node) => node.className.includes("assume-button")),
    closeButtons: () => nodes(element("board")).filter((node) => node.className.includes("close-button")),
    async complete(success) {
      if (success) {
        const result = lastPost.url.endsWith("/close") ? JSON.parse(lastPost.body).result : undefined;
        rows = rows.map((row) => ({ ...row, status: result ? "encerrada" : "em_atendimento_humano",
          lead: { ...row.lead, stage: result ?? "em_atendimento" } }));
      }
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

test("encerramento confirma, bloqueia ambas as opções e preserva acesso aos encerrados", async () => {
  for (const result of ["ganho", "perdido"]) {
    const ui = await page({ inAttendance: true });
    const [gain, loss] = ui.closeButtons(); ok(gain && loss);
    (result === "ganho" ? gain : loss).onclick(); gain.onclick(); loss.onclick();
    equal(ui.calls(), 1); equal(ui.confirmations(), 1);
    ok(ui.closeButtons().every((button) => button.disabled && button.textContent === "Encerrando…"));
    equal(JSON.parse(ui.lastPost().body).result, result);
    equal(nodes(ui.element("board")).filter((node) => node.className === "lead-card").length, 1);
    await ui.complete(true);
    // O card encerrado vai para a coluna do resultado no quadro principal, sem ações de etapa.
    const target = ui.element("board").children[result === "ganho" ? 3 : 4];
    equal(nodes(target).filter((node) => node.className === "lead-card").length, 1);
    equal(nodes(ui.element("board")).filter((node) => node.className === "lead-card").length, 1);
    equal(ui.closeButtons().length, 0);
    ui.element("show-closed").checked = true; ui.element("show-closed").events.get("change")();
    equal(nodes(ui.element("board")).filter((node) => node.className === "lead-card").length, 1);
    equal(ui.closeButtons().length, 0); equal(ui.element("admin-title").textContent, "Leads encerrados");
    ok(nodes(ui.element("board")).some((node) => node.textContent === "Abrir no WhatsApp"));
  }
});

test("cancelar confirmação não faz POST; falha conserva card e habilita nova tentativa", async () => {
  const canceled = await page({ inAttendance: true, confirm: false });
  canceled.closeButtons()[0].onclick(); equal(canceled.calls(), 0); equal(canceled.closeButtons().length, 2);
  const failed = await page({ inAttendance: true }); failed.closeButtons()[0].onclick(); await failed.complete(false);
  equal(failed.element("handoff-status").getAttribute("role"), "alert");
  equal(failed.element("handoff-status").textContent, "Estado incompatível.");
  equal(failed.closeButtons().length, 2); ok(failed.closeButtons().every((button) => !button.disabled));
});

test("campos de qualificação são texto seguro, com origem simulada explícita e ações preservadas", async () => {
  const qualification = { intent: "agendamento", serviceId: "avaliacao", serviceName: "Avaliação de fisioterapia", period: "amanhã",
    summary: "<script>exemplo sintético</script>", needsReview: true, source: "simulated", status: "qualificado" };
  const ui = await page({ qualification, qualified: true });
  const text = nodes(ui.element("board")).map((node) => node.textContent);
  for (const value of ["Simulada (sem IA externa)", "Qualificado", qualification.serviceName, qualification.period, qualification.summary, "Revisar"]) ok(text.includes(value));
  equal(ui.buttons().length, 1);
  const human = await page({ inAttendance: true, qualification: { ...qualification, source: "gemini", status: "revisao" } });
  equal(human.closeButtons().length, 2);
  ok(nodes(human.element("board")).some((node) => node.textContent === "Gemini"));
  const failed = await page({ qualification: { ...qualification, intent: null, serviceName: null, period: null, status: "falha" } });
  ok(nodes(failed.element("board")).some((node) => node.textContent === "Falha — revisar"));
  const absent = await page(); ok(!nodes(absent.element("board")).some((node) => node.className === "qualification-fields"));
});

test("cabeçalho mostra o atendente e Sair encerra a sessão, para o polling e volta ao login", async () => {
  const ui = await page();
  equal(ui.element("attendant-name").textContent, "Atendente Sintético");
  const pending = ui.timers.length; ok(pending > 0);
  await ui.element("logout").events.get("click")(); await flush();
  equal(ui.logouts.length, 1); equal(ui.logouts[0].method, "POST");
  deepEqual(ui.assigned, ["/login"]); equal(ui.element("logout").disabled, true);
  ui.timers.splice(0).forEach((callback) => callback()); await flush();
  equal(ui.timers.length, 0);
  await ui.element("logout").events.get("click")(); equal(ui.logouts.length, 1);
});

test("401 em qualquer chamada redireciona uma vez para o login com a rota atual e para o polling", async () => {
  const ui = await page({ unauthorized: true });
  deepEqual(ui.assigned, ["/login?next=%2Fadmin"]);
  equal(ui.timers.length, 0);
  equal(nodes(ui.element("board")).filter((node) => node.className === "lead-card").length, 0);
});

test("simulador envia profileName aparado só quando o campo está preenchido", async () => {
  for (const [typed, expected] of [["  Perfil Sintético  ", "Perfil Sintético"], ["   ", undefined], ["", undefined]]) {
    const ui = await page({ path: "/simulator" });
    ui.element("profile-name").value = typed; ui.element("phone").value = "+15550114921"; ui.element("message").value = "Olá";
    ui.element("message-form").events.get("submit")({ preventDefault() {} }); await flush();
    const body = JSON.parse(ui.lastPost().body);
    equal(ui.lastPost().url, "/webhooks/simulator");
    equal(body.profileName, expected); equal("profileName" in body, expected !== undefined);
  }
});

test("card mostra o nome de perfil com rótulo e mantém o telefone; sem nome, só o telefone", async () => {
  const texts = (ui) => nodes(ui.element("board")).map((node) => node.textContent);
  const named = await page({ contactName: "Perfil Sintético" });
  ok(texts(named).includes("Nome do perfil do WhatsApp")); ok(texts(named).includes("Perfil Sintético"));
  ok(texts(named).includes("+15550114921"));
  const select = nodes(named.element("board")).find((node) => node.className === "conversation-select");
  equal(select.textContent, "+15550114921"); equal(select.getAttribute("aria-label"), "Abrir conversa com Perfil Sintético, +15550114921");
  const unnamed = await page();
  ok(!texts(unnamed).includes("Nome do perfil do WhatsApp")); ok(texts(unnamed).includes("+15550114921"));
  equal(nodes(unnamed.element("board")).filter((node) => node.className.includes("contact-fields")).length, 0);
});

const columnTitles = (ui) => ui.element("board").children.map((column) => column.children[0].children[0].textContent);
const cardsIn = (column) => nodes(column).filter((node) => node.className === "lead-card");
const closedRow = (id, stage) => ({ id, phone: `+1555011${id.length}${stage === "ganho" ? 1 : 2}`, contactName: null, status: "encerrada", failedJobs: 0,
  lead: { id: `lead-${id}`, stage, needsReview: false, summary: null, qualification: null } });

test("quadro principal mostra Novo, Qualificado, Em atendimento, Ganho e Perdido nessa ordem", async () => {
  const ui = await page();
  deepEqual(columnTitles(ui), ["Novo", "Qualificado", "Em atendimento", "Ganho", "Perdido"]);
  equal(ui.element("admin-title").textContent, "Leads por etapa");
  ui.element("show-closed").checked = true; ui.element("show-closed").events.get("change")();
  deepEqual(columnTitles(ui), ["Ganho", "Perdido"]); equal(ui.element("admin-title").textContent, "Leads encerrados");
});

test("Ganho e Perdido listam leads encerrados só com Histórico e WhatsApp", async () => {
  const ui = await page({ extraRows: [closedRow("g1", "ganho"), closedRow("g22", "ganho"), closedRow("p1", "perdido")] });
  const [novo, , , ganho, perdido] = ui.element("board").children;
  equal(cardsIn(novo).length, 1); equal(cardsIn(ganho).length, 2); equal(cardsIn(perdido).length, 1);
  equal(ganho.children[0].children[1].textContent, "2");
  for (const column of [ganho, perdido]) {
    const texts = nodes(column).map((node) => node.textContent);
    ok(texts.includes("Histórico")); ok(texts.includes("Abrir no WhatsApp"));
    ok(!nodes(column).some((node) => /assume-button|close-button/.test(node.className)));
  }
  ok(nodes(perdido).some((node) => node.textContent === "Resultado: Perdido. Histórico preservado."));
});

test("Histórico abre o diálogo com foco, renderiza as mensagens, fecha e devolve o foco", async () => {
  const messages = [{ id: "m1", direction: "entrada", senderType: "contato", kind: "texto", body: "Olá sintético", createdAt: "2026-11-19T12:00:00.000Z" }];
  const ui = await page({ contactName: "Perfil Sintético", messages });
  equal(ui.element("history-panel").hidden, true);
  ok(!ui.fetched.some((url) => url.endsWith("/messages"))); // sem modal aberto, o painel não busca histórico
  const dialog = ui.element("history-dialog"), close = ui.element("history-dialog-close");
  for (const closeBy of ["botão", "Esc"]) {
    const opener = nodes(ui.element("board")).find((node) => node.className.includes("history-button")); ok(opener);
    equal(opener.getAttribute("aria-label"), "Ver histórico de Perfil Sintético, +15550114921");
    opener.onclick(); await flush();
    equal(dialog.open, true); equal(Element.focused, close);
    equal(ui.element("history-dialog-title").textContent, "Histórico · Perfil Sintético");
    ok(ui.fetched.includes("/api/demo/conversations/conversation/messages"));
    ok(nodes(ui.element("history-dialog-log")).some((node) => node.textContent === "Olá sintético"));
    if (closeBy === "botão") close.events.get("click")(); else dialog.close(); // Esc: o navegador fecha o <dialog> e dispara "close"
    equal(dialog.open, false); equal(Element.focused, opener);
    const before = ui.fetched.filter((url) => url.endsWith("/messages")).length;
    ui.timers.splice(0).forEach((callback) => callback()); await flush();
    equal(ui.fetched.filter((url) => url.endsWith("/messages")).length, before); // fechado, o polling não busca histórico
  }
  const phoneButton = nodes(ui.element("board")).find((node) => node.className === "conversation-select");
  phoneButton.onclick(); equal(dialog.open, true); dialog.close(); equal(Element.focused, phoneButton);
});
