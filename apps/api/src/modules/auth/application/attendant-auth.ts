import { loginRequestSchema, usernameSchema, type Attendant } from "../contracts/attendant.js";
import type { AttendantStore, Clock, PasswordHasher, SessionStore, SessionTokens } from "./ports.js";

export type LoginResult =
  | { status: "entrada_invalida" }
  | { status: "credenciais_invalidas" }
  | { status: "autenticado"; attendant: Attendant; token: string; expiresAt: Date };

export type AuthenticationResult = { status: "autenticado"; attendant: Attendant } | { status: "nao_autenticado" };

export type AttendantAuthDependencies = {
  attendants: AttendantStore;
  sessions: SessionStore;
  hasher: PasswordHasher;
  tokens: SessionTokens;
  clock: Clock;
  sessionTtlHours: number;
};

export function createAttendantAuth(dependencies: AttendantAuthDependencies) {
  const { attendants, sessions, hasher, tokens, clock, sessionTtlHours } = dependencies;
  // Hash fictício gerado uma vez, sob demanda: usuário inexistente paga o mesmo custo de verify.
  let dummyHash: Promise<string> | undefined;
  const dummy = () => {
    dummyHash ??= hasher.hash(tokens.issue()).catch((error: unknown) => { dummyHash = undefined; throw error; });
    return dummyHash;
  };

  return {
    async login(body: unknown): Promise<LoginResult> {
      const input = loginRequestSchema.safeParse(body);
      if (!input.success) return { status: "entrada_invalida" };
      const username = usernameSchema.safeParse(input.data.username);
      const stored = username.success ? await attendants.findByUsername(username.data) : undefined;
      const valid = await hasher.verify(input.data.password, stored?.passwordHash ?? await dummy());
      if (!stored || !valid) return { status: "credenciais_invalidas" };
      const now = clock();
      await sessions.deleteExpired(now);
      const token = tokens.issue();
      const expiresAt = new Date(now.getTime() + sessionTtlHours * 3_600_000);
      await sessions.create({ tokenHash: tokens.digest(token)!, attendantId: stored.id, createdAt: now, expiresAt });
      return { status: "autenticado", attendant: { id: stored.id, username: stored.username, displayName: stored.displayName }, token, expiresAt };
    },

    async authenticate(token: string | undefined): Promise<AuthenticationResult> {
      const digest = token === undefined ? undefined : tokens.digest(token);
      if (!digest) return { status: "nao_autenticado" };
      const attendant = await sessions.findAttendant(digest, clock());
      return attendant ? { status: "autenticado", attendant } : { status: "nao_autenticado" };
    },

    async logout(token: string | undefined): Promise<void> {
      const digest = token === undefined ? undefined : tokens.digest(token);
      if (digest) await sessions.delete(digest);
    },
  };
}

export type AttendantAuth = ReturnType<typeof createAttendantAuth>;
