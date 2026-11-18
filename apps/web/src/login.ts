import type { LoginRequest } from "@copilot-leads/shared";

function element<T extends HTMLElement>(id: string) { return document.getElementById(id) as T; }
const form = element<HTMLFormElement>("login-form"), username = element<HTMLInputElement>("username");
const password = element<HTMLInputElement>("password"), submit = element<HTMLButtonElement>("login-submit");
const error = element("login-error");

// Mesma lista do servidor: qualquer outro destino vira /admin (sem redirecionamento aberto).
const allowedNext = ["/admin", "/simulator"];
const requested = new URLSearchParams(location.search).get("next");
const next = requested !== null && allowedNext.includes(requested) ? requested : "/admin";

function fail(text: string) { error.textContent = text; }

form.addEventListener("submit", (event) => {
  event.preventDefault();
  if (submit.disabled) return;
  if (!username.value.trim() || !password.value) { fail("Informe usuário e senha."); return; }
  void login({ username: username.value, password: password.value });
});

async function login(body: LoginRequest) {
  submit.disabled = true; submit.textContent = "Entrando…"; fail("");
  let redirecting = false;
  try {
    const response = await fetch("/api/auth/login", { method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body), credentials: "same-origin" });
    if (response.ok) { redirecting = true; location.assign(next); return; }
    if (response.status === 401) { fail("Usuário ou senha inválidos."); password.value = ""; password.focus(); return; }
    const problem = await response.json().catch(() => null) as { message?: unknown } | null;
    fail(typeof problem?.message === "string" ? problem.message : "Não foi possível entrar. Tente novamente.");
  } catch { fail("Não foi possível conectar à API. Tente novamente."); }
  finally {
    // Em sucesso o botão continua desabilitado até a navegação.
    if (!redirecting) { submit.disabled = false; submit.textContent = "Entrar"; }
  }
}
