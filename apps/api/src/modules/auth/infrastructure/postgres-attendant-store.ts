import type { Pool } from "pg";
import type { Attendant } from "../contracts/attendant.js";
import type { AttendantStore, StoredAttendant } from "../application/ports.js";

type AttendantRow = { id: string; username: string; display_name: string };

const toAttendant = (row: AttendantRow): Attendant => ({ id: row.id, username: row.username, displayName: row.display_name });

export class PostgresAttendantStore implements AttendantStore {
  constructor(private readonly pool: Pool) {}

  async findByUsername(username: string): Promise<StoredAttendant | undefined> {
    const result = await this.pool.query<AttendantRow & { password_hash: string }>(
      "SELECT id, username, display_name, password_hash FROM public.attendants WHERE username = $1;", [username]);
    const row = result.rows[0];
    return row ? { ...toAttendant(row), passwordHash: row.password_hash } : undefined;
  }

  async create(input: { username: string; displayName: string; passwordHash: string }) {
    const result = await this.pool.query<AttendantRow>(`INSERT INTO public.attendants (username, display_name, password_hash)
      VALUES ($1, $2, $3) ON CONFLICT (username) DO NOTHING RETURNING id, username, display_name;`,
    [input.username, input.displayName, input.passwordHash]);
    const row = result.rows[0];
    return row ? { status: "criado" as const, attendant: toAttendant(row) } : { status: "duplicado" as const };
  }

  async setPasswordAndRevokeSessions(username: string, passwordHash: string) {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN;");
      const result = await client.query<AttendantRow>(`UPDATE public.attendants SET password_hash = $2, updated_at = now()
        WHERE username = $1 RETURNING id, username, display_name;`, [username, passwordHash]);
      const row = result.rows[0];
      if (!row) { await client.query("ROLLBACK;"); return { status: "nao_encontrado" as const }; }
      await client.query("DELETE FROM public.attendant_sessions WHERE attendant_id = $1;", [row.id]);
      await client.query("COMMIT;");
      return { status: "atualizado" as const, attendant: toAttendant(row) };
    } catch (error) {
      await client.query("ROLLBACK;").catch(() => {});
      throw error;
    } finally { client.release(); }
  }
}
