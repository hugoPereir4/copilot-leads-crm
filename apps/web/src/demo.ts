import type { DemoConversation, DemoMessage } from "@copilot-leads/shared";

function element<T extends HTMLElement>(id: string) { return document.getElementById(id) as T; }
const admin = location.pathname === "/admin";
document.body.classList.toggle("dashboard-page", admin);
element("simulator-panel").hidden = admin; element("admin-panel").hidden = !admin;
element(admin ? "admin-link" : "simulator-link").setAttribute("aria-current", "page");
const phone = element<HTMLInputElement>("phone"), message = element<HTMLTextAreaElement>("message");
const conversation = element<HTMLSelectElement>("conversation"), history = element("history");
const status = element("status"), sendButton = element<HTMLButtonElement>("send"), resend = element<HTMLButtonElement>("resend");
const themeToggle = element<HTMLButtonElement>("theme-toggle"), themeLabel = element("theme-label");
let selected = "", lastHistory = "", lastBoard = "";
let previous: { id: string; from: string; fromMe: false; type: "text"; body: string; timestamp: string } | undefined;

async function request<T>(url: string, options?: RequestInit): Promise<T> {
  const response = await fetch(url, options);
  if (!response.ok) throw new Error(`Falha HTTP ${response.status}. Confira a API e tente novamente.`);
  return response.json() as Promise<T>;
}
function report(text: string, error = false) {
  if (status.textContent !== text) status.textContent = text;
  const role = error ? "alert" : "status";
  if (status.getAttribute("role") !== role) status.setAttribute("role", role);
}
function setTheme(theme: "light" | "dark") {
  document.documentElement.dataset.theme = theme;
  element<HTMLMetaElement>("theme-color").content = theme === "dark" ? "#141F1C" : "#F7FAF8";
  themeLabel.textContent = theme === "dark" ? "Tema claro" : "Tema escuro";
  themeToggle.setAttribute("aria-label", `Alternar para o tema ${theme === "dark" ? "claro" : "escuro"}`);
  themeToggle.setAttribute("aria-pressed", String(theme === "dark"));
}
setTheme(document.documentElement.dataset.theme === "dark" ? "dark" : "light");
themeToggle.addEventListener("click", () => {
  const theme = document.documentElement.dataset.theme === "dark" ? "light" : "dark";
  setTheme(theme);
  element("theme-status").textContent = `Tema ${theme === "dark" ? "escuro" : "claro"} ativado.`;
  try {
    localStorage.setItem("copilot-leads-theme", theme);
  } catch {
    element("theme-status").textContent = "Tema alterado, mas não foi possível salvar a preferência neste navegador.";
  }
});
async function submit(payload: NonNullable<typeof previous>) {
  sendButton.disabled = true; resend.disabled = true;
  sendButton.textContent = "Enviando…";
  try {
    const result = await request<{ status: string }>("/webhooks/simulator", { method: "POST",
      headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) });
    previous = payload;
    report(result.status === "duplicada" ? "Duplicata reconhecida. O histórico foi preservado." : "Mensagem registrada. Aguardando processamento…");
    if (result.status !== "duplicada") message.value = "";
  } catch (error) { report(error instanceof Error ? error.message : "Não foi possível enviar.", true); }
  finally {
    sendButton.disabled = false;
    sendButton.textContent = "Enviar mensagem";
    resend.disabled = previous === undefined;
  }
}
element<HTMLFormElement>("message-form").addEventListener("submit", (event) => {
  event.preventDefault();
  if (!message.value.trim()) { report("Escreva uma mensagem.", true); return; }
  selected = ""; lastHistory = "";
  void submit({ id: crypto.randomUUID(), from: phone.value, fromMe: false, type: "text", body: message.value, timestamp: new Date().toISOString() });
});
resend.addEventListener("click", () => { if (previous) void submit(previous); });
conversation.addEventListener("change", () => { selected = conversation.value; lastHistory = ""; });
phone.addEventListener("change", () => { selected = ""; lastHistory = ""; });

function renderBoard(rows: DemoConversation[]) {
  const board = element("board"); board.replaceChildren();
  for (const [stage, label] of [["novo", "Novo"], ["qualificado", "Qualificado"], ["em_atendimento", "Em atendimento"]]) {
    const column = document.createElement("section"); column.className = "kanban-column";
    const heading = document.createElement("div"); heading.className = "kanban-column-header";
    const title = document.createElement("h2"); title.textContent = label!;
    const cards = rows.filter((row) => row.lead?.stage === stage);
    const count = document.createElement("span"); count.className = "column-count";
    count.textContent = String(cards.length); count.setAttribute("aria-label", `${cards.length} leads`);
    heading.append(title, count);
    const cardList = document.createElement("div"); cardList.className = "column-cards";
    if (!cards.length) {
      const empty = document.createElement("p"); empty.className = "empty-state";
      empty.textContent = "Nenhum lead nesta etapa.";
      cardList.append(empty);
    }
    for (const row of cards) {
      const card = document.createElement("article"); card.className = "lead-card";
      const cardTop = document.createElement("div"); cardTop.className = "lead-card-top";
      const select = document.createElement("button"); select.className = "conversation-select";
      select.type = "button"; select.textContent = row.phone;
      select.setAttribute("aria-label", `Abrir conversa com ${row.phone}`);
      select.onclick = () => { selected = row.id; conversation.value = row.id; lastHistory = ""; };
      cardTop.append(select);
      if (row.lead?.needsReview) { const badge = document.createElement("span"); badge.className = "badge"; badge.textContent = "Revisar"; cardTop.append(badge); }
      const details = document.createElement("p"); details.className = "lead-summary";
      details.textContent = row.lead?.summary ?? "Pedido direto à recepção. Aguardando atendimento humano.";
      const link = document.createElement("a"); link.className = "whatsapp-link"; link.textContent = "Abrir no WhatsApp";
      link.href = `https://wa.me/${row.phone.replace(/\D/g, "")}`; link.target = "_blank"; link.rel = "noopener noreferrer";
      card.append(cardTop, details, link); cardList.append(card);
    }
    column.append(heading, cardList); board.append(column);
  }
}
async function refresh() {
  const board = element("board"), adminStatus = element("admin-status");
  board.setAttribute("aria-busy", "true");
  try {
    const rows = await request<DemoConversation[]>("/api/demo/conversations");
    if (!Array.isArray(rows)) throw new Error("Resposta inválida do painel.");
    if (!selected) selected = (admin ? rows[0] : rows.find((row) => row.phone === phone.value))?.id ?? "";
    const previousValue = selected;
    conversation.replaceChildren();
    for (const row of rows) {
      const option = document.createElement("option"); option.value = row.id; option.textContent = `${row.phone} · ${row.status}`; conversation.append(option);
    }
    conversation.value = previousValue;
    const row = rows.find((row) => row.id === selected);
    element("conversation-status").textContent = row ? `${row.status}${row.failedJobs ? ` · ${row.failedJobs} job(s) com falha; confira os logs da API.` : ""}` : "Envie uma mensagem para iniciar.";
    const boardVersion = JSON.stringify(rows);
    if (admin && boardVersion !== lastBoard) { renderBoard(rows); lastBoard = boardVersion; }
    if (selected) {
      const messages = await request<DemoMessage[]>(`/api/demo/conversations/${encodeURIComponent(selected)}/messages`);
      const version = JSON.stringify(messages);
      if (version !== lastHistory) {
        history.replaceChildren();
        for (const item of messages) {
          const bubble = document.createElement("article");
          bubble.className = item.direction === "saida" ? "bubble bubble--outgoing" : "bubble bubble--incoming";
          const meta = document.createElement("div"); meta.className = "bubble-meta";
          const source = document.createElement("span");
          source.textContent = `${item.direction === "saida" ? "Resposta do bot" : "Mensagem recebida"} · ${item.senderType}`;
          const time = document.createElement("time"); time.dateTime = item.createdAt;
          time.textContent = new Date(item.createdAt).toLocaleTimeString("pt-BR");
          const body = document.createElement("div"); body.className = "bubble-body";
          body.textContent = item.body ?? `[${item.kind}]`;
          meta.append(source, time); bubble.append(meta, body); history.append(bubble);
        }
        if (!messages.length) {
          const empty = document.createElement("p"); empty.className = "history-empty";
          empty.textContent = "Ainda não há mensagens nesta conversa.";
          history.append(empty);
        }
        lastHistory = version; history.scrollTop = history.scrollHeight;
      }
    } else {
      history.replaceChildren();
      const empty = document.createElement("p"); empty.className = "history-empty";
      empty.textContent = "A conversa aparecerá aqui depois do envio.";
      history.append(empty); lastHistory = "";
    }
    if (adminStatus.textContent !== "Atualização automática ativa · demonstração local") {
      adminStatus.textContent = "Atualização automática ativa · demonstração local";
    }
    adminStatus.removeAttribute("data-error");
  } catch (error) {
    const text = error instanceof Error ? error.message : "Conexão indisponível.";
    if (adminStatus.textContent !== text) adminStatus.textContent = text;
    adminStatus.setAttribute("data-error", "true"); report(text, true);
  } finally {
    board.setAttribute("aria-busy", "false");
    setTimeout(() => { void refresh(); }, 1000);
  }
}
void refresh();
