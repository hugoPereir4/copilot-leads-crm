import type { DemoConversation, DemoMessage } from "@copilot-leads/shared";

function element<T extends HTMLElement>(id: string) { return document.getElementById(id) as T; }
const admin = location.pathname === "/admin";
element("simulator-panel").hidden = admin; element("admin-panel").hidden = !admin;
element(admin ? "admin-link" : "simulator-link").setAttribute("aria-current", "page");
const phone = element<HTMLInputElement>("phone"), message = element<HTMLTextAreaElement>("message");
const conversation = element<HTMLSelectElement>("conversation"), history = element("history");
const status = element("status"), sendButton = element<HTMLButtonElement>("send"), resend = element<HTMLButtonElement>("resend");
let selected = "", lastHistory = "", lastBoard = "";
let previous: { id: string; from: string; fromMe: false; type: "text"; body: string; timestamp: string } | undefined;

async function request<T>(url: string, options?: RequestInit): Promise<T> {
  const response = await fetch(url, options);
  if (!response.ok) throw new Error(`Falha HTTP ${response.status}. Confira a API e tente novamente.`);
  return response.json() as Promise<T>;
}
function report(text: string, error = false) { status.textContent = text; status.setAttribute("role", error ? "alert" : "status"); }
async function submit(payload: NonNullable<typeof previous>) {
  sendButton.disabled = true; resend.disabled = true;
  try {
    const result = await request<{ status: string }>("/webhooks/simulator", { method: "POST",
      headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) });
    previous = payload;
    report(result.status === "duplicada" ? "Duplicata reconhecida. O histórico foi preservado." : "Mensagem registrada. Aguardando processamento…");
    if (result.status !== "duplicada") message.value = "";
  } catch (error) { report(error instanceof Error ? error.message : "Não foi possível enviar.", true); }
  finally { sendButton.disabled = false; resend.disabled = previous === undefined; }
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
    const column = document.createElement("div"); column.className = "column";
    const title = document.createElement("h3"); title.textContent = label!; column.append(title);
    const cards = rows.filter((row) => row.lead?.stage === stage);
    if (!cards.length) { const empty = document.createElement("span"); empty.className = "muted"; empty.textContent = "Nenhum lead"; column.append(empty); }
    for (const row of cards) {
      const card = document.createElement("article"); card.className = "card";
      const select = document.createElement("button"); select.textContent = row.phone;
      select.onclick = () => { selected = row.id; conversation.value = row.id; lastHistory = ""; };
      card.append(select);
      if (row.lead?.needsReview) { const badge = document.createElement("span"); badge.className = "badge"; badge.textContent = "Revisar"; card.append(badge); }
      const details = document.createElement("p"); details.textContent = row.lead?.summary ?? "Pedido direto à recepção. Aguardando atendimento humano.";
      const link = document.createElement("a"); link.className = "wa"; link.textContent = "Abrir no WhatsApp";
      link.href = `https://wa.me/${row.phone.replace(/\D/g, "")}`; link.target = "_blank"; link.rel = "noopener noreferrer";
      card.append(details, link); column.append(card);
    }
    board.append(column);
  }
}
async function refresh() {
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
          const bubble = document.createElement("article"); bubble.className = item.direction === "saida" ? "bubble out" : "bubble";
          const label = document.createElement("small"); label.textContent = `${item.senderType} · ${new Date(item.createdAt).toLocaleTimeString("pt-BR")}`;
          const body = document.createElement("div"); body.textContent = item.body ?? `[${item.kind}]`;
          bubble.append(label, body); history.append(bubble);
        }
        lastHistory = version; history.scrollTop = history.scrollHeight;
      }
    } else { history.replaceChildren(); lastHistory = ""; }
    element("admin-status").textContent = "Atualização automática ativa · demonstração local";
  } catch (error) {
    const text = error instanceof Error ? error.message : "Conexão indisponível.";
    element("admin-status").textContent = text; report(text, true);
  } finally { setTimeout(() => { void refresh(); }, 1000); }
}
void refresh();
