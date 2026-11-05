import { deepEqual, equal, match, ok, rejects } from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { runner } from "node-pg-migrate";
import { Client } from "pg";
import { readDatabaseConfig } from "../../config/database.js";
import { createDatabasePool } from "./pool.js";

// Este arquivo só é executado pelo comando separado test:integration.
// Cria e remove exclusivamente um banco descartável com nome gerado neste teste.
test("migração de contatos em banco descartável", { timeout: 60000 }, async (t) => {
  const config = readDatabaseConfig(process.env);

  if (!["127.0.0.1", "localhost", "::1"].includes(config.host)) {
    throw new Error("O teste de integração exige um PostgreSQL local.");
  }

  const temporaryDatabase = `copilot_contacts_test_${randomUUID().replaceAll("-", "")}`;
  const migrationName = "1793750400000_create_contacts";
  const admin = new Client({ ...config, connectionTimeoutMillis: 5000 });
  const testConfig = { ...config, database: temporaryDatabase };
  const pool = createDatabasePool(testConfig);
  let databaseCreated = false;

  const migrate = async (direction: "up" | "down") => {
    const migrationClient = new Client({ ...testConfig, connectionTimeoutMillis: 5000 });
    try {
      await migrationClient.connect();
      return await runner({
        dbClient: migrationClient,
        dir: fileURLToPath(new URL("../../../migrations/", import.meta.url)),
        file: migrationName,
        direction,
        schema: "public",
        migrationsTable: "pgmigrations",
        checkOrder: true,
        singleTransaction: true,
        logger: {
          info: () => {},
          warn: () => {},
          error: () => {},
        },
      });
    } finally {
      // Aguarda o encerramento antes de permitir a remoção do banco descartável.
      await migrationClient.end();
    }
  };

  try {
    await admin.connect();
    // O identificador contém apenas prefixo fixo e caracteres hexadecimais de um UUID.
    await admin.query(`CREATE DATABASE "${temporaryDatabase}" TEMPLATE template0;`);
    databaseCreated = true;

    await t.test("aplica a migração e registra seu nome no histórico", async () => {
      const applied = await migrate("up");
      equal(applied.length, 1);
      equal(applied[0]?.name, migrationName);
      const history = await pool.query<{ name: string }>("SELECT name FROM public.pgmigrations;");
      deepEqual(history.rows, [{ name: migrationName }]);
    });

    await t.test("gera UUID e data e permite nome ausente", async () => {
      const result = await pool.query<{
        id: string;
        display_name: string | null;
        created_at: Date;
      }>("INSERT INTO public.contacts (phone) VALUES ($1) RETURNING id, display_name, created_at;",
      ["+15550000001"]);
      const contact = result.rows[0];
      ok(contact);
      match(contact.id, /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i);
      equal(contact.display_name, null);
      ok(contact.created_at instanceof Date);
      ok(Number.isFinite(contact.created_at.getTime()));
    });

    await t.test("rejeita telefone, identificador e data explicitamente nulos", async () => {
      await rejects(pool.query("INSERT INTO public.contacts DEFAULT VALUES;"),
        { code: "23502", column: "phone" });
      await rejects(pool.query("INSERT INTO public.contacts (id, phone) VALUES (NULL, $1);",
        ["+15550000002"]), { code: "23502", column: "id" });
      await rejects(pool.query("INSERT INTO public.contacts (phone, created_at) VALUES ($1, NULL);",
        ["+15550000002"]), { code: "23502", column: "created_at" });
    });

    await t.test("rejeita telefone vazio ou fora da representação canônica", async () => {
      for (const phone of ["", "15550000002", "+05550000002", "+1 5550000002", "+1", "+1234567890123456"]) {
        await rejects(pool.query("INSERT INTO public.contacts (phone) VALUES ($1);", [phone]),
          { code: "23514", constraint: "contacts_phone_format_check" });
      }
    });

    await t.test("rejeita um segundo cadastro com o mesmo telefone", async () => {
      await pool.query("INSERT INTO public.contacts (phone, display_name) VALUES ($1, $2);",
        ["+15550000003", "Contato sintético"]);
      await rejects(pool.query("INSERT INTO public.contacts (phone) VALUES ($1);", ["+15550000003"]),
        { code: "23505", constraint: "contacts_phone_key" });
    });

    await t.test("mantém um único cadastro em duas inserções concorrentes", async () => {
      const phone = "+15550000004";
      const insert = () => pool.query("INSERT INTO public.contacts (phone) VALUES ($1);", [phone]);
      const results = await Promise.allSettled([insert(), insert()]);
      equal(results.filter((result) => result.status === "fulfilled").length, 1);
      const failure = results.find((result) => result.status === "rejected");
      ok(failure?.status === "rejected");
      const reason: unknown = failure.reason;
      ok(reason !== null && typeof reason === "object" && "code" in reason);
      equal(reason.code, "23505");
      const count = await pool.query<{ count: number }>(
        "SELECT count(*)::integer AS count FROM public.contacts WHERE phone = $1;", [phone]);
      equal(count.rows[0]?.count, 1);
    });

    await t.test("não reaplica uma migração registrada nem remove os dados", async () => {
      const applied = await migrate("up");
      equal(applied.length, 0);
      const contact = await pool.query("SELECT id FROM public.contacts WHERE phone = $1;", ["+15550000001"]);
      equal(contact.rowCount, 1);
    });

    await t.test("reverte a migração e permite aplicá-la novamente", async () => {
      const reverted = await migrate("down");
      equal(reverted.length, 1);
      const table = await pool.query<{ table_name: string | null }>(
        "SELECT to_regclass('public.contacts')::text AS table_name;");
      equal(table.rows[0]?.table_name, null);
      const history = await pool.query("SELECT name FROM public.pgmigrations;");
      equal(history.rowCount, 0);
      equal((await migrate("up")).length, 1);
    });
  } finally {
    try {
      await pool.end();
      // Não remove banco pré-existente: a limpeza exige CREATE DATABASE bem-sucedido nesta execução.
      if (databaseCreated) {
        await admin.query(`DROP DATABASE "${temporaryDatabase}" WITH (FORCE);`);
      }
    } finally {
      await admin.end();
    }
  }
});
