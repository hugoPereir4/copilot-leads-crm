import type { Attendant, DemoConversation, DemoMessage, HumanHandoffReceipt, LeadClosureOutcome, LeadClosureReceipt } from "@copilot-leads/shared";

function element<T extends HTMLElement>(id: string) { return document.getElementById(id) as T; }
const admin = location.pathname === "/admin";
document.body.classList.toggle("dashboard-page", admin);
element("simulator-panel").hidden = admin; element("admin-panel").hidden = !admin;
// No painel, o histórico abre em um <dialog> por card; no simulador, continua no painel da página.
element("history-panel").hidden = admin;
element(admin ? "admin-link" : "simulator-link").setAttribute("aria-current", "page");
const profileName = element<HTMLInputElement>("profile-name");
const phone = element<HTMLInputElement>("phone"), message = element<HTMLTextAreaElement>("message");
const conversation = element<HTMLSelectElement>("conversation");
const history = element(admin ? "history-dialog-log" : "history");
const conversationStatus = element(admin ? "history-dialog-status" : "conversation-status");
const historyDialog = element<HTMLDialogElement>("history-dialog"), historyClose = element<HTMLButtonElement>("history-dialog-close");
let historyOpener: HTMLElement | undefined;
const status = element("status"), sendButton = element<HTMLButtonElement>("send"), resend = element<HTMLButtonElement>("resend");
const themeToggle = element<HTMLButtonElement>("theme-toggle"), themeLabel = element("theme-label");
let selected = "", lastHistory = "", lastBoard = "";
const assuming = new Set<string>();
const closing = new Set<string>();
const closedFilter = element<HTMLInputElement>("show-closed");
let boardRows: DemoConversation[] = [];
let boardRevision = 0;
let previous: { id: string; from: string; fromMe: false; type: "text"; body: string; timestamp: string; profileName?: string } | undefined;

// Sessão encerrada ou expirada: parar o polling e voltar ao login uma única vez.
let signedOut = false;
function goToLogin(path: string) {
  if (signedOut) return;
  signedOut = true; location.assign(path);
}
async function request<T>(url: string, options?: RequestInit): Promise<T> {
  const response = await fetch(url, options);
  if (response.status === 401) {
    goToLogin(`/login?next=${encodeURIComponent(location.pathname)}`);
    throw new Error("Sessão expirada. Redirecionando para o login…");
  }
  if (!response.ok) {
    const error = await response.json().catch(() => null) as { message?: unknown } | null;
    throw new Error(typeof error?.message === "string" ? error.message : `Falha HTTP ${response.status}. Confira a API e tente novamente.`);
  }
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
void request<Attendant>("/api/auth/me").then((attendant) => { element("attendant-name").textContent = attendant.displayName; })
  .catch(() => { /* 401 já redireciona; outras falhas não bloqueiam o painel. */ });
element<HTMLButtonElement>("logout").addEventListener("click", async () => {
  if (signedOut) return;
  element<HTMLButtonElement>("logout").disabled = true;
  signedOut = true; // O polling para já; o logout é idempotente no servidor.
  try { await fetch("/api/auth/logout", { method: "POST" }); } catch { /* o login seguinte cria nova sessão. */ }
  location.assign("/login");
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
  // profileName só vai no payload quando preenchido; o servidor também apara e valida.
  const name = profileName.value.trim();
  void submit({ id: crypto.randomUUID(), from: phone.value, fromMe: false, type: "text", body: message.value,
    timestamp: new Date().toISOString(), ...(name ? { profileName: name } : {}) });
});
resend.addEventListener("click", () => { if (previous) void submit(previous); });
conversation.addEventListener("change", () => { selected = conversation.value; lastHistory = ""; });
closedFilter.addEventListener("change", () => { renderBoard(boardRows); });
phone.addEventListener("change", () => { selected = ""; lastHistory = ""; });

async function assumeAttendance(leadId: string, button: HTMLButtonElement) {
  if (assuming.has(leadId)) return;
  assuming.add(leadId); button.disabled = true; button.textContent = "Assumindo…";
  const feedback = element("handoff-status"); feedback.setAttribute("role", "status");
  feedback.textContent = "Solicitando atendimento humano…";
  try {
    await request<HumanHandoffReceipt>(`/api/demo/leads/${encodeURIComponent(leadId)}/assume`, { method: "POST" });
    boardRevision++;
    feedback.textContent = "Atendimento assumido. O bot permanecerá silencioso.";
    // Só apresentar a nova etapa após confirmação da transação.
    const rows = await request<DemoConversation[]>("/api/demo/conversations");
    renderBoard(rows); lastBoard = JSON.stringify(rows);
  } catch (error) {
    feedback.setAttribute("role", "alert");
    feedback.textContent = error instanceof Error ? error.message : "Não foi possível assumir o atendimento.";
  } finally {
    assuming.delete(leadId); button.disabled = false; button.textContent = "Assumir atendimento";
    lastBoard = ""; // Atualizar inclusive após conflito com outro painel ou falha de rede.
  }
}

async function closeAttendance(leadId: string, result: LeadClosureOutcome, button: HTMLButtonElement) {
  if (closing.has(leadId)) return;
  if (!window.confirm(`Encerrar este atendimento como ${result === "ganho" ? "Ganho" : "Perdido"}?`)) return;
  closing.add(leadId);
  renderBoard(boardRows); // Desabilita as duas opções do mesmo card durante o pedido.
  button.disabled = true;
  const feedback = element("handoff-status"); feedback.setAttribute("role", "status");
  feedback.textContent = "Encerrando atendimento…";
  try {
    await request<LeadClosureReceipt>(`/api/demo/leads/${encodeURIComponent(leadId)}/close`, {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ result }),
    });
    boardRevision++;
    feedback.textContent = `Atendimento encerrado como ${result === "ganho" ? "Ganho" : "Perdido"}. Histórico preservado.`;
    const rows = await request<DemoConversation[]>("/api/demo/conversations");
    renderBoard(rows); lastBoard = JSON.stringify(rows);
  } catch (error) {
    feedback.setAttribute("role", "alert");
    feedback.textContent = error instanceof Error ? error.message : "Não foi possível encerrar o atendimento.";
  } finally {
    closing.delete(leadId); renderBoard(boardRows); lastBoard = "";
  }
}

// Abre o histórico do card em modal. A mesma renderização do simulador preenche o log do diálogo,
// e o polling o atualiza enquanto estiver aberto (selected = conversa do diálogo).
function openHistory(row: DemoConversation, opener: HTMLElement) {
  selected = row.id; conversation.value = row.id; lastHistory = ""; historyOpener = opener;
  element("history-dialog-title").textContent = `Histórico · ${row.contactName ?? row.phone}`;
  conversationStatus.textContent = row.status;
  history.replaceChildren();
  const loading = document.createElement("p"); loading.className = "history-empty"; loading.textContent = "Carregando mensagens…";
  history.append(loading);
  historyDialog.showModal(); historyClose.focus();
  void renderSelectedHistory().catch((error: unknown) => {
    conversationStatus.textContent = error instanceof Error ? error.message : "Não foi possível carregar o histórico.";
  });
}
historyClose.addEventListener("click", () => { historyDialog.close(); });
// "close" cobre o botão e a tecla Esc (cancel nativo do <dialog>).
historyDialog.addEventListener("close", () => {
  const conversationId = selected;
  if (admin) { selected = ""; lastHistory = ""; }
  // O polling pode ter refeito o quadro com o modal aberto: nesse caso, foca o botão novo do mesmo card.
  const target = historyOpener?.isConnected === false
    ? document.querySelector<HTMLElement>(`.history-button[data-conversation="${conversationId}"]`) ?? undefined : historyOpener;
  target?.focus(); historyOpener = undefined;
});

const openColumns = [["novo", "Novo"], ["qualificado", "Qualificado"], ["em_atendimento", "Em atendimento"], ["ganho", "Ganho"], ["perdido", "Perdido"]];
const closedColumns = [["ganho", "Ganho"], ["perdido", "Perdido"]];

function renderBoard(rows: DemoConversation[]) {
  boardRows = rows;
  const showClosed = closedFilter.checked;
  element("admin-title").textContent = showClosed ? "Leads encerrados" : "Leads por etapa";
  const board = element("board"); board.replaceChildren();
  // Ganho e Perdido fazem parte do quadro principal; o filtro continua mostrando só os encerrados.
  const columns = showClosed ? closedColumns : openColumns;
  for (const [stage, label] of columns) {
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
      select.setAttribute("aria-label", `Abrir conversa com ${row.contactName ? `${row.contactName}, ` : ""}${row.phone}`);
      select.onclick = () => { openHistory(row, select); };
      cardTop.append(select);
      if (row.lead?.needsReview) { const badge = document.createElement("span"); badge.className = "badge"; badge.textContent = "Revisar"; cardTop.append(badge); }
      const details = document.createElement("p"); details.className = "lead-summary";
      const closed = stage === "ganho" || stage === "perdido";
      details.textContent = row.lead?.summary ?? (closed ? `Resultado: ${label}. Histórico preservado.`
        : row.lead?.stage === "em_atendimento" ? "Atendimento humano em andamento." : "Pedido direto à recepção. Aguardando atendimento humano.");
      card.append(cardTop);
      // O telefone continua sempre visível no botão; o nome aparece só quando o provedor o informou.
      if (row.contactName) {
        const contact = document.createElement("dl"); contact.className = "qualification-fields contact-fields";
        const term = document.createElement("dt"), description = document.createElement("dd");
        term.textContent = "Nome do perfil do WhatsApp"; description.textContent = row.contactName;
        contact.append(term, description); card.append(contact);
      }
      card.append(details);
      const qualification = row.lead?.qualification;
      if (qualification) {
        const fields = document.createElement("dl"); fields.className = "qualification-fields";
        for (const [label, value] of [["Origem", qualification.source === "simulated" ? "Simulada (sem IA externa)" : "Gemini"],
          ["Qualificação", ({ processando: "Em processamento", qualificado: "Qualificado", revisao: "Revisão necessária", falha: "Falha — revisar" })[qualification.status]],
          ["Intenção", qualification.intent], ["Serviço", qualification.serviceName], ["Período", qualification.period]]) {
          if (value) {
            const term = document.createElement("dt"), description = document.createElement("dd");
            term.textContent = label!; description.textContent = value; fields.append(term, description);
          }
        }
        card.append(fields);
      }
      const link = document.createElement("a"); link.className = "whatsapp-link"; link.textContent = "Abrir no WhatsApp";
      link.href = `https://wa.me/${row.phone.replace(/\D/g, "")}`; link.target = "_blank"; link.rel = "noopener noreferrer";
      const actions = document.createElement("div"); actions.className = "lead-actions";
      if (row.lead && ["novo", "qualificado"].includes(row.lead.stage)
        && ["aguardando_menu", "aguardando_detalhes", "qualificando", "aguardando_humano"].includes(row.status)) {
        const leadId = row.lead.id;
        const assume = document.createElement("button"); assume.className = "button button-primary assume-button";
        assume.type = "button"; assume.disabled = assuming.has(leadId);
        assume.textContent = assume.disabled ? "Assumindo…" : "Assumir atendimento";
        assume.setAttribute("aria-label", `Assumir atendimento de ${row.phone}`);
        assume.onclick = () => { void assumeAttendance(leadId, assume); };
        actions.append(assume);
      }
      if (row.lead?.stage === "em_atendimento" && row.status === "em_atendimento_humano") {
        const leadId = row.lead.id;
        for (const result of ["ganho", "perdido"] as const) {
          const close = document.createElement("button"); close.className = "button button-secondary close-button";
          close.type = "button"; close.disabled = closing.has(leadId);
          close.textContent = close.disabled ? "Encerrando…" : result === "ganho" ? "Ganho" : "Perdido";
          close.setAttribute("aria-label", `Encerrar atendimento de ${row.phone} como ${result}`);
          close.onclick = () => { void closeAttendance(leadId, result, close); };
          actions.append(close);
        }
      }
      const historyButton = document.createElement("button"); historyButton.className = "button button-secondary history-button";
      historyButton.type = "button"; historyButton.textContent = "Histórico"; historyButton.dataset.conversation = row.id;
      historyButton.setAttribute("aria-label", `Ver histórico de ${row.contactName ? `${row.contactName}, ` : ""}${row.phone}`);
      historyButton.onclick = () => { openHistory(row, historyButton); };
      actions.append(historyButton, link);
      card.append(actions); cardList.append(card);
    }
    column.append(heading, cardList); board.append(column);
  }
}
async function renderSelectedHistory() {
  if (selected) {
    const historyConversation = selected;
    const messages = await request<DemoMessage[]>(`/api/demo/conversations/${encodeURIComponent(historyConversation)}/messages`);
    if (historyConversation !== selected) return; // Não mostrar histórico da seleção anterior.
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
}
async function refresh() {
  const board = element("board"), adminStatus = element("admin-status");
  board.setAttribute("aria-busy", "true");
  try {
    const revision = boardRevision;
    const rows = await request<DemoConversation[]>("/api/demo/conversations");
    if (revision !== boardRevision) return;
    if (!Array.isArray(rows)) throw new Error("Resposta inválida do painel.");
    if (!selected && !admin) selected = rows.find((row) => row.phone === phone.value)?.id ?? "";
    const previousValue = selected;
    conversation.replaceChildren();
    for (const row of rows) {
      const option = document.createElement("option"); option.value = row.id;
      option.textContent = `${row.phone} · ${row.status}${row.lead ? ` · ${row.lead.stage}` : ""}`; conversation.append(option);
    }
    conversation.value = previousValue;
    const row = rows.find((row) => row.id === selected);
    conversationStatus.textContent = row ? `${row.status}${row.failedJobs ? ` · ${row.failedJobs} job(s) com falha; confira os logs da API.` : ""}` : "Envie uma mensagem para iniciar.";
    const boardVersion = JSON.stringify(rows);
    if (admin && boardVersion !== lastBoard) { renderBoard(rows); lastBoard = boardVersion; }
    if (!admin || historyDialog.open) await renderSelectedHistory();
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
    if (!signedOut) setTimeout(() => { void refresh(); }, 1000);
  }
}
void refresh();
