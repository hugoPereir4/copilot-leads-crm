import { deepEqual, equal, match, ok, rejects } from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { runner } from "node-pg-migrate";
import { Client } from "pg";
import { readDatabaseConfig } from "../../config/database.js";
import { createDatabasePool } from "./pool.js";

test("migração de mensagens em banco descartável", { timeout: 60000 }, async (t) => {
  const config = readDatabaseConfig(process.env);

  if (!["127.0.0.1", "localhost", "::1"].includes(config.host)) {
    throw new Error("O teste de integração exige um PostgreSQL local.");
  }

  const temporaryDatabase = `copilot_messages_test_${randomUUID().replaceAll("-", "")}`;
  const contactsMigration = "1793750400000_create_contacts";
  const conversationsMigration = "1793750401000_create_conversations";
  const messagesMigration = "1793750402000_create_messages";
  const admin = new Client({ ...config, connectionTimeoutMillis: 5000 });
  const testConfig = { ...config, database: temporaryDatabase };
  const pool = createDatabasePool(testConfig);
  let databaseCreated = false;
  let contactSequence = 0;

  const migrate = async (direction: "up" | "down", file = messagesMigration) => {
    const migrationClient = new Client({ ...testConfig, connectionTimeoutMillis: 5000 });
    try {
      await migrationClient.connect();
      return await runner({
        dbClient: migrationClient,
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
    } finally {
      // Aguarda o encerramento antes de permitir a remoção do banco descartável.
      await migrationClient.end();
    }
  };

  // Fixtures sintéticas, independentes dos futuros repositórios da aplicação.
  async function createConversation(): Promise<string> {
    contactSequence += 1;
    const contact = await pool.query<{ id: string }>(
      "INSERT INTO public.contacts (phone) VALUES ($1) RETURNING id;",
      [`+1555${String(contactSequence).padStart(7, "0")}`]);
    ok(contact.rows[0]);
    const conversation = await pool.query<{ id: string }>(
      "INSERT INTO public.conversations (contact_id) VALUES ($1) RETURNING id;", [contact.rows[0].id]);
    ok(conversation.rows[0]);
    return conversation.rows[0].id;
  }

  const insertMessage = (conversationId: string, externalId: string, provider = "simulador") => pool.query(
    "INSERT INTO public.messages (conversation_id, provider, external_id, direction, sender_type, kind, body) VALUES ($1, $2, $3, 'entrada', 'contato', 'texto', 'Mensagem sintética');",
    [conversationId, provider, externalId]);

  try {
    await admin.connect();
    // O identificador contém apenas prefixo fixo e UUID hexadecimal gerado aqui.
    await admin.query(`CREATE DATABASE "${temporaryDatabase}" TEMPLATE template0;`);
    databaseCreated = true;
    await migrate("up", contactsMigration);
    await migrate("up", conversationsMigration);

    await t.test("aplica mensagens após suas dependências e registra o histórico", async () => {
      const applied = await migrate("up");
      equal(applied.length, 1);
      equal(applied[0]?.name, messagesMigration);
      const history = await pool.query<{ name: string }>("SELECT name FROM public.pgmigrations ORDER BY id;");
      deepEqual(history.rows, [contactsMigration, conversationsMigration, messagesMigration].map((name) => ({ name })));
    });

    await t.test("gera UUID e data e preserva texto e payload JSON", async () => {
      const conversationId = await createConversation();
      const payload = { id: "exemplo-sintetico", text: "Olá!", extra: { simulated: true } };
      const result = await pool.query<{
        id: string; created_at: Date; body: string; raw_payload: unknown;
      }>("INSERT INTO public.messages (conversation_id, provider, external_id, direction, sender_type, kind, body, raw_payload) VALUES ($1, 'simulador', $2, 'entrada', 'contato', 'texto', $3, $4) RETURNING *;",
        [conversationId, randomUUID(), "Olá!", payload]);
      const message = result.rows[0];
      ok(message);
      match(message.id, /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i);
      ok(message.created_at instanceof Date);
      ok(Number.isFinite(message.created_at.getTime()));
      equal(message.body, "Olá!");
      deepEqual(message.raw_payload, payload);
    });

    await t.test("exige os campos de identificação, direção, remetente e tipo", async () => {
      const conversationId = await createConversation();
      const columns = ["conversation_id", "provider", "external_id", "direction", "sender_type", "kind"];
      for (const [index, column] of columns.entries()) {
        const values: (string | null)[] = [conversationId, "simulador", randomUUID(), "entrada", "contato", "texto"];
        values[index] = null;
        await rejects(pool.query(
          "INSERT INTO public.messages (conversation_id, provider, external_id, direction, sender_type, kind) VALUES ($1, $2, $3, $4, $5, $6);", values),
          { code: "23502", column });
      }
    });

    await t.test("exige conversa existente e protege o histórico contra exclusão da conversa", async () => {
      await rejects(insertMessage(randomUUID(), randomUUID()),
        { code: "23503", constraint: "messages_conversation_id_fkey" });
      const conversationId = await createConversation();
      await insertMessage(conversationId, randomUUID());
      // PostgreSQL 18 diferencia restrict_violation de foreign_key_violation.
      await rejects(pool.query("DELETE FROM public.conversations WHERE id = $1;", [conversationId]),
        { code: "23001", constraint: "messages_conversation_id_fkey" });
    });

    await t.test("aceita os valores previstos e registra mídia sem exigir texto ou payload", async () => {
      const conversationId = await createConversation();
      for (const [direction, senderType, kind] of [
        ["entrada", "contato", "texto"], ["saida", "bot", "audio"], ["saida", "atendente", "outro"],
      ]) {
        const result = await pool.query<{ body: null; raw_payload: null }>(
          "INSERT INTO public.messages (conversation_id, provider, external_id, direction, sender_type, kind) VALUES ($1, 'simulador', $2, $3, $4, $5) RETURNING body, raw_payload;",
          [conversationId, randomUUID(), direction, senderType, kind]);
        deepEqual(result.rows[0], { body: null, raw_payload: null });
      }
      for (const [direction, senderType, kind, constraint] of [
        ["invalida", "contato", "texto", "messages_direction_check"],
        ["entrada", "invalido", "texto", "messages_sender_type_check"],
        ["entrada", "contato", "invalido", "messages_kind_check"],
      ]) {
        await rejects(pool.query(
          "INSERT INTO public.messages (conversation_id, provider, external_id, direction, sender_type, kind) VALUES ($1, 'simulador', $2, $3, $4, $5);",
          [conversationId, randomUUID(), direction, senderType, kind]), { code: "23514", constraint });
      }
    });

    await t.test("rejeita provedor e ID externo vazios ou compostos apenas por espaços", async () => {
      const conversationId = await createConversation();
      for (const blank of ["", "   "]) {
        await rejects(insertMessage(conversationId, randomUUID(), blank),
          { code: "23514", constraint: "messages_provider_not_blank_check" });
        await rejects(insertMessage(conversationId, blank),
          { code: "23514", constraint: "messages_external_id_not_blank_check" });
      }
    });

    await t.test("impede duplicatas do mesmo provedor inclusive em outra conversa, preservando o original", async () => {
      const conversationId = await createConversation();
      const otherConversationId = await createConversation();
      const externalId = randomUUID();
      await insertMessage(conversationId, externalId);
      for (const target of [conversationId, otherConversationId]) {
        await rejects(insertMessage(target, externalId),
          { code: "23505", constraint: "messages_provider_external_id_key" });
      }
      // IDs externos pertencem ao provedor: outro provedor pode usar o mesmo ID.
      await insertMessage(otherConversationId, externalId, "outro_simulador");
      const original = await pool.query<{ conversation_id: string; body: string }>(
        "SELECT conversation_id, body FROM public.messages WHERE provider = 'simulador' AND external_id = $1;", [externalId]);
      deepEqual(original.rows, [{ conversation_id: conversationId, body: "Mensagem sintética" }]);
    });

    await t.test("protege a unicidade em duas inserções concorrentes da mesma mensagem", async () => {
      const conversationId = await createConversation();
      const externalId = randomUUID();
      const results = await Promise.allSettled([
        insertMessage(conversationId, externalId), insertMessage(conversationId, externalId),
      ]);
      equal(results.filter((result) => result.status === "fulfilled").length, 1);
      const failure = results.find((result) => result.status === "rejected");
      ok(failure?.status === "rejected");
      const reason: unknown = failure.reason;
      ok(reason !== null && typeof reason === "object" && "code" in reason && "constraint" in reason);
      equal(reason.code, "23505");
      equal(reason.constraint, "messages_provider_external_id_key");
      const count = await pool.query<{ count: number }>(
        "SELECT count(*)::integer AS count FROM public.messages WHERE provider = 'simulador' AND external_id = $1;", [externalId]);
      equal(count.rows[0]?.count, 1);
    });

    await t.test("não reaplica mensagens registradas nem altera o histórico existente", async () => {
      const before = await pool.query<{ count: number }>("SELECT count(*)::integer AS count FROM public.messages;");
      ok((before.rows[0]?.count ?? 0) > 0);
      equal((await migrate("up")).length, 0);
      const after = await pool.query<{ count: number }>("SELECT count(*)::integer AS count FROM public.messages;");
      equal(after.rows[0]?.count, before.rows[0]?.count);
    });

    await t.test("reverte apenas mensagens e seu índice, preserva dependências e permite reaplicar", async () => {
      const before = await pool.query<{ contacts: number; conversations: number }>(
        "SELECT (SELECT count(*)::integer FROM public.contacts) AS contacts, (SELECT count(*)::integer FROM public.conversations) AS conversations;");
      const index = await pool.query<{ indexdef: string }>(
        "SELECT indexdef FROM pg_indexes WHERE schemaname = 'public' AND indexname = 'messages_conversation_created_at_idx';");
      ok(index.rows[0]);
      match(index.rows[0].indexdef, /\(conversation_id, created_at\)/);
      equal((await migrate("down")).length, 1);
      const objects = await pool.query<{ table_name: string | null; index_name: string | null }>(
        "SELECT to_regclass('public.messages')::text AS table_name, to_regclass('public.messages_conversation_created_at_idx')::text AS index_name;");
      deepEqual(objects.rows[0], { table_name: null, index_name: null });
      const after = await pool.query<{ contacts: number; conversations: number }>(
        "SELECT (SELECT count(*)::integer FROM public.contacts) AS contacts, (SELECT count(*)::integer FROM public.conversations) AS conversations;");
      deepEqual(after.rows, before.rows);
      const history = await pool.query<{ name: string }>("SELECT name FROM public.pgmigrations ORDER BY id;");
      deepEqual(history.rows, [{ name: contactsMigration }, { name: conversationsMigration }]);
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
