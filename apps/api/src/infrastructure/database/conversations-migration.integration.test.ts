import { deepEqual, equal, match, ok, rejects } from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { runner } from "node-pg-migrate";
import { Client } from "pg";
import { readDatabaseConfig } from "../../config/database.js";
import { createDatabasePool } from "./pool.js";

test("migração de conversas em banco descartável", { timeout: 60000 }, async (t) => {
  const config = readDatabaseConfig(process.env);

  if (!["127.0.0.1", "localhost", "::1"].includes(config.host)) {
    throw new Error("O teste de integração exige um PostgreSQL local.");
  }

  const temporaryDatabase = `copilot_conversations_test_${randomUUID().replaceAll("-", "")}`;
  const contactsMigration = "1793750400000_create_contacts";
  const conversationsMigration = "1793750401000_create_conversations";
  const admin = new Client({ ...config, connectionTimeoutMillis: 5000 });
  const testConfig = { ...config, database: temporaryDatabase };
  const pool = createDatabasePool(testConfig);
  let databaseCreated = false;
  let contactSequence = 0;

  const migrate = (direction: "up" | "down", file = conversationsMigration) => runner({
    databaseUrl: { ...testConfig, connectionTimeoutMillis: 5000 },
    dir: fileURLToPath(new URL("../../../migrations/", import.meta.url)),
    file,
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

  // Fixture de teste: cada cenário recebe um contato sintético diferente.
  async function createContact(): Promise<string> {
    contactSequence += 1;
    const phone = `+1555${String(contactSequence).padStart(7, "0")}`;
    const result = await pool.query<{ id: string }>(
      "INSERT INTO public.contacts (phone) VALUES ($1) RETURNING id;", [phone]);
    const contact = result.rows[0];
    ok(contact);
    return contact.id;
  }

  try {
    await admin.connect();
    // O nome usa somente um prefixo fixo e caracteres hexadecimais gerados aqui.
    await admin.query(`CREATE DATABASE "${temporaryDatabase}" TEMPLATE template0;`);
    databaseCreated = true;
    await migrate("up", contactsMigration);

    await t.test("aplica conversas após contatos e registra as duas migrações", async () => {
      const applied = await migrate("up");
      equal(applied.length, 1);
      equal(applied[0]?.name, conversationsMigration);
      const history = await pool.query<{ name: string }>(
        "SELECT name FROM public.pgmigrations ORDER BY id;");
      deepEqual(history.rows, [{ name: contactsMigration }, { name: conversationsMigration }]);
    });

    await t.test("gera UUID e data e inicia aguardando menu com datas de atividade ausentes", async () => {
      const contactId = await createContact();
      const result = await pool.query<{
        id: string;
        status: string;
        created_at: Date;
        last_message_at: Date | null;
        closed_at: Date | null;
      }>("INSERT INTO public.conversations (contact_id) VALUES ($1) RETURNING *;", [contactId]);
      const conversation = result.rows[0];
      ok(conversation);
      match(conversation.id, /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i);
      equal(conversation.status, "aguardando_menu");
      ok(conversation.created_at instanceof Date);
      ok(Number.isFinite(conversation.created_at.getTime()));
      equal(conversation.last_message_at, null);
      equal(conversation.closed_at, null);
    });

    await t.test("exige contato existente e impede apagar um contato com histórico", async () => {
      await rejects(pool.query("INSERT INTO public.conversations DEFAULT VALUES;"),
        { code: "23502", column: "contact_id" });
      await rejects(pool.query("INSERT INTO public.conversations (contact_id) VALUES ($1);", [randomUUID()]),
        { code: "23503", constraint: "conversations_contact_id_fkey" });
      const contactId = await createContact();
      await pool.query("INSERT INTO public.conversations (contact_id) VALUES ($1);", [contactId]);
      // No PostgreSQL 18, ON DELETE RESTRICT retorna restrict_violation.
      await rejects(pool.query("DELETE FROM public.contacts WHERE id = $1;", [contactId]),
        { code: "23001", constraint: "conversations_contact_id_fkey" });
    });

    await t.test("aceita os seis estados previstos e rejeita estado inválido ou nulo", async () => {
      const statuses = ["aguardando_menu", "aguardando_detalhes", "qualificando", "aguardando_humano",
        "em_atendimento_humano", "encerrada"];
      for (const status of statuses) {
        const contactId = await createContact();
        await pool.query("INSERT INTO public.conversations (contact_id, status, closed_at) VALUES ($1, $2, $3);",
          [contactId, status, status === "encerrada" ? new Date() : null]);
      }
      const contactId = await createContact();
      await rejects(pool.query("INSERT INTO public.conversations (contact_id, status) VALUES ($1, $2);",
        [contactId, "estado_invalido"]), { code: "23514", constraint: "conversations_status_check" });
      await rejects(pool.query("INSERT INTO public.conversations (contact_id, status) VALUES ($1, NULL);",
        [contactId]), { code: "23502", column: "status" });
    });

    await t.test("exige data ao encerrar e mantém data de encerramento ausente nas abertas", async () => {
      const contactId = await createContact();
      await rejects(pool.query("INSERT INTO public.conversations (contact_id, status) VALUES ($1, 'encerrada');",
        [contactId]), { code: "23514", constraint: "conversations_closed_at_status_check" });
      await rejects(pool.query("INSERT INTO public.conversations (contact_id, closed_at) VALUES ($1, now());",
        [contactId]), { code: "23514", constraint: "conversations_closed_at_status_check" });
    });

    await t.test("permite uma aberta e várias encerradas por contato sem apagar o histórico", async () => {
      const contactId = await createContact();
      await pool.query("INSERT INTO public.conversations (contact_id) VALUES ($1);", [contactId]);
      await rejects(pool.query("INSERT INTO public.conversations (contact_id, status) VALUES ($1, 'aguardando_humano');",
        [contactId]), { code: "23505", constraint: "conversations_one_open_per_contact_idx" });
      for (let cycle = 0; cycle < 2; cycle += 1) {
        await pool.query("UPDATE public.conversations SET status = 'encerrada', closed_at = now() WHERE contact_id = $1 AND status <> 'encerrada';",
          [contactId]);
        await pool.query("INSERT INTO public.conversations (contact_id) VALUES ($1);", [contactId]);
      }
      const counts = await pool.query<{ total: number; closed: number; open: number }>(
        "SELECT count(*)::integer AS total, (count(*) FILTER (WHERE status = 'encerrada'))::integer AS closed, (count(*) FILTER (WHERE status <> 'encerrada'))::integer AS open FROM public.conversations WHERE contact_id = $1;",
        [contactId]);
      deepEqual(counts.rows[0], { total: 3, closed: 2, open: 1 });
    });

    await t.test("protege a unicidade da conversa aberta em inserções concorrentes", async () => {
      const contactId = await createContact();
      const insert = () => pool.query("INSERT INTO public.conversations (contact_id) VALUES ($1);", [contactId]);
      const results = await Promise.allSettled([insert(), insert()]);
      equal(results.filter((result) => result.status === "fulfilled").length, 1);
      const failure = results.find((result) => result.status === "rejected");
      ok(failure?.status === "rejected");
      const reason: unknown = failure.reason;
      ok(reason !== null && typeof reason === "object" && "code" in reason && "constraint" in reason);
      equal(reason.code, "23505");
      equal(reason.constraint, "conversations_one_open_per_contact_idx");
      const count = await pool.query<{ count: number }>(
        "SELECT count(*)::integer AS count FROM public.conversations WHERE contact_id = $1;", [contactId]);
      equal(count.rows[0]?.count, 1);
    });

    await t.test("não reaplica conversas registradas nem altera os atendimentos existentes", async () => {
      const before = await pool.query<{ count: number }>("SELECT count(*)::integer AS count FROM public.conversations;");
      ok((before.rows[0]?.count ?? 0) > 0);
      equal((await migrate("up")).length, 0);
      const after = await pool.query<{ count: number }>("SELECT count(*)::integer AS count FROM public.conversations;");
      equal(after.rows[0]?.count, before.rows[0]?.count);
    });

    await t.test("reverte apenas conversas, preserva contatos e permite reaplicar", async () => {
      const before = await pool.query<{ count: number }>("SELECT count(*)::integer AS count FROM public.contacts;");
      equal((await migrate("down")).length, 1);
      const objects = await pool.query<{ table_name: string | null; index_name: string | null }>(
        "SELECT to_regclass('public.conversations')::text AS table_name, to_regclass('public.conversations_one_open_per_contact_idx')::text AS index_name;");
      deepEqual(objects.rows[0], { table_name: null, index_name: null });
      const after = await pool.query<{ count: number }>("SELECT count(*)::integer AS count FROM public.contacts;");
      equal(after.rows[0]?.count, before.rows[0]?.count);
      const history = await pool.query<{ name: string }>("SELECT name FROM public.pgmigrations ORDER BY id;");
      deepEqual(history.rows, [{ name: contactsMigration }]);
      equal((await migrate("up")).length, 1);
    });
  } finally {
    try {
      await pool.end();
      // A limpeza só alcança o banco criado com sucesso por esta execução.
      if (databaseCreated) {
        await admin.query(`DROP DATABASE "${temporaryDatabase}" WITH (FORCE);`);
      }
    } finally {
      await admin.end();
    }
  }
});
