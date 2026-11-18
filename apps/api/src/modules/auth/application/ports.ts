import type { Attendant } from "../contracts/attendant.js";

export type Clock = () => Date;

export type StoredAttendant = Attendant & { passwordHash: string };

export interface AttendantStore {
  findByUsername(username: string): Promise<StoredAttendant | undefined>;
  create(input: { username: string; displayName: string; passwordHash: string }):
    Promise<{ status: "criado"; attendant: Attendant } | { status: "duplicado" }>;
  // Troca a senha e apaga todas as sessões do atendente na mesma transação.
  setPasswordAndRevokeSessions(username: string, passwordHash: string):
    Promise<{ status: "atualizado"; attendant: Attendant } | { status: "nao_encontrado" }>;
}

export type NewSession = { tokenHash: Buffer; attendantId: string; createdAt: Date; expiresAt: Date };

export interface SessionStore {
  create(session: NewSession): Promise<void>;
  // Só devolve o atendente se expires_at > now.
  findAttendant(tokenHash: Buffer, now: Date): Promise<Attendant | undefined>;
  delete(tokenHash: Buffer): Promise<void>;
  deleteExpired(now: Date): Promise<void>;
}

export interface PasswordHasher {
  hash(password: string): Promise<string>;
  // Formato desconhecido ou corrompido devolve false, nunca lança.
  verify(password: string, encodedHash: string): Promise<boolean>;
}

export interface SessionTokens {
  issue(): string;
  // undefined para token malformado: nem chega ao banco.
  digest(token: string): Buffer | undefined;
}
