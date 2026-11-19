import { deepEqual, equal, ok } from "node:assert/strict";
import { test } from "node:test";
import { displayNameSchema, loginRequestSchema, passwordSchema, usernameSchema, type Attendant } from "../contracts/attendant.js";
import { createAttendantAuth } from "./attendant-auth.js";
import { createAttendant, setAttendantPassword } from "./manage-attendants.js";
import type { AttendantStore, NewSession, PasswordHasher, SessionStore, SessionTokens, StoredAttendant } from "./ports.js";

// Fakes em memória: o hasher marca a senha de forma reversível só para o teste observar chamadas.
function fakes(start = new Date("2026-11-18T12:00:00.000Z")) {
  const attendants = new Map<string, StoredAttendant>();
  const sessions = new Map<string, NewSession>();
  const verified: string[] = []; let hashed = 0, issued = 0, now = start;
  const hasher: PasswordHasher = {
    async hash(password) { hashed++; return `fake$${password}`; },
    async verify(password, encoded) { verified.push(encoded); return encoded === `fake$${password}`; },
  };
  const tokens: SessionTokens = {
    issue: () => `token-${++issued}`.padEnd(43, "x"),
    digest: (token) => token.length === 43 ? Buffer.from(token.padEnd(32, "-").slice(0, 32)) : undefined,
  };
  const key = (hash: Buffer) => hash.toString("hex");
  const attendantStore: AttendantStore = {
    async findByUsername(username) { return attendants.get(username); },
    async create(input) {
      if (attendants.has(input.username)) return { status: "duplicado" };
      const attendant = { id: `id-${attendants.size + 1}`, username: input.username, displayName: input.displayName };
      attendants.set(input.username, { ...attendant, passwordHash: input.passwordHash });
      return { status: "criado", attendant };
    },
    async setPasswordAndRevokeSessions(username, passwordHash) {
      const stored = attendants.get(username); if (!stored) return { status: "nao_encontrado" };
      attendants.set(username, { ...stored, passwordHash });
      for (const [token, session] of sessions) if (session.attendantId === stored.id) sessions.delete(token);
      return { status: "atualizado", attendant: { id: stored.id, username: stored.username, displayName: stored.displayName } };
    },
  };
  const sessionStore: SessionStore = {
    async create(session) { sessions.set(key(session.tokenHash), session); },
    async findAttendant(hash, at): Promise<Attendant | undefined> {
      const session = sessions.get(key(hash)); if (!session || session.expiresAt <= at) return undefined;
      const stored = [...attendants.values()].find((item) => item.id === session.attendantId);
      return stored && { id: stored.id, username: stored.username, displayName: stored.displayName };
    },
    async delete(hash) { sessions.delete(key(hash)); },
    async deleteExpired(at) { for (const [token, session] of sessions) if (session.expiresAt <= at) sessions.delete(token); },
  };
  const auth = createAttendantAuth({ attendants: attendantStore, sessions: sessionStore, hasher, tokens, clock: () => now, sessionTtlHours: 12 });
  return { auth, attendants, deps: { attendants: attendantStore, hasher }, sessions, verified, hashed: () => hashed,
    advance(milliseconds: number) { now = new Date(now.getTime() + milliseconds); } };
}
const password = "senha-sintetica-12";

test("validação normaliza usuário e limita nome de exibição e senha", () => {
  equal(usernameSchema.parse("  Atendente.Teste_1  "), "atendente.teste_1");
  for (const invalid of ["ab", "a".repeat(33), "com espaço", "ação", "user@host"]) equal(usernameSchema.safeParse(invalid).success, false, invalid);
  equal(displayNameSchema.parse("  Atendente Teste  "), "Atendente Teste");
  equal(displayNameSchema.safeParse("   ").success, false); equal(displayNameSchema.safeParse("x".repeat(81)).success, false);
  equal(passwordSchema.safeParse("a".repeat(11)).success, false); equal(passwordSchema.safeParse("a".repeat(12)).success, true);
  equal(passwordSchema.safeParse("a".repeat(128)).success, true); equal(passwordSchema.safeParse("a".repeat(129)).success, false);
  equal(passwordSchema.parse(" com espaços  nas pontas "), " com espaços  nas pontas ");
  equal(loginRequestSchema.safeParse({ username: "atendente.teste", password }).success, true);
  for (const body of [null, [], "texto", {}, { username: "atendente.teste" }, { username: "atendente.teste", password, extra: true },
    { username: 1, password }, { username: "atendente.teste", password: "x".repeat(1025) }]) {
    equal(loginRequestSchema.safeParse(body).success, false, JSON.stringify(body));
  }
});

test("login válido cria sessão com validade da configuração e devolve o token só nesse resultado", async () => {
  const state = fakes();
  equal((await createAttendant({ username: " Atendente.Teste ", displayName: " Atendente Teste ", password }, state.deps)).status, "criado");
  const result = await state.auth.login({ username: "ATENDENTE.TESTE", password });
  ok(result.status === "autenticado");
  deepEqual(result.attendant, { id: "id-1", username: "atendente.teste", displayName: "Atendente Teste" });
  equal(result.expiresAt.toISOString(), "2026-11-19T00:00:00.000Z");
  equal(state.sessions.size, 1);
  deepEqual(await state.auth.authenticate(result.token), { status: "autenticado", attendant: result.attendant });
});

test("usuário inexistente e senha errada têm o mesmo resultado e o mesmo custo de verify", async () => {
  const state = fakes();
  await createAttendant({ username: "atendente.teste", displayName: "Atendente Teste", password }, state.deps);
  const hashesBefore = state.hashed();
  const wrong = await state.auth.login({ username: "atendente.teste", password: "senha-errada-123" });
  const missing = await state.auth.login({ username: "inexistente", password });
  const malformed = await state.auth.login({ username: "x", password: "curta" });
  deepEqual(wrong, { status: "credenciais_invalidas" }); deepEqual(missing, wrong); deepEqual(malformed, wrong);
  equal(state.verified.length, 3); equal(state.sessions.size, 0);
  // O hash fictício é gerado uma única vez, sob demanda.
  equal(state.hashed(), hashesBefore + 1); equal(state.verified[1], state.verified[2]);
  deepEqual(await state.auth.login({ username: "atendente.teste" }), { status: "entrada_invalida" });
});

test("sessão expira pelo relógio injetado e login apaga sessões expiradas", async () => {
  const state = fakes();
  await createAttendant({ username: "atendente.teste", displayName: "Atendente Teste", password }, state.deps);
  const first = await state.auth.login({ username: "atendente.teste", password }); ok(first.status === "autenticado");
  state.advance(12 * 3_600_000 - 1);
  equal((await state.auth.authenticate(first.token)).status, "autenticado");
  state.advance(1);
  deepEqual(await state.auth.authenticate(first.token), { status: "nao_autenticado" });
  equal(state.sessions.size, 1);
  const second = await state.auth.login({ username: "atendente.teste", password }); ok(second.status === "autenticado");
  equal(state.sessions.size, 1); equal((await state.auth.authenticate(second.token)).status, "autenticado");
});

test("logout apaga só a sessão do token e é idempotente; token ausente ou malformado não autentica", async () => {
  const state = fakes();
  await createAttendant({ username: "atendente.teste", displayName: "Atendente Teste", password }, state.deps);
  const first = await state.auth.login({ username: "atendente.teste", password }); ok(first.status === "autenticado");
  const second = await state.auth.login({ username: "atendente.teste", password }); ok(second.status === "autenticado");
  await state.auth.logout(first.token); await state.auth.logout(first.token); await state.auth.logout(undefined); await state.auth.logout("malformado");
  equal((await state.auth.authenticate(first.token)).status, "nao_autenticado");
  equal((await state.auth.authenticate(second.token)).status, "autenticado");
  for (const token of [undefined, "", "malformado"]) equal((await state.auth.authenticate(token)).status, "nao_autenticado");
});

test("criação e troca de senha validam entradas, recusam duplicado e revogam sessões", async () => {
  const state = fakes();
  deepEqual(await createAttendant({ username: "x", displayName: " ", password: "curta" }, state.deps),
    { status: "entrada_invalida", fields: ["username", "displayName", "password"] });
  equal((await createAttendant({ username: "atendente.teste", displayName: "Atendente Teste", password }, state.deps)).status, "criado");
  const hashes = state.hashed();
  deepEqual(await createAttendant({ username: "ATENDENTE.TESTE", displayName: "Outro", password }, state.deps), { status: "duplicado" });
  equal(state.hashed(), hashes);
  deepEqual(await setAttendantPassword({ username: "ninguem", password }, state.deps), { status: "nao_encontrado" });
  deepEqual(await setAttendantPassword({ username: "atendente.teste", password: "curta" }, state.deps), { status: "entrada_invalida", fields: ["password"] });
  const session = await state.auth.login({ username: "atendente.teste", password }); ok(session.status === "autenticado");
  const changed = await setAttendantPassword({ username: "atendente.teste", password: "nova-senha-sintetica" }, state.deps);
  equal(changed.status, "atualizado");
  equal((await state.auth.authenticate(session.token)).status, "nao_autenticado");
  equal((await state.auth.login({ username: "atendente.teste", password })).status, "credenciais_invalidas");
  equal((await state.auth.login({ username: "atendente.teste", password: "nova-senha-sintetica" })).status, "autenticado");
});
