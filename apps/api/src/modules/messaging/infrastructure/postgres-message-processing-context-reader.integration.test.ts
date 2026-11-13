import { deepEqual, equal, ok, rejects } from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { runner } from "node-pg-migrate";
import { Client } from "pg";
import { readDatabaseConfig } from "../../../config/database.js";
import { createDatabasePool } from "../../../infrastructure/database/pool.js";
import { loadMessageProcessingContext } from "../application/load-message-processing-context.js";
import type { MessageProcessingContext } from "../contracts/message-processing-context.js";
import { PostgresMessageProcessingContextReader } from "./postgres-message-processing-context-reader.js";

type FixtureOptions = {
  status?: MessageProcessingContext["conversation"]["status"];
  direction?: MessageProcessingContext["message"]["direction"];
  senderType?: MessageProcessingContext["message"]["senderType"];
  kind?: MessageProcessingContext["message"]["kind"];
  body?: string | null;
  displayName?: string | null;
  provider?: string;
  externalId?: string;
};

test("contexto de mensagem em PostgreSQL descartável", { timeout: 60000 }, async (t) => {
  const config = readDatabaseConfig(process.env);
  if (!["127.0.0.1", "localhost", "::1"].includes(config.host)) {
    throw new Error("O teste de integração exige um PostgreSQL local.");
  }
  const temporaryDatabase = `copilot_context_test_${randomUUID().replaceAll("-", "")}`;
  const admin = new Client({ ...config, connectionTimeoutMillis: 5000 });
  const testConfig = { ...config, database: temporaryDatabase };
  const pool = createDatabasePool(testConfig);
  const reader = new PostgresMessageProcessingContextReader(pool);
  const load = (id: string) => loadMessageProcessingContext(id, reader);
  let databaseCreated = false;
  let phoneSequence = 0;

  async function fixture(options: FixtureOptions = {}): Promise<MessageProcessingContext> {
    const contact = await pool.query<{ id: string; phone: string; display_name: string | null }>(
      "INSERT INTO public.contacts (phone, display_name) VALUES ($1, $2) RETURNING id, phone, display_name;",
      [`+1555${String(++phoneSequence).padStart(7, "0")}`, options.displayName ?? null]);
    ok(contact.rows[0]);
    const status = options.status ?? "aguardando_menu";
    const conversation = await pool.query<{ id: string }>(`
      INSERT INTO public.conversations (contact_id, status, closed_at)
      VALUES ($1, $2, CASE WHEN $2 = 'encerrada' THEN CURRENT_TIMESTAMP ELSE NULL END) RETURNING id;
    `, [contact.rows[0].id, status]);
    ok(conversation.rows[0]);
    const externalId = options.externalId ?? randomUUID();
    const message = await pool.query<{ id: string; created_at: Date }>(`
      INSERT INTO public.messages
        (conversation_id, provider, external_id, direction, sender_type, kind, body, raw_payload, created_at)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8::jsonb, '2020-01-01T00:00:00Z') RETURNING id, created_at;
    `, [conversation.rows[0].id, options.provider ?? "simulador", externalId,
      options.direction ?? "entrada", options.senderType ?? "contato", options.kind ?? "texto",
      options.body === undefined ? "Mensagem sintética do contexto" : options.body,
      JSON.stringify({ fixture: "payload_bruto_excluido_da_leitura", timestamp: "2026-11-13T12:00:00Z" })]);
    ok(message.rows[0]);
    return {
      message: {
        id: message.rows[0].id, provider: options.provider ?? "simulador",
        externalId,
        direction: options.direction ?? "entrada", senderType: options.senderType ?? "contato",
        kind: options.kind ?? "texto", body: options.body === undefined ? "Mensagem sintética do contexto" : options.body,
        createdAt: message.rows[0].created_at,
      },
      conversation: { id: conversation.rows[0].id, status },
      contact: { id: contact.rows[0].id, phone: contact.rows[0].phone, displayName: contact.rows[0].display_name },
    };
  }
  async function snapshot() {
    const tables: Record<string, unknown> = {};
    for (const table of ["contacts", "conversations", "messages", "jobs", "pgmigrations"]) {
      const result = await pool.query<{ data: unknown }>(`
        SELECT coalesce(jsonb_agg(to_jsonb(record) ORDER BY id), '[]'::jsonb) AS data
        FROM public.${table} AS record;
      `);
      ok(result.rows[0]);
      tables[table] = result.rows[0].data;
    }
    return tables;
  }
  t.beforeEach(async () => {
    // Todas as fixtures e alterações de cenário pertencem ao banco da suíte.
    await pool.query("TRUNCATE public.jobs, public.messages, public.conversations, public.contacts;");
  });

  try {
    await admin.connect();
    await admin.query(`CREATE DATABASE "${temporaryDatabase}" TEMPLATE template0;`);
    databaseCreated = true;
    const migrationClient = new Client({ ...testConfig, connectionTimeoutMillis: 5000 });
    try {
      await migrationClient.connect();
      await runner({
        dbClient: migrationClient,
        dir: fileURLToPath(new URL("../../../../migrations/", import.meta.url)),
        direction: "up", schema: "public", migrationsTable: "pgmigrations",
        checkOrder: true, singleTransaction: true,
        logger: { info: () => {}, warn: () => {}, error: () => {} },
      });
    } finally {
      await migrationClient.end();
    }

    await t.test("carrega mensagem, conversa e contato sem payload bruto nem efeitos persistidos", async () => {
      const expected = await fixture({ displayName: " Pessoa fictícia ", body: " Texto preservado\n" });
      await pool.query("INSERT INTO public.jobs (type, message_id) VALUES ('processar_mensagem', $1);", [expected.message.id]);
      const before = await snapshot();
      const context = await load(expected.message.id);
      deepEqual(context, expected);
      ok(context?.message.createdAt instanceof Date);
      equal(context.message.createdAt.toISOString(), "2020-01-01T00:00:00.000Z");
      deepEqual(await snapshot(), before);
    });

    await t.test("preserva campos nulos para texto, áudio e outros conteúdos", async () => {
      for (const kind of ["texto", "audio", "outro"] as const) {
        const expected = await fixture({ kind, body: null, displayName: null });
        deepEqual(await load(expected.message.id), expected);
      }
    });

    await t.test("preserva os seis estados sem filtrar atendimento humano ou conversa encerrada", async () => {
      for (const status of [
        "aguardando_menu", "aguardando_detalhes", "qualificando", "aguardando_humano", "em_atendimento_humano", "encerrada",
      ] as const) {
        const expected = await fixture({ status });
        const before = await snapshot();
        deepEqual(await load(expected.message.id), expected);
        deepEqual(await snapshot(), before);
      }
    });

    await t.test("mensagem antiga mantém sua conversa encerrada mesmo com um novo ciclo aberto", async () => {
      const expected = await fixture({ status: "encerrada" });
      const newer = await pool.query<{ id: string }>(
        "INSERT INTO public.conversations (contact_id) VALUES ($1) RETURNING id;", [expected.contact.id]);
      ok(newer.rows[0]);
      await pool.query(`
        INSERT INTO public.messages (conversation_id, provider, external_id, direction, sender_type, kind, body)
        VALUES ($1, 'simulador', $2, 'entrada', 'contato', 'texto', 'Mensagem sintética do novo ciclo');
      `, [newer.rows[0].id, randomUUID()]);
      const before = await snapshot();
      deepEqual(await load(expected.message.id), expected);
      deepEqual(await snapshot(), before);
    });

    await t.test("busca por UUID sem confundir IDs externos iguais em provedores diferentes", async () => {
      const first = await fixture({ provider: "simulador_a", externalId: "mesmo-id-sintetico" });
      const second = await fixture({ provider: "simulador_b", externalId: "mesmo-id-sintetico" });
      deepEqual(await load(first.message.id), first);
      deepEqual(await load(second.message.id), second);
    });

    await t.test("mensagens de saída preservam direção e remetente sem decidir processamento", async () => {
      for (const senderType of ["bot", "atendente"] as const) {
        const expected = await fixture({ direction: "saida", senderType });
        deepEqual(await load(expected.message.id), expected);
      }
    });

    await t.test("UUID inexistente retorna ausência sem alterar registros existentes", async () => {
      await fixture();
      const before = await snapshot();
      equal(await load(randomUUID()), undefined);
      deepEqual(await snapshot(), before);
    });

    await t.test("lê dados confirmados durante alteração concorrente e reflete o commit na próxima leitura", async () => {
      const expected = await fixture({ displayName: "Nome fictício inicial" });
      const writer = await pool.connect();
      let transactionOpen = false;
      try {
        await writer.query("BEGIN;");
        transactionOpen = true;
        await writer.query("UPDATE public.contacts SET display_name = 'Nome fictício atualizado' WHERE id = $1;", [expected.contact.id]);
        await writer.query("UPDATE public.conversations SET status = 'em_atendimento_humano' WHERE id = $1;", [expected.conversation.id]);
        deepEqual(await load(expected.message.id), expected);
        await writer.query("COMMIT;");
        transactionOpen = false;
        deepEqual(await load(expected.message.id), {
          ...expected,
          contact: { ...expected.contact, displayName: "Nome fictício atualizado" },
          conversation: { ...expected.conversation, status: "em_atendimento_humano" },
        });
      } finally {
        try { if (transactionOpen) await writer.query("ROLLBACK;"); } finally { writer.release(); }
      }
    });

    await t.test("contexto inválido rejeita com erro seguro sem retornar ausência ou alterar o banco", async () => {
      // btrim no CHECK remove espaços por padrão; o schema também rejeita tabulação.
      const malformed = await fixture({ provider: "\t" });
      const valid = await fixture();
      const before = await snapshot();
      await rejects(load(malformed.message.id), { message: "O contexto persistido da mensagem é inválido." });
      deepEqual(await load(valid.message.id), valid);
      deepEqual(await snapshot(), before);
    });
  } finally {
    try {
      await pool.end();
      if (databaseCreated) await admin.query(`DROP DATABASE "${temporaryDatabase}" WITH (FORCE);`);
    } finally {
      await admin.end();
    }
  }
});
