import { equal, ok, rejects } from "node:assert/strict";
import { randomBytes, randomUUID } from "node:crypto";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { runner } from "node-pg-migrate";
import { Client } from "pg";
import { readDatabaseConfig } from "../../config/database.js";
import { createDatabasePool } from "./pool.js";

test("migração de atendentes e sessões em banco descartável", { timeout: 60000 }, async (t) => {
  const config = readDatabaseConfig(process.env);
  if (!["127.0.0.1", "localhost", "::1"].includes(config.host)) throw new Error("O teste de integração exige um PostgreSQL local.");
  const database = `copilot_attendants_test_${randomUUID().replaceAll("-", "")}`;
  const admin = new Client({ ...config, connectionTimeoutMillis: 5000 });
  const testConfig = { ...config, database };
  const pool = createDatabasePool(testConfig);
  let created = false;
  let sequence = 0;

  async function migrate(direction: "up" | "down") {
    const client = new Client({ ...testConfig, connectionTimeoutMillis: 5000 });
    try {
      await client.connect();
      return await runner({ dbClient: client, dir: fileURLToPath(new URL("../../../migrations/", import.meta.url)), direction,
        ...(direction === "down" ? { count: 1 } : {}), schema: "public", migrationsTable: "pgmigrations",
        checkOrder: true, singleTransaction: true, logger: { info: () => {}, warn: () => {}, error: () => {} } });
    } finally { await client.end(); }
  }
  const attendant = async (username = `atendente${++sequence}`, displayName = "Atendente sintético") => {
    const result = await pool.query<{ id: string }>(`INSERT INTO public.attendants (username, display_name, password_hash)
      VALUES ($1, $2, 'scrypt$hash_sintetico') RETURNING id;`, [username, displayName]);
    ok(result.rows[0]); return result.rows[0].id;
  };
  const sessionInsert = (attendantId: string, tokenHash = randomBytes(32), interval = "1 hour") => pool.query(
    `INSERT INTO public.attendant_sessions (token_hash, attendant_id, expires_at) VALUES ($1, $2, now() + $3::interval);`,
    [tokenHash, attendantId, interval]);
  const relation = async (name: string) => (await pool.query("SELECT to_regclass($1) AS relation;", [`public.${name}`])).rows[0]?.relation;

  try {
    await admin.connect();
    await admin.query(`CREATE DATABASE "${database}" TEMPLATE template0;`); created = true;
    await migrate("up");

    await t.test("aplica as duas tabelas depois das migrações existentes, com id e datas padrão", async () => {
      equal((await pool.query("SELECT name FROM public.pgmigrations ORDER BY run_on DESC, id DESC LIMIT 1;")).rows[0]?.name,
        "1795046400000_create_attendants");
      const id = await attendant("atendente.teste_1-a");
      const row = (await pool.query("SELECT * FROM public.attendants WHERE id = $1;", [id])).rows[0]; ok(row);
      ok(row.created_at instanceof Date); ok(row.updated_at instanceof Date);
      ok((await pool.query("SELECT 1 FROM pg_indexes WHERE indexname = 'attendant_sessions_attendant_id_idx';")).rowCount);
    });

    await t.test("username é único e só aceita o formato em minúsculas", async () => {
      await attendant("unico");
      await rejects(attendant("unico"), { code: "23505" });
      for (const username of ["ab", "a".repeat(33), "Maiusculo", "com espaço", "ação", "user@host", ""]) {
        await rejects(attendant(username), { code: "23514" }, username);
      }
      await attendant("a".repeat(32)); await attendant("abc");
    });

    await t.test("nome de exibição exige de 1 a 80 caracteres após trim", async () => {
      for (const displayName of ["", "   ", "x".repeat(81), ` ${"x".repeat(81)} `]) await rejects(attendant(undefined, displayName), { code: "23514" });
      await attendant(undefined, "x".repeat(80)); await attendant(undefined, `  ${"y".repeat(80)}  `);
      await rejects(pool.query("INSERT INTO public.attendants (username, display_name) VALUES ('semhash', 'Sem hash');"), { code: "23502" });
    });

    await t.test("sessão exige hash de 32 bytes, atendente existente e expiração posterior à criação", async () => {
      const id = await attendant();
      const hash = randomBytes(32);
      await sessionInsert(id, hash);
      await rejects(sessionInsert(id, hash), { code: "23505" });
      for (const size of [0, 31, 33, 64]) await rejects(sessionInsert(id, randomBytes(size)), { code: "23514" });
      await rejects(sessionInsert(id, randomBytes(32), "0 seconds"), { code: "23514" });
      await rejects(sessionInsert(id, randomBytes(32), "-1 hour"), { code: "23514" });
      await rejects(sessionInsert(randomUUID()), { code: "23503" });
    });

    await t.test("apagar o atendente apaga suas sessões em cascata, sem tocar nas de outro", async () => {
      const removed = await attendant(), kept = await attendant();
      await sessionInsert(removed); await sessionInsert(removed); await sessionInsert(kept);
      await pool.query("DELETE FROM public.attendants WHERE id = $1;", [removed]);
      equal((await pool.query("SELECT 1 FROM public.attendant_sessions WHERE attendant_id = $1;", [removed])).rowCount, 0);
      equal((await pool.query("SELECT 1 FROM public.attendant_sessions WHERE attendant_id = $1;", [kept])).rowCount, 1);
    });

    await t.test("down remove só as duas tabelas e up reaplica", async () => {
      await migrate("down");
      equal(await relation("attendant_sessions"), null); equal(await relation("attendants"), null);
      ok(await relation("qualification_runs")); ok(await relation("leads"));
      equal((await pool.query("SELECT count(*)::integer AS count FROM public.pgmigrations;")).rows[0]?.count, 7);
      await migrate("up");
      ok(await relation("attendants")); equal((await pool.query("SELECT * FROM public.attendants;")).rowCount, 0);
    });
  } finally {
    try {
      await pool.end();
      if (created) await admin.query(`DROP DATABASE "${database}" WITH (FORCE);`);
    } finally { await admin.end(); }
  }
});
