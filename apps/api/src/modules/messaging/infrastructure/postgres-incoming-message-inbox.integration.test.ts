import { deepEqual, equal, ok, rejects } from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { runner } from "node-pg-migrate";
import { Client } from "pg";
import { readDatabaseConfig } from "../../../config/database.js";
import { createDatabasePool } from "../../../infrastructure/database/pool.js";
import type { MessageReceipt } from "../application/incoming-message-inbox.js";
import type { NormalizedMessage } from "../contracts/normalized-message.js";
import { receiveMessageInput } from "../input/receive-message.js";
import { PostgresIncomingMessageInbox } from "./postgres-incoming-message-inbox.js";
import { MessagePayloadSerializationError } from "./serialize-message-payload.js";

test("recepção PostgreSQL em banco descartável", { timeout: 60000 }, async (t) => {
  const config = readDatabaseConfig(process.env);
  if (!["127.0.0.1", "localhost", "::1"].includes(config.host)) {
    throw new Error("O teste de integração exige um PostgreSQL local.");
  }
  const temporaryDatabase = `copilot_reception_test_${randomUUID().replaceAll("-", "")}`;
  const admin = new Client({ ...config, connectionTimeoutMillis: 5000 });
  const testConfig = { ...config, database: temporaryDatabase };
  const pool = createDatabasePool(testConfig);
  const inbox = new PostgresIncomingMessageInbox(pool);
  let databaseCreated = false;
  let phoneSequence = 0;

  const nextPhone = () => `+1555${String(++phoneSequence).padStart(7, "0")}`;
  const text = (phone = nextPhone(), externalId = randomUUID()) => ({
    provider: "simulador", externalId, phone, kind: "texto" as const,
    text: "Olá! Mensagem sintética.", receivedAt: new Date("2026-11-09T12:00:00Z"),
  });
  async function receive(message: NormalizedMessage, rawPayload: unknown = { synthetic: true }) {
    const result = await receiveMessageInput(message, rawPayload, inbox);
    ok(result.status !== "invalida");
    return result;
  }
  const countsSql = `SELECT
    (SELECT count(*)::integer FROM public.contacts) AS contacts,
    (SELECT count(*)::integer FROM public.conversations) AS conversations,
    (SELECT count(*)::integer FROM public.messages) AS messages,
    (SELECT count(*)::integer FROM public.jobs) AS jobs;`;
  type Counts = { contacts: number; conversations: number; messages: number; jobs: number };
  async function counts() {
    const result = await pool.query<Counts>(countsSql);
    ok(result.rows[0]);
    return result.rows[0];
  }
  async function context(messageId: string) {
    const result = await pool.query<{
      contact_id: string; conversation_id: string; phone: string; status: string;
      last_message_at: Date; closed_at: Date | null;
    }>(`SELECT c.contact_id, c.id AS conversation_id, p.phone, c.status, c.last_message_at, c.closed_at
        FROM public.messages m JOIN public.conversations c ON c.id = m.conversation_id
        JOIN public.contacts p ON p.id = c.contact_id WHERE m.id = $1;`, [messageId]);
    ok(result.rows[0]);
    return result.rows[0];
  }

  try {
    await admin.connect();
    // Nome gerado internamente; nenhuma tabela do banco do projeto é usada.
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

    await t.test("confirma contato, conversa, mensagem original e job pendente juntos", async () => {
      const message = text();
      const rawPayload = { synthetic: true, nested: ["Olá!", 1, null] };
      const result = await receive(message, rawPayload);
      equal(result.status, "registrada");
      deepEqual(await counts(), { contacts: 1, conversations: 1, messages: 1, jobs: 1 });
      const stored = await pool.query<{
        provider: string; external_id: string; direction: string; sender_type: string;
        kind: string; body: string; raw_payload: unknown; created_at: Date;
      }>("SELECT provider, external_id, direction, sender_type, kind, body, raw_payload, created_at FROM public.messages WHERE id = $1;", [result.messageId]);
      ok(stored.rows[0]);
      const { created_at: createdAt, ...storedValues } = stored.rows[0];
      deepEqual(storedValues, { provider: message.provider, external_id: message.externalId,
        direction: "entrada", sender_type: "contato", kind: "texto", body: message.text,
        raw_payload: rawPayload });
      ok(createdAt instanceof Date);
      const conversation = await context(result.messageId);
      equal(conversation.phone, message.phone);
      equal(conversation.status, "aguardando_menu");
      deepEqual(conversation.last_message_at, message.receivedAt);
      const jobs = await pool.query<{ type: string; status: string; attempts: number }>(
        "SELECT type, status, attempts FROM public.jobs WHERE message_id = $1;", [result.messageId]);
      deepEqual(jobs.rows, [{ type: "processar_mensagem", status: "pendente", attempts: 0 }]);
    });

    await t.test("reutiliza contato e conversa sem regredir a última atividade", async () => {
      const first = text();
      const initial = await receive(first);
      const original = await context(initial.messageId);
      await pool.query("UPDATE public.contacts SET display_name = 'Contato sintético' WHERE id = $1;", [original.contact_id]);
      const later = { ...text(first.phone), receivedAt: new Date("2026-11-09T14:00:00Z") };
      const recent = await receive(later);
      const outOfOrder = await receive({ ...text(first.phone), receivedAt: new Date("2026-11-09T13:00:00Z") });
      const current = await context(outOfOrder.messageId);
      equal(current.conversation_id, original.conversation_id);
      equal((await context(recent.messageId)).contact_id, original.contact_id);
      deepEqual(current.last_message_at, later.receivedAt);
      const contact = await pool.query<{ display_name: string }>("SELECT display_name FROM public.contacts WHERE id = $1;", [original.contact_id]);
      equal(contact.rows[0]?.display_name, "Contato sintético");
    });

    await t.test("preserva os estados ativos, inclusive atendimento humano", async () => {
      for (const status of ["aguardando_menu", "aguardando_detalhes", "qualificando", "aguardando_humano", "em_atendimento_humano"]) {
        const first = text();
        const initial = await receive(first);
        const original = await context(initial.messageId);
        await pool.query("UPDATE public.conversations SET status = $2 WHERE id = $1;", [original.conversation_id, status]);
        const next = await receive(text(first.phone));
        const current = await context(next.messageId);
        equal(current.conversation_id, original.conversation_id);
        equal(current.status, status);
      }
    });

    await t.test("abre novo ciclo no mesmo contato sem alterar a conversa encerrada", async () => {
      const first = text();
      const initial = await receive(first);
      const original = await context(initial.messageId);
      const closedAt = new Date("2026-11-09T15:00:00Z");
      await pool.query("UPDATE public.conversations SET status = 'encerrada', closed_at = $2 WHERE id = $1;", [original.conversation_id, closedAt]);
      const next = await receive({ ...text(first.phone), receivedAt: new Date("2026-11-10T12:00:00Z") });
      const current = await context(next.messageId);
      equal(current.contact_id, original.contact_id);
      ok(current.conversation_id !== original.conversation_id);
      equal(current.status, "aguardando_menu");
      deepEqual(await context(initial.messageId), { ...original, status: "encerrada", closed_at: closedAt });
    });

    await t.test("reenvio preserva o original sem criar ciclos ou contatos, mesmo com outro telefone", async () => {
      const first = text();
      const initial = await receive(first, { original: true });
      const original = await context(initial.messageId);
      await pool.query("UPDATE public.conversations SET status = 'encerrada', closed_at = now() WHERE id = $1;", [original.conversation_id]);
      const before = await counts();
      const duplicate = await receive({ ...first, phone: nextPhone(), text: "Texto sintético alterado.",
        receivedAt: new Date("2026-11-10T12:00:00Z") }, { replacement: true });
      deepEqual(duplicate, { status: "duplicada", messageId: initial.messageId });
      deepEqual(await counts(), before);
      const stored = await pool.query<{ body: string; raw_payload: unknown }>(
        "SELECT body, raw_payload FROM public.messages WHERE id = $1;", [initial.messageId]);
      deepEqual(stored.rows[0], { body: first.text, raw_payload: { original: true } });
      deepEqual((await context(initial.messageId)).last_message_at, original.last_message_at);
    });

    await t.test("aceita o mesmo ID externo em provedores diferentes", async () => {
      const first = text();
      const initial = await receive(first);
      const other = await receive({ ...first, provider: "outro_simulador" });
      equal(other.status, "registrada");
      ok(other.messageId !== initial.messageId);
      equal((await context(other.messageId)).conversation_id, (await context(initial.messageId)).conversation_id);
    });

    await t.test("grava mídia e payload em array sem criar job de processamento", async () => {
      const phone = nextPhone();
      const ids: string[] = [];
      for (const kind of ["audio", "outro"] as const) {
        const message: NormalizedMessage = { ...text(phone), kind };
        const result = await receive(message, ["original-sintetico", { kind }]);
        ids.push(result.messageId);
        const stored = await pool.query<{ kind: string; body: null; raw_payload: unknown }>(
          "SELECT kind, body, raw_payload FROM public.messages WHERE id = $1;", [result.messageId]);
        deepEqual(stored.rows[0], { kind, body: null, raw_payload: ["original-sintetico", { kind }] });
      }
      const jobs = await pool.query("SELECT id FROM public.jobs WHERE message_id = ANY($1::uuid[]);", [ids]);
      equal(jobs.rowCount, 0);
    });

    await t.test("mensagens simultâneas do mesmo contato reutilizam uma única conversa aberta", async () => {
      const phone = nextPhone();
      const before = await counts();
      const results = await Promise.all([receive(text(phone)), receive(text(phone)), receive(text(phone))]);
      equal(results.filter((result) => result.status === "registrada").length, 3);
      const contexts = await Promise.all(results.map((result) => context(result.messageId)));
      equal(new Set(contexts.map((value) => value.contact_id)).size, 1);
      equal(new Set(contexts.map((value) => value.conversation_id)).size, 1);
      deepEqual(await counts(), { contacts: before.contacts + 1, conversations: before.conversations + 1,
        messages: before.messages + 3, jobs: before.jobs + 3 });
    });

    await t.test("reenvios concorrentes do mesmo contato geram só uma mensagem e um job", async () => {
      const message = text();
      const before = await counts();
      const results = await Promise.all([receive(message), receive(message), receive(message)]);
      equal(results.filter((result) => result.status === "registrada").length, 1);
      equal(results.filter((result) => result.status === "duplicada").length, 2);
      equal(new Set(results.map((result) => result.messageId)).size, 1);
      deepEqual(await counts(), { contacts: before.contacts + 1, conversations: before.conversations + 1,
        messages: before.messages + 1, jobs: before.jobs + 1 });
    });

    await t.test("conflito entre telefones desfaz os registros provisórios da recepção perdedora", async () => {
      const before = await counts();
      const first = text();
      const second = { ...first, phone: nextPhone() };
      const controller = await pool.connect();
      try {
        // Barreira exclusiva do teste: ambos devem chegar ao INSERT antes da
        // liberação. Assim exercitamos o conflito, e não só a consulta inicial.
        await controller.query(`CREATE FUNCTION public.reception_test_gate() RETURNS trigger LANGUAGE plpgsql AS $$
          BEGIN PERFORM pg_advisory_xact_lock(7808, 1); RETURN NEW; END;
        $$;
        CREATE TRIGGER reception_test_gate BEFORE INSERT ON public.messages
          FOR EACH ROW EXECUTE FUNCTION public.reception_test_gate();`);
        await controller.query("SELECT pg_advisory_lock(7808, 1);");
        const pending = Promise.allSettled([receive(first), receive(second)]);
        let outcomes: PromiseSettledResult<MessageReceipt>[] = [];
        let waiting = 0;
        try {
          const deadline = Date.now() + 3000;
          while (Date.now() < deadline) {
            const locks = await controller.query<{ count: number }>(`SELECT count(*)::integer AS count FROM pg_locks
              WHERE locktype = 'advisory' AND classid = 7808 AND objid = 1 AND NOT granted
                AND database = (SELECT oid FROM pg_database WHERE datname = current_database());`);
            waiting = locks.rows[0]?.count ?? 0;
            if (waiting === 2) break;
            await new Promise((resolve) => setTimeout(resolve, 10));
          }
        } finally {
          try {
            await controller.query("SELECT pg_advisory_unlock(7808, 1);");
          } finally {
            outcomes = await pending;
          }
        }
        equal(waiting, 2);
        const receipts = outcomes.map((outcome) => { ok(outcome.status === "fulfilled"); return outcome.value; });
        equal(receipts.filter((receipt) => receipt.status === "registrada").length, 1);
        equal(receipts.filter((receipt) => receipt.status === "duplicada").length, 1);
        equal(new Set(receipts.map((receipt) => receipt.messageId)).size, 1);
        deepEqual(await counts(), { contacts: before.contacts + 1, conversations: before.conversations + 1,
          messages: before.messages + 1, jobs: before.jobs + 1 });
      } finally {
        try {
          await controller.query("DROP TRIGGER IF EXISTS reception_test_gate ON public.messages; DROP FUNCTION IF EXISTS public.reception_test_gate();");
        } finally {
          controller.release();
        }
      }
    });

    await t.test("falha no job desfaz novas entidades e atualizações e permite tentar novamente", async () => {
      const existingMessage = text();
      const existingReceipt = await receive(existingMessage);
      const original = await context(existingReceipt.messageId);
      const newMessage = text();
      const nextExisting = { ...text(existingMessage.phone), receivedAt: new Date("2026-11-10T12:00:00Z") };
      const before = await counts();
      await pool.query(`CREATE FUNCTION public.reception_test_fail_job() RETURNS trigger LANGUAGE plpgsql AS $$
        BEGIN RAISE EXCEPTION 'Falha sintética na criação do job'; END;
      $$;
      CREATE TRIGGER reception_test_fail_job BEFORE INSERT ON public.jobs
        FOR EACH ROW EXECUTE FUNCTION public.reception_test_fail_job();`);
      try {
        await rejects(receive(newMessage), { code: "P0001" });
        deepEqual(await counts(), before);
        await rejects(receive(nextExisting), { code: "P0001" });
        deepEqual(await counts(), before);
        deepEqual(await context(existingReceipt.messageId), original);
      } finally {
        await pool.query("DROP TRIGGER reception_test_fail_job ON public.jobs; DROP FUNCTION public.reception_test_fail_job();");
      }
      equal((await receive(newMessage)).status, "registrada");
      equal((await receive(nextExisting)).status, "registrada");
    });

    await t.test("payload inválido é rejeitado sem gravar contato, conversa, mensagem ou job", async () => {
      const before = await counts();
      for (const payload of [undefined, { value: undefined }, BigInt(1)]) {
        await rejects(receiveMessageInput(text(), payload, inbox), MessagePayloadSerializationError);
      }
      deepEqual(await counts(), before);
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
