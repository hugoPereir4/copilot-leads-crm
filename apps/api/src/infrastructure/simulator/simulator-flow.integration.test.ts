import { deepEqual, equal, ok, rejects } from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { createServer } from "node:net";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { Client } from "pg";
import { readDatabaseConfig } from "../../config/database.js";
import { createHttpApp } from "../../http/app.js";
import { installDemoRoutes } from "../../http/demo-routes.js";
import { listenHttp } from "../../http/listen-http.js";
import { createDatabasePool } from "../database/pool.js";
import { JsonBusinessProfileReader } from "../../modules/business-profile/infrastructure/json-business-profile-reader.js";
import { PostgresJobQueue } from "../../modules/jobs/infrastructure/postgres-job-queue.js";
import { recoverExpiredJobs } from "../../modules/jobs/application/recover-expired-jobs.js";
import { decideMessageProcessing } from "../../modules/messaging/application/decide-message-processing.js";
import { prepareMessageResponsePlan } from "../../modules/messaging/application/prepare-message-response-plan.js";
import { PostgresIncomingMessageInbox } from "../../modules/messaging/infrastructure/postgres-incoming-message-inbox.js";
import { PostgresMessageProcessingContextReader } from "../../modules/messaging/infrastructure/postgres-message-processing-context-reader.js";
import { PostgresMessageResponsePlanReader } from "../../modules/messaging/infrastructure/postgres-message-response-plan-reader.js";
import { PostgresMessageResponsePlanStore } from "../../modules/messaging/infrastructure/postgres-message-response-plan-store.js";
import { SimulatorProcessor } from "../../modules/simulator/application/simulator-processor.js";
import { PostgresSimulatorEffects } from "./postgres-simulator-effects.js";
import { PostgresDemoReadModel } from "./postgres-demo-read-model.js";
import { PostgresHumanHandoffStore } from "../../modules/leads/infrastructure/postgres-human-handoff-store.js";
import { installHumanHandoffRoutes } from "../../modules/leads/http/human-handoff-routes.js";

test("fluxo vertical do simulador em banco descartável", { timeout: 60000 }, async (t) => {
  const { runner } = await import("node-pg-migrate");
  const config = readDatabaseConfig(process.env);
  if (!["localhost", "127.0.0.1", "::1"].includes(config.host)) throw new Error("Teste exige PostgreSQL local.");
  const database = `copilot_demo_test_${randomUUID().replaceAll("-", "")}`;
  const admin = new Client({ ...config, connectionTimeoutMillis: 5000 });
  const testConfig = { ...config, database };
  const pool = createDatabasePool(testConfig);
  const queue = new PostgresJobQueue(pool, true);
  const profile = new JsonBusinessProfileReader();
  const contexts = new PostgresMessageProcessingContextReader(pool);
  const plans = new PostgresMessageResponsePlanReader(pool);
  const planStore = new PostgresMessageResponsePlanStore(pool);
  const effects = new PostgresSimulatorEffects(pool);
  const read = new PostgresDemoReadModel(pool);
  const handoff = new PostgresHumanHandoffStore(pool);
  const dependencies = { queue, profile, contexts, plans, planStore, effects };
  const processor = new SimulatorProcessor(dependencies);
  let created = false;
  let server: Awaited<ReturnType<typeof listenHttp>> | undefined;
  let url = "";
  let sequence = 0;
  const phone = () => `+1555${String(++sequence).padStart(7, "0")}`;
  async function migrate(direction: "up" | "down") {
    const client = new Client({ ...testConfig, connectionTimeoutMillis: 5000 });
    try {
      await client.connect();
      await runner({ dbClient: client, dir: fileURLToPath(new URL("../../../migrations/", import.meta.url)), direction,
        ...(direction === "down" ? { count: 1 } : {}), schema: "public", migrationsTable: "pgmigrations",
        checkOrder: true, singleTransaction: true, logger: { info: () => {}, warn: () => {}, error: () => {} } });
    } finally { await client.end(); }
  }
  async function receive(from: string, body: string, id = randomUUID()) {
    const payload = { id, from, fromMe: false, type: "text", body, timestamp: new Date().toISOString() };
    const response = await fetch(`${url}/webhooks/simulator`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) });
    equal(response.status, 200);
    const receipt = await response.json() as { status: string; messageId: string };
    ok(receipt.messageId);
    return { ...receipt, payload };
  }
  async function drain() {
    for (let i = 0; i < 50; i++) if (!await processor.processOne()) return;
    throw new Error("O processador não esvaziou o lote.");
  }
  async function snapshot() {
    const result: Record<string, unknown> = {};
    for (const table of ["contacts", "conversations", "messages", "jobs", "response_plans", "response_blocks", "leads"]) {
      result[table] = (await pool.query(`SELECT to_jsonb(t) AS row FROM public.${table} t ORDER BY to_jsonb(t)::text;`)).rows;
    }
    return result;
  }
  async function outgoing() { return (await pool.query("SELECT * FROM public.messages WHERE direction = 'saida' ORDER BY created_at, id;")).rows; }
  async function due() { await pool.query("UPDATE public.jobs SET run_at = CURRENT_TIMESTAMP - INTERVAL '1 second' WHERE status = 'pendente';"); }
  async function prepared(messageId: string) {
    const job = await queue.claimNext("processar_mensagem"); ok(job); equal(job.messageId, messageId);
    const context = await contexts.findByMessageId(messageId); ok(context);
    const config = await profile.read();
    const decision = decideMessageProcessing({ context, profile: config, openingStatus: "pendente" });
    ok(decision.action === "enviar_abertura");
    const result = await prepareMessageResponsePlan({ job, context, profile: config, decision }, planStore);
    ok(result.status === "preparado");
    return { job, context, decision, planId: result.planId };
  }
  t.beforeEach(async () => {
    await pool.query("TRUNCATE public.leads, public.response_blocks, public.response_plans, public.jobs, public.messages, public.conversations, public.contacts;");
  });
  try {
    await admin.connect(); await admin.query(`CREATE DATABASE "${database}" TEMPLATE template0;`); created = true;
    await migrate("up");
    server = await listenHttp(createHttpApp(new PostgresIncomingMessageInbox(pool), () => {},
      (app, sendError) => {
        installDemoRoutes(app, sendError, read);
        installHumanHandoffRoutes(app, sendError, handoff);
      }), 0);
    const address = server.address(); ok(address && typeof address !== "string"); url = `http://127.0.0.1:${address.port}`;

    await t.test("webhook → abertura → recepção → card → silêncio, com HTTP e PostgreSQL reais", async () => {
      const contact = phone(); await receive(contact, "Olá"); await drain();
      const opening = await outgoing(); ok(opening.length >= 2);
      const conversation = (await read.conversations())[0]; ok(conversation);
      const original = (await pool.query("SELECT source_message_id FROM public.response_plans;")).rows[0]; ok(original);
      const plan = await plans.findByMessageId(original.source_message_id as string); ok(plan);
      deepEqual((await read.messages(conversation.id)).filter((item) => item.direction === "saida").map((item) => item.body),
        plan.blocks.map((block) => block.text));
      const menu = (await profile.read()).menuOptions.find((option) => option.action === "solicitar_recepcao"); ok(menu);
      await receive(contact, menu.number); await drain();
      const response = await fetch(`${url}/api/demo/conversations`); equal(response.status, 200);
      const rows = await response.json() as Awaited<ReturnType<typeof read.conversations>>;
      equal(rows.length, 1); equal(rows[0]?.status, "aguardando_humano");
      equal(rows[0]?.lead?.stage, "novo"); equal(rows[0]?.lead?.needsReview, false);
      const id = rows[0]?.lead?.id;
      await receive(contact, "Mais uma mensagem administrativa"); await drain();
      equal((await read.conversations())[0]?.lead?.id, id); equal((await outgoing()).length, opening.length);
      equal((await pool.query("SELECT * FROM public.jobs WHERE status <> 'concluido';")).rowCount, 0);
      const history = await fetch(`${url}/api/demo/conversations/${rows[0]?.id}/messages`); equal(history.status, 200);
      ok((await history.json() as unknown[]).length >= 5);
    });

    await t.test("serviços e valores conduzem detalhes ao fallback Revisar sem simular IA", async () => {
      for (const action of ["informar_servicos", "informar_valores_horarios"]) {
        const contact = phone(); await receive(contact, "Oi"); await drain();
        const option = (await profile.read()).menuOptions.find((option) => option.action === action); ok(option);
        const receipt = await receive(contact, option.number); await drain();
        equal((await plans.findByMessageId(receipt.messageId))?.status, "enviado");
        const rows = await read.conversations(); equal(rows.find((row) => row.phone === contact)?.status, "aguardando_detalhes");
        await receive(contact, "Gostaria de solicitar um horário fictício"); await drain();
        const row = (await read.conversations()).find((row) => row.phone === contact);
        equal(row?.status, "aguardando_humano"); equal(row?.lead?.stage, "novo"); equal(row?.lead?.needsReview, true);
        ok(row?.lead?.summary?.includes("não habilitada"));
      }
    });

    await t.test("duplicatas antes e depois do processamento preservam todos os registros", async () => {
      const contact = phone(), externalId = randomUUID();
      const first = await receive(contact, "Olá", externalId);
      equal((await receive(contact, "Olá", externalId)).messageId, first.messageId);
      await drain(); const before = await snapshot();
      equal((await receive(contact, "Olá", externalId)).status, "duplicada"); await drain();
      deepEqual(await snapshot(), before);
    });

    await t.test("fila serializa conversa, espera retry sem gastar tentativa posterior e recupera reserva", async () => {
      const contact = phone(); const first = await receive(contact, "Olá"); const next = await receive(contact, "3");
      const old = await queue.claimNext("processar_mensagem"); ok(old); equal(old.messageId, first.messageId);
      equal(await queue.claimNext("processar_mensagem"), undefined);
      equal((await pool.query("SELECT attempts FROM public.jobs WHERE message_id = $1;", [next.messageId])).rows[0]?.attempts, 0);
      const context = await contexts.findByMessageId(first.messageId); ok(context);
      await pool.query("UPDATE public.jobs SET locked_at = CURRENT_TIMESTAMP - INTERVAL '121 seconds' WHERE id = $1;", [old.id]);
      deepEqual(await recoverExpiredJobs(queue), { requeued: 1, failed: 0 });
      equal(await effects.apply({ attempt: old, context, decision: { action: "ignorar", reason: "texto_vazio" } }), "reserva_desatualizada");
      await pool.query("UPDATE public.jobs SET run_at = CURRENT_TIMESTAMP + INTERVAL '1 hour' WHERE id = $1;", [old.id]);
      equal(await queue.claimNext("processar_mensagem"), undefined);
      await due(); await drain();
      equal((await read.conversations())[0]?.lead?.stage, "novo");
      equal((await pool.query("SELECT * FROM public.response_plans WHERE action = 'enviar_abertura';")).rowCount, 1);
      equal((await pool.query("SELECT attempts FROM public.jobs WHERE message_id = $1;", [next.messageId])).rows[0]?.attempts, 1);
    });

    await t.test("duas instâncias não duplicam abertura nem card em mensagens já enfileiradas", async () => {
      const contact = phone(); await receive(contact, "Olá"); await receive(contact, "3");
      const other = new SimulatorProcessor(dependencies);
      await Promise.all([processor.processOne(), other.processOne()]); await drain();
      equal((await pool.query("SELECT * FROM public.response_plans;")).rowCount, 1);
      equal((await pool.query("SELECT * FROM public.leads;")).rowCount, 1);
      equal((await pool.query("SELECT * FROM public.response_blocks WHERE status <> 'enviado';")).rowCount, 0);
    });

    await t.test("queda após preparação retoma o snapshot sem reler perfil ou reenviar confirmações", async () => {
      const receipt = await receive(phone(), "Olá"); const pending = await prepared(receipt.messageId);
      const original = await plans.findByMessageId(receipt.messageId); ok(original);
      const firstBlock = original.blocks[0]; ok(firstBlock);
      const sent = (await pool.query(`INSERT INTO public.messages (conversation_id, provider, external_id, direction, sender_type, kind, body)
        VALUES ($1, 'simulador', $2, 'saida', 'bot', 'texto', $3) RETURNING id;`,
        [original.conversationId, `response:${original.id}:1`, firstBlock.text])).rows[0]; ok(sent);
      await pool.query(`UPDATE public.response_blocks SET status = 'enviado', sent_message_id = $2, sent_at = CURRENT_TIMESTAMP
        WHERE plan_id = $1 AND position = 1;`, [original.id, sent.id]);
      await pool.query("UPDATE public.jobs SET locked_at = CURRENT_TIMESTAMP - INTERVAL '121 seconds' WHERE id = $1;", [pending.job.id]);
      await recoverExpiredJobs(queue);
      const resumed = new SimulatorProcessor({ ...dependencies, profile: { async read() { throw new Error("perfil indisponível"); } } });
      equal(await resumed.processOne(), true);
      const plan = await plans.findByMessageId(receipt.messageId); equal(plan?.id, original.id); equal(plan?.status, "enviado");
      deepEqual((await outgoing()).map((row) => row.body).sort(), original.blocks.map((block) => block.text).sort());
      equal(plan?.blocks[0]?.sentMessageId, sent.id);
      const before = await snapshot(); equal(await effects.apply({ ...pending, attempt: pending.job }), "reserva_desatualizada");
      deepEqual(await snapshot(), before);
    });

    await t.test("falha na confirmação desfaz saída, blocos, estado e conclusão; retry não duplica", async () => {
      const receipt = await receive(phone(), "Olá");
      await pool.query(`CREATE FUNCTION public.reject_demo_block() RETURNS trigger LANGUAGE plpgsql AS $$
        BEGIN IF NEW.position = 2 THEN RAISE EXCEPTION 'falha_sintetica'; END IF; RETURN NEW; END; $$;
        CREATE TRIGGER reject_demo_block AFTER UPDATE ON public.response_blocks FOR EACH ROW EXECUTE FUNCTION public.reject_demo_block();`);
      try {
        await processor.processOne(); equal((await outgoing()).length, 0);
        const plan = await plans.findByMessageId(receipt.messageId); ok(plan);
        equal(plan.status, "pendente"); ok(plan.blocks.every((block) => block.status === "pendente"));
        equal((await read.conversations())[0]?.status, "aguardando_menu");
        equal((await pool.query("SELECT status FROM public.jobs;")).rows[0]?.status, "pendente");
      } finally { await pool.query("DROP TRIGGER reject_demo_block ON public.response_blocks; DROP FUNCTION public.reject_demo_block();"); }
      await due(); await drain();
      const plan = await plans.findByMessageId(receipt.messageId); equal(plan?.status, "enviado");
      equal((await outgoing()).length, plan?.blocks.length);
    });

    await t.test("falha ao criar lead desfaz handoff e conclusão do job", async () => {
      const contact = phone(); await receive(contact, "Olá"); await drain(); await receive(contact, "3");
      await pool.query(`CREATE FUNCTION public.reject_demo_lead() RETURNS trigger LANGUAGE plpgsql AS $$
        BEGIN RAISE EXCEPTION 'falha_sintetica'; END; $$;
        CREATE TRIGGER reject_demo_lead AFTER INSERT ON public.leads FOR EACH ROW EXECUTE FUNCTION public.reject_demo_lead();`);
      try {
        await processor.processOne(); equal((await pool.query("SELECT * FROM public.leads;")).rowCount, 0);
        equal((await read.conversations())[0]?.status, "aguardando_menu");
        equal((await pool.query("SELECT * FROM public.jobs WHERE status = 'pendente';")).rowCount, 1);
      } finally { await pool.query("DROP TRIGGER reject_demo_lead ON public.leads; DROP FUNCTION public.reject_demo_lead();"); }
      await due(); await drain(); equal((await read.conversations())[0]?.status, "aguardando_humano");
      equal((await pool.query("SELECT * FROM public.leads;")).rowCount, 1);
    });

    await t.test("intervenção humana cancela o plano pendente sem emitir resposta", async () => {
      const receipt = await receive(phone(), "Olá"); const pending = await prepared(receipt.messageId);
      await pool.query("UPDATE public.conversations SET status = 'em_atendimento_humano' WHERE id = $1;", [pending.context.conversation.id]);
      equal(await effects.apply({ ...pending, attempt: pending.job }), "concluido");
      equal((await outgoing()).length, 0); equal((await plans.findByMessageId(receipt.messageId))?.status, "cancelado");
    });

    await t.test("unicidades e FK composta de leads impedem duplicação e contato incorreto", async () => {
      const contact = phone(); await receive(contact, "Olá"); await drain(); await receive(contact, "3"); await drain();
      const lead = (await pool.query("SELECT * FROM public.leads;")).rows[0]; ok(lead);
      await rejects(pool.query("INSERT INTO public.leads (conversation_id, contact_id) VALUES ($1, $2);", [lead.conversation_id, lead.contact_id]), { code: "23505" });
      const other = await receive(phone(), "Oi"); await drain();
      const context = await contexts.findByMessageId(other.messageId); ok(context);
      const wrong = (await pool.query("INSERT INTO public.contacts (phone) VALUES ($1) RETURNING id;", [phone()])).rows[0]; ok(wrong);
      await rejects(pool.query("INSERT INTO public.leads (conversation_id, contact_id) VALUES ($1, $2);", [context.conversation.id, wrong.id]), { code: "23503" });
      // Outra conversa histórica do mesmo contato não autoriza outro lead aberto.
      await pool.query("UPDATE public.conversations SET status = 'encerrada', closed_at = CURRENT_TIMESTAMP WHERE id = $1;", [lead.conversation_id]);
      const next = (await pool.query("INSERT INTO public.conversations (contact_id) VALUES ($1) RETURNING id;", [lead.contact_id])).rows[0]; ok(next);
      await rejects(pool.query("INSERT INTO public.leads (conversation_id, contact_id) VALUES ($1, $2);", [next.id, lead.contact_id]), { code: "23505" });
    });

    await t.test("telas locais e erros HTTP validados estão disponíveis no modo de demonstração", async () => {
      for (const path of ["/simulator", "/admin"]) {
        const response = await fetch(url + path); equal(response.status, 200);
        ok((await response.text()).includes("Copilot Leads"));
      }
      const invalid = await fetch(`${url}/api/demo/conversations/invalido/messages`); equal(invalid.status, 400);
      const error = await invalid.json() as { code: string; correlationId: string };
      equal(error.code, "invalid_payload"); equal(error.correlationId, invalid.headers.get("X-Correlation-ID"));
    });

    await t.test("modo demo não reserva nem recupera jobs de outro provedor ou qualificação em andamento", async () => {
      const receipt = await receive(phone(), "Olá");
      await pool.query("UPDATE public.messages SET provider = 'outro_provedor' WHERE id = $1;", [receipt.messageId]);
      equal(await queue.claimNext("processar_mensagem"), undefined);
      await pool.query("UPDATE public.jobs SET status = 'processando', attempts = 1, locked_at = CURRENT_TIMESTAMP - INTERVAL '121 seconds';");
      deepEqual(await recoverExpiredJobs(queue), { requeued: 0, failed: 0 });
      const waiting = await receive(phone(), "Texto sintético");
      const context = await contexts.findByMessageId(waiting.messageId); ok(context);
      await pool.query("UPDATE public.conversations SET status = 'qualificando' WHERE id = $1;", [context.conversation.id]);
      equal(await queue.claimNext("processar_mensagem"), undefined);
      equal((await pool.query("SELECT attempts FROM public.jobs WHERE message_id = $1;", [waiting.messageId])).rows[0]?.attempts, 0);
    });

    await t.test("entrada real inicia worker e entrega respostas e card automaticamente", async () => {
      const portProbe = createServer();
      await new Promise<void>((resolve) => portProbe.listen(0, "127.0.0.1", resolve));
      const address = portProbe.address(); ok(address && typeof address !== "string");
      const demoUrl = `http://127.0.0.1:${address.port}`;
      await new Promise<void>((resolve, reject) => portProbe.close((error) => error ? reject(error) : resolve()));
      const child = spawn(process.execPath, [fileURLToPath(new URL("../../demo.js", import.meta.url))], {
        env: { ...process.env, POSTGRES_DB: database, API_PORT: String(address.port) },
        stdio: "ignore", windowsHide: true,
      });
      const exited = once(child, "exit");
      // Preserve erros de inicialização sem expor ambiente ou credenciais.
      void exited.catch(() => {});
      async function until(assertion: () => Promise<void>) {
        const deadline = Date.now() + 10000;
        while (true) {
          try { await assertion(); return; }
          catch (error) {
            if (child.exitCode !== null || child.signalCode !== null || Date.now() >= deadline) throw error;
            await new Promise((resolve) => setTimeout(resolve, 50));
          }
        }
      }
      try {
        await until(async () => { equal((await fetch(`${demoUrl}/api/demo/conversations`)).status, 200); });
        equal((await fetch(`${demoUrl}/assets/demo.js`)).status, 200);
        for (const style of ["tokens", "global", "layout", "components", "simulator", "kanban"]) {
          const asset = await fetch(`${demoUrl}/assets/styles/${style}.css`);
          equal(asset.status, 200); ok(asset.headers.get("Content-Type")?.includes("text/css"));
          ok((await asset.text()).length > 0);
        }
        const contact = phone();
        async function send(body: string) {
          const response = await fetch(`${demoUrl}/webhooks/simulator`, { method: "POST",
            headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id: randomUUID(),
              from: contact, fromMe: false, type: "text", body, timestamp: new Date().toISOString() }) });
          equal(response.status, 200);
        }
        await send("Olá");
        await until(async () => {
          equal((await read.conversations())[0]?.status, "aguardando_menu");
          ok((await outgoing()).length >= 2);
        });
        await send("3");
        await until(async () => {
          const conversation = (await read.conversations())[0];
          equal(conversation?.lead?.stage, "novo"); equal(conversation?.status, "aguardando_humano");
          equal((await pool.query("SELECT * FROM public.jobs WHERE status <> 'concluido';")).rowCount, 0);
        });
        const lead = (await read.conversations())[0]?.lead; ok(lead);
        equal((await fetch(`${demoUrl}/api/demo/leads/${lead.id}/assume`, { method: "POST" })).status, 200);
        equal((await read.conversations())[0]?.status, "em_atendimento_humano");
        const before = await outgoing(); await send("Mais uma mensagem sintética");
        await until(async () => { equal((await pool.query("SELECT * FROM public.jobs WHERE status <> 'concluido';")).rowCount, 0); });
        deepEqual(await outgoing(), before);
      } finally {
        if (child.exitCode === null && child.signalCode === null) child.kill();
        await exited;
      }
    });

    async function receptionLead(stage = "novo") {
      const contact = phone(); await receive(contact, "Olá"); await drain(); await receive(contact, "3"); await drain();
      const row = (await read.conversations())[0]; ok(row?.lead);
      await pool.query("UPDATE public.leads SET stage = $2 WHERE id = $1;", [row.lead.id, stage]);
      return { contact, id: row.lead.id, conversationId: row.id };
    }
    async function assumeHttp(id: string) {
      const response = await fetch(`${url}/api/demo/leads/${id}/assume`, { method: "POST" });
      const body = await response.json() as { status?: string; code?: string; correlationId?: string };
      return { response, body };
    }
    async function pendingLead() {
      const receipt = await receive(phone(), "Olá");
      const pending = await prepared(receipt.messageId);
      const lead = (await pool.query(`INSERT INTO public.leads (conversation_id, contact_id)
        VALUES ($1, $2) RETURNING id;`, [pending.context.conversation.id, pending.context.contact.id])).rows[0]; ok(lead);
      return { ...pending, leadId: lead.id as string };
    }
    async function waitForBlocked(blockerPid: number, queryFragment: string) {
      const deadline = Date.now() + 5000;
      while (Date.now() < deadline) {
        const result = await pool.query(`SELECT pid FROM pg_stat_activity
          WHERE datname = $1 AND wait_event_type = 'Lock' AND $2 = ANY(pg_blocking_pids(pid))
            AND query LIKE $3;`, [database, blockerPid, `%${queryFragment}%`]);
        if (result.rowCount) return;
        await new Promise<void>((resolve) => setImmediate(resolve));
      }
      throw new Error("A operação não atingiu o bloqueio esperado.");
    }

    await t.test("assunção HTTP de Novo e Qualificado mantém identidade, mensagens e revisão", async () => {
      for (const stage of ["novo", "qualificado"]) {
        const lead = await receptionLead(stage);
        await pool.query("UPDATE public.leads SET needs_review = true, summary = 'Resumo sintético' WHERE id = $1;", [lead.id]);
        const messages = (await snapshot()).messages;
        const result = await assumeHttp(lead.id.toUpperCase()); equal(result.response.status, 200); equal(result.body.status, "assumido");
        ok(result.response.headers.get("X-Correlation-ID"));
        const row = (await read.conversations()).find((item) => item.id === lead.conversationId); ok(row);
        equal(row.status, "em_atendimento_humano"); equal(row.lead?.stage, "em_atendimento");
        equal(row.lead?.id, lead.id); equal(row.lead?.needsReview, true); equal(row.lead?.summary, "Resumo sintético");
        deepEqual((await snapshot()).messages, messages);
      }
    });

    await t.test("repetição não altera timestamps e solicitações concorrentes convergem", async () => {
      const lead = await receptionLead();
      const results = await Promise.all([handoff.assume(lead.id), handoff.assume(lead.id)]);
      deepEqual(results.map((item) => item.status).sort(), ["assumido", "ja_assumido"]);
      const before = await snapshot();
      const repeated = await assumeHttp(lead.id); equal(repeated.response.status, 200); equal(repeated.body.status, "ja_assumido");
      deepEqual(await snapshot(), before);
      equal((await pool.query("SELECT count(*)::integer AS count FROM public.leads;")).rows[0]?.count, 1);
    });

    await t.test("HTTP valida UUID, ausência e conflitos com correlação consistente", async () => {
      for (const [id, status, code] of [["invalido", 400, "invalid_payload"], [randomUUID(), 404, "lead_not_found"]] as const) {
        const result = await assumeHttp(id); equal(result.response.status, status); equal(result.body.code, code);
        equal(result.body.correlationId, result.response.headers.get("X-Correlation-ID"));
      }
      const lead = await receptionLead();
      for (const [stage, status] of [["ganho", "aguardando_humano"], ["perdido", "aguardando_humano"],
        ["em_atendimento", "aguardando_humano"], ["novo", "em_atendimento_humano"], ["novo", "encerrada"]]) {
        await pool.query("UPDATE public.leads SET stage = $2 WHERE id = $1;", [lead.id, stage]);
        await pool.query(`UPDATE public.conversations SET status = $2,
          closed_at = CASE WHEN $2 = 'encerrada' THEN CURRENT_TIMESTAMP ELSE NULL END WHERE id = $1;`, [lead.conversationId, status]);
        const before = await snapshot(); const result = await assumeHttp(lead.id);
        equal(result.response.status, 409); equal(result.body.code, "invalid_lead_state");
        equal(result.body.correlationId, result.response.headers.get("X-Correlation-ID")); deepEqual(await snapshot(), before);
      }
    });

    await t.test("falha da transação devolve 500 seguro e desfaz lead, conversa e cancelamentos", async () => {
      const pending = await pendingLead(); const before = await snapshot();
      await pool.query(`CREATE FUNCTION public.reject_handoff() RETURNS trigger LANGUAGE plpgsql AS $$
        BEGIN IF NEW.status = 'em_atendimento_humano' THEN RAISE EXCEPTION 'segredo_sintetico'; END IF; RETURN NEW; END; $$;
        CREATE TRIGGER reject_handoff BEFORE UPDATE ON public.conversations FOR EACH ROW EXECUTE FUNCTION public.reject_handoff();`);
      try {
        const result = await assumeHttp(pending.leadId); equal(result.response.status, 500); equal(result.body.code, "human_handoff_failed");
        equal(result.body.correlationId, result.response.headers.get("X-Correlation-ID"));
        ok(!JSON.stringify(result.body).includes("segredo_sintetico")); deepEqual(await snapshot(), before);
      } finally { await pool.query("DROP TRIGGER reject_handoff ON public.conversations; DROP FUNCTION public.reject_handoff();"); }
      equal((await handoff.assume(pending.leadId)).status, "assumido");
    });

    await t.test("assunção preserva bloco confirmado, cancela restante e impede retomada automática", async () => {
      const pending = await pendingLead(); const original = await plans.findByMessageId(pending.context.message.id); ok(original);
      const first = original.blocks[0]; ok(first); ok(original.blocks.length > 1);
      const sent = (await pool.query(`INSERT INTO public.messages (conversation_id, provider, external_id, direction, sender_type, kind, body)
        VALUES ($1, 'simulador', $2, 'saida', 'bot', 'texto', $3) RETURNING id;`,
        [original.conversationId, `response:${original.id}:1`, first.text])).rows[0]; ok(sent);
      await pool.query(`UPDATE public.response_blocks SET status = 'enviado', sent_message_id = $2, sent_at = CURRENT_TIMESTAMP
        WHERE plan_id = $1 AND position = 1;`, [original.id, sent.id]);
      const confirmed = (await plans.findByMessageId(pending.context.message.id))?.blocks[0];
      equal((await handoff.assume(pending.leadId)).status, "assumido");
      const canceled = await plans.findByMessageId(pending.context.message.id); equal(canceled?.status, "cancelado");
      deepEqual(canceled?.blocks[0], confirmed); ok(canceled?.blocks.slice(1).every((block) => block.status === "cancelado"));
      equal(await effects.apply({ ...pending, attempt: pending.job }), "concluido");
      equal((await outgoing()).length, 1);
      await receive(pending.context.contact.phone, "Nova mensagem após assunção"); await drain();
      equal((await outgoing()).length, 1); equal((await read.conversations())[0]?.status, "em_atendimento_humano");
    });

    await t.test("mensagens após assunção são registradas sem resposta ou novo lead", async () => {
      const lead = await receptionLead(); await handoff.assume(lead.id);
      const before = await outgoing(); await receive(lead.contact, "1"); await receive(lead.contact, "Olá de novo"); await drain();
      deepEqual(await outgoing(), before); equal((await read.conversations())[0]?.lead?.id, lead.id);
      equal((await read.conversations())[0]?.status, "em_atendimento_humano");
      equal((await pool.query("SELECT * FROM public.jobs WHERE status <> 'concluido';")).rowCount, 0);
    });

    await t.test("estado é revalidado depois da espera pela conversa", async () => {
      const lead = await receptionLead(); const gate = await pool.connect();
      let waiting: ReturnType<typeof handoff.assume> | undefined;
      try {
        await gate.query("BEGIN;");
        const pid = (await gate.query("SELECT pg_backend_pid() AS pid;")).rows[0]?.pid as number;
        await gate.query("UPDATE public.conversations SET status = 'encerrada', closed_at = CURRENT_TIMESTAMP WHERE id = $1;", [lead.conversationId]);
        waiting = handoff.assume(lead.id);
        await waitForBlocked(pid, "SELECT id, status, contact_id FROM public.conversations");
        await gate.query("COMMIT;");
        equal((await waiting).status, "estado_incompativel");
        equal((await read.conversations())[0]?.lead?.stage, "novo");
      } finally { await gate.query("ROLLBACK;"); gate.release(); await waiting; }
    });

    for (const first of ["humano", "worker"] as const) {
      await t.test(`concorrência controlada: ${first} confirma primeiro sem envio após a transição`, async () => {
        const pending = await pendingLead();
        const gate = await pool.connect();
        let winner: Promise<unknown> | undefined, loser: Promise<unknown> | undefined;
        const target = first === "humano" ? "conversations" : "response_blocks";
        const condition = first === "humano" ? "NEW.status = 'em_atendimento_humano'" : "NEW.status = 'enviado'";
        try {
          await gate.query("BEGIN;"); await gate.query("SELECT pg_advisory_xact_lock(73129);");
          const pid = (await gate.query("SELECT pg_backend_pid() AS pid;")).rows[0]?.pid as number;
          await pool.query(`CREATE FUNCTION public.pause_handoff_race() RETURNS trigger LANGUAGE plpgsql AS $$
            BEGIN IF ${condition} THEN PERFORM pg_advisory_xact_lock(73129); END IF; RETURN NEW; END; $$;
            CREATE TRIGGER pause_handoff_race BEFORE UPDATE ON public.${target} FOR EACH ROW EXECUTE FUNCTION public.pause_handoff_race();`);
          const apply = () => effects.apply({ ...pending, attempt: pending.job });
          winner = first === "humano" ? handoff.assume(pending.leadId) : apply();
          // O vencedor já segura a conversa e está parado no trigger do banco.
          await waitForBlocked(pid, `UPDATE public.${target}`);
          const winnerPid = (await pool.query(`SELECT pid FROM pg_stat_activity WHERE datname = $1
            AND $2 = ANY(pg_blocking_pids(pid)) AND query LIKE $3;`, [database, pid, `%UPDATE public.${target}%`])).rows[0]?.pid as number;
          loser = first === "humano" ? apply() : handoff.assume(pending.leadId);
          await waitForBlocked(winnerPid, first === "humano" ? "SELECT status, contact_id" : "SELECT id, status, contact_id");
          await gate.query("COMMIT;"); await Promise.all([winner, loser]);
          const row = (await read.conversations())[0]; equal(row?.status, "em_atendimento_humano"); equal(row?.lead?.stage, "em_atendimento");
          const plan = await plans.findByMessageId(pending.context.message.id);
          equal(plan?.status, first === "humano" ? "cancelado" : "enviado");
          const before = await outgoing(); equal(before.length, first === "humano" ? 0 : plan?.blocks.length);
          equal(await effects.apply({ ...pending, attempt: pending.job }), "reserva_desatualizada");
          deepEqual(await outgoing(), before);
        } finally {
          await gate.query("ROLLBACK;"); gate.release();
          await Promise.allSettled([winner, loser].filter((item) => item !== undefined));
          await pool.query(`DROP TRIGGER IF EXISTS pause_handoff_race ON public.${target}; DROP FUNCTION IF EXISTS public.pause_handoff_race();`);
        }
      });
    }

    await t.test("migração de leads reverte somente seus objetos e reaplica", async () => {
      await migrate("down");
      equal((await pool.query("SELECT to_regclass('public.leads') AS relation;")).rows[0]?.relation, null);
      equal((await pool.query("SELECT * FROM pg_constraint WHERE conname = 'conversations_id_contact_id_key';")).rowCount, 0);
      equal((await pool.query("SELECT count(*)::integer AS count FROM public.pgmigrations;")).rows[0]?.count, 5);
      await migrate("up"); equal((await pool.query("SELECT * FROM public.leads;")).rowCount, 0);
    });
  } finally {
    try {
      if (server) { server.closeAllConnections(); await new Promise<void>((resolve, reject) => server!.close((error) => error ? reject(error) : resolve())); }
      await pool.end(); if (created) await admin.query(`DROP DATABASE "${database}" WITH (FORCE);`);
    } finally { await admin.end(); }
  }
});
