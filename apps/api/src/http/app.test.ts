import { deepEqual, equal, match, ok } from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { execFile } from "node:child_process";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import type { IncomingMessageInbox, MessageReceipt, MessageRegistration } from "../modules/messaging/application/incoming-message-inbox.js";
import { createHttpApp } from "./app.js";
import type { HttpErrorEvent } from "./http-errors.js";
import { listenHttp } from "./listen-http.js";

const payload = { id: "mensagem-sintetica", from: "+15550000001", fromMe: false,
  type: "text", body: "Olá!", timestamp: "2026-11-10T12:00:00Z" };

test("webhook do simulador por HTTP sem banco", { timeout: 30000 }, async (t) => {
  const commands: MessageRegistration[] = [];
  const events: HttpErrorEvent[] = [];
  let receipt: MessageReceipt = { status: "registrada", messageId: randomUUID() };
  let failure: Error | undefined;
  let pendingReceipt: Promise<MessageReceipt> | undefined;
  let onRegister: (() => void) | undefined;
  const inbox: IncomingMessageInbox = {
    async register(command) {
      commands.push(command);
      onRegister?.();
      if (failure) throw failure;
      return pendingReceipt ?? receipt;
    },
  };
  t.beforeEach(() => {
    commands.length = 0; events.length = 0;
    receipt = { status: "registrada", messageId: randomUUID() };
    failure = undefined; pendingReceipt = undefined; onRegister = undefined;
  });
  const server = await listenHttp(createHttpApp(inbox, (event) => events.push(event)), 0);
  const address = server.address();
  ok(address !== null && typeof address !== "string");
  const baseUrl = `http://127.0.0.1:${address.port}`;
  const post = (body: unknown) => fetch(`${baseUrl}/webhooks/simulator`, {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
  });
  async function errorResponse(response: Response, status: number, code: string) {
    equal(response.status, status);
    const body: unknown = await response.json();
    ok(body !== null && typeof body === "object" && "code" in body && "message" in body && "correlationId" in body);
    equal(body.code, code);
    equal(typeof body.message, "string");
    equal(body.correlationId, response.headers.get("X-Correlation-ID"));
    match(String(body.correlationId), /^[0-9a-f-]{36}$/);
    return body;
  }
  try {
    await t.test("POST traduz texto e preserva o original; sucesso retorna 200", async () => {
      const original = { ...payload, extra: { synthetic: true } };
      const response = await fetch(`${baseUrl}/webhooks/simulator`, {
        method: "POST", headers: { "Content-Type": "application/json", "X-Correlation-ID": "ignorar-marcador-externo" },
        body: JSON.stringify(original),
      });
      equal(response.status, 200);
      deepEqual(await response.json(), receipt);
      deepEqual(commands, [{ rawPayload: original, enqueueProcessing: true,
        message: { provider: "simulador", externalId: payload.id, phone: payload.from, kind: "texto",
          text: payload.body, receivedAt: new Date(payload.timestamp) } }]);
      match(response.headers.get("X-Correlation-ID") ?? "", /^[0-9a-f-]{36}$/);
      equal(response.headers.get("X-Powered-By"), null);
      equal(events.length, 0);
    });

    await t.test("duplicata confirmada pela persistência também retorna 200", async () => {
      receipt = { status: "duplicada", messageId: randomUUID() };
      const response = await post(payload);
      equal(response.status, 200);
      deepEqual(await response.json(), receipt);
    });

    await t.test("mensagem própria é ignorada com 200 e não chama a persistência", async () => {
      const response = await post({ fromMe: true });
      equal(response.status, 200);
      deepEqual(await response.json(), { status: "ignorada", reason: "mensagem_propria" });
      equal(commands.length, 0);
    });

    await t.test("áudio e outros conteúdos solicitam registro sem job", async () => {
      for (const type of ["audio", "other"]) {
        const response = await post({ ...payload, type, body: undefined });
        equal(response.status, 200);
        await response.json();
      }
      equal(commands.length, 2);
      equal(commands[0]?.message.kind, "audio");
      equal(commands[1]?.message.kind, "outro");
      for (const command of commands) equal(command.enqueueProcessing, false);
    });

    await t.test("payload inválido retorna campos externos sem valores e não grava", async () => {
      const response = await post({ ...payload, from: "conteudo-sintetico-invalido" });
      const body = await errorResponse(response, 400, "invalid_payload");
      deepEqual(body, { code: "invalid_payload", message: "Payload do simulador inválido.",
        correlationId: response.headers.get("X-Correlation-ID"), details: { fields: ["from"] } });
      equal(commands.length, 0);
      deepEqual(events, [{ level: "warn", code: "invalid_payload", correlationId: body.correlationId }]);
    });

    await t.test("Content-Type diferente de application/json retorna 415", async () => {
      const response = await fetch(`${baseUrl}/webhooks/simulator`, {
        method: "POST", headers: { "Content-Type": "text/plain" }, body: JSON.stringify(payload),
      });
      await errorResponse(response, 415, "unsupported_media_type");
      equal(commands.length, 0);
    });

    await t.test("JSON malformado retorna 400 pelo middleware de erro", async () => {
      const response = await fetch(`${baseUrl}/webhooks/simulator`, {
        method: "POST", headers: { "Content-Type": "application/json" }, body: '{"marcador-sintetico":',
      });
      await errorResponse(response, 400, "invalid_json");
      equal(commands.length, 0);
    });

    await t.test("corpo acima de 64 KiB retorna 413 sem chamar a persistência", async () => {
      const response = await post({ ...payload, body: "a".repeat(70 * 1024) });
      await errorResponse(response, 413, "payload_too_large");
      equal(commands.length, 0);
    });

    await t.test("charset não suportado retorna 415", async () => {
      const response = await fetch(`${baseUrl}/webhooks/simulator`, {
        method: "POST", headers: { "Content-Type": "application/json; charset=iso-8859-1" }, body: JSON.stringify(payload),
      });
      await errorResponse(response, 415, "unsupported_media_type");
      equal(commands.length, 0);
    });

    await t.test("falha assíncrona retorna 500 e log sem detalhes internos", async () => {
      failure = new Error("detalhe-sintetico-que-nao-deve-ser-exposto");
      const response = await post(payload);
      const body = await errorResponse(response, 500, "internal_error");
      deepEqual(body, { code: "internal_error", message: "Não foi possível receber a mensagem. Tente novamente.",
        correlationId: response.headers.get("X-Correlation-ID") });
      deepEqual(events, [{ level: "error", code: "internal_error", correlationId: body.correlationId }]);
    });

    await t.test("rota inexistente retorna erro JSON com correlação", async () => {
      await errorResponse(await fetch(`${baseUrl}/nao-existe`), 404, "route_not_found");
      equal(commands.length, 0);
    });

    await t.test("resposta aguarda a conclusão da persistência", async () => {
      let release: ((value: MessageReceipt) => void) | undefined;
      pendingReceipt = new Promise((resolve) => { release = resolve; });
      const entered = new Promise<void>((resolve) => { onRegister = resolve; });
      let responseArrived = false;
      const pendingResponse = post(payload).then((response) => { responseArrived = true; return response; });
      const finalReceipt: MessageReceipt = { status: "registrada", messageId: randomUUID() };
      try {
        await entered;
        equal(responseArrived, false);
      } finally {
        release?.(finalReceipt);
      }
      const response = await pendingResponse;
      equal(response.status, 200);
      deepEqual(await response.json(), finalReceipt);
    });

    await t.test("cliente executável envia o exemplo versionado à API", async () => {
      const executeFile = promisify(execFile);
      const script = fileURLToPath(new URL("../scripts/simulate-message.js", import.meta.url));
      const { stdout, stderr } = await executeFile(process.execPath, [script], {
        env: { ...process.env, API_PORT: String(address.port) }, timeout: 10000,
      });
      match(stdout, /HTTP 200/);
      ok(stdout.includes(receipt.messageId));
      equal(stderr, "");
      equal(commands.length, 1);
      equal(commands[0]?.message.externalId, "simulador-texto-001");
    });
  } finally {
    await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  }
});
