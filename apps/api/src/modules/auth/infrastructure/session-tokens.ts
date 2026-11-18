import { createHash, randomBytes } from "node:crypto";
import type { SessionTokens } from "../application/ports.js";

// 32 bytes aleatórios em base64url sem padding têm exatamente 43 caracteres.
const tokenFormat = /^[A-Za-z0-9_-]{43}$/;

export const sessionTokens: SessionTokens = {
  issue: () => randomBytes(32).toString("base64url"),
  // O banco guarda só o SHA-256 do token; o token em claro existe apenas no cookie.
  digest: (token) => tokenFormat.test(token) ? createHash("sha256").update(token, "utf8").digest() : undefined,
};
