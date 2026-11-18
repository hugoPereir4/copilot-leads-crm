import type { Request } from "express";
import type { AuthConfig } from "../../../config/auth.js";

export const SESSION_COOKIE = "copilot_session";

// Parser mínimo do header Cookie (RFC 6265): pares nome=valor separados por ";".
// O primeiro valor de um nome repetido prevalece; valor com codificação inválida é ignorado.
export function parseCookies(header: string | undefined): Map<string, string> {
  const cookies = new Map<string, string>();
  if (!header) return cookies;
  for (const part of header.split(";")) {
    const separator = part.indexOf("=");
    if (separator <= 0) continue;
    const name = part.slice(0, separator).trim();
    let value = part.slice(separator + 1).trim();
    if (value.length >= 2 && value.startsWith("\"") && value.endsWith("\"")) value = value.slice(1, -1);
    if (!name || cookies.has(name)) continue;
    try { cookies.set(name, decodeURIComponent(value)); } catch { /* valor malformado: ignorado. */ }
  }
  return cookies;
}

export function sessionTokenFrom(request: Request) {
  return parseCookies(request.get("cookie")).get(SESSION_COOKIE);
}

function attributes(config: AuthConfig, maxAge: number) {
  return `HttpOnly; SameSite=Lax; Path=/; Max-Age=${maxAge}${config.cookieSecure ? "; Secure" : ""}`;
}

// O token é base64url: não precisa de codificação no cookie.
export function sessionCookie(token: string, config: AuthConfig) {
  return `${SESSION_COOKIE}=${token}; ${attributes(config, config.sessionTtlHours * 3600)}`;
}

export function clearedSessionCookie(config: AuthConfig) {
  return `${SESSION_COOKIE}=; ${attributes(config, 0)}`;
}
