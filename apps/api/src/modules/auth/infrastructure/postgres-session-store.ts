import type { Pool } from "pg";
import type { Attendant } from "../contracts/attendant.js";
import type { NewSession, SessionStore } from "../application/ports.js";

export class PostgresSessionStore implements SessionStore {
  constructor(private readonly pool: Pool) {}

  async create(session: NewSession) {
    // created_at vem do relógio da aplicação para o CHECK expires_at > created_at valer também com relógio injetado.
    await this.pool.query(`INSERT INTO public.attendant_sessions (token_hash, attendant_id, created_at, expires_at)
      VALUES ($1, $2, $3, $4);`, [session.tokenHash, session.attendantId, session.createdAt, session.expiresAt]);
  }

  async findAttendant(tokenHash: Buffer, now: Date): Promise<Attendant | undefined> {
    const result = await this.pool.query<{ id: string; username: string; display_name: string }>(`SELECT a.id, a.username, a.display_name
      FROM public.attendant_sessions s JOIN public.attendants a ON a.id = s.attendant_id
      WHERE s.token_hash = $1 AND s.expires_at > $2;`, [tokenHash, now]);
    const row = result.rows[0];
    return row ? { id: row.id, username: row.username, displayName: row.display_name } : undefined;
  }

  async delete(tokenHash: Buffer) {
    await this.pool.query("DELETE FROM public.attendant_sessions WHERE token_hash = $1;", [tokenHash]);
  }

  async deleteExpired(now: Date) {
    await this.pool.query("DELETE FROM public.attendant_sessions WHERE expires_at <= $1;", [now]);
  }
}
