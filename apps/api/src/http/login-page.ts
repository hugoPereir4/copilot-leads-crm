import type { DemoAccess } from "../config/auth.js";

const loginFormMarker = '<form id="login-form"';

export function escapeHtml(value: string): string {
  return value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;").replaceAll("'", "&#39;");
}

// Bloco "Acesso de demonstração", montado no servidor a partir do ambiente: a senha nunca fica
// no login.html versionado. Todos os valores passam por escape HTML.
export function demoAccessBlock(access: DemoAccess): string {
  return `<section class="demo-access" aria-labelledby="demo-access-title">
        <h2 id="demo-access-title">Acesso de demonstração</h2>
        <p class="muted">Credenciais públicas para avaliar o painel com dados sintéticos.</p>
        <dl class="demo-access-credentials">
          <div><dt>Usuário</dt><dd><code>${escapeHtml(access.username)}</code></dd></div>
          <div><dt>Senha</dt><dd><code>${escapeHtml(access.password)}</code></dd></div>
        </dl>
      </section>
      `;
}

// Insere o bloco antes do formulário. Falha cedo (no startup) se o login.html perder o ponto de inserção.
export function loginPageWithDemoAccess(html: string, access: DemoAccess): string {
  const index = html.indexOf(loginFormMarker);
  if (index < 0 || html.indexOf(loginFormMarker, index + 1) >= 0) throw new Error("login.html sem o formulário esperado para o acesso de demonstração.");
  return `${html.slice(0, index)}${demoAccessBlock(access)}${html.slice(index)}`;
}
