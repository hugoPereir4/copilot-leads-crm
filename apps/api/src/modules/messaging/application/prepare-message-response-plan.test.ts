import { deepEqual, equal, match, ok, rejects } from "node:assert/strict";
import { test } from "node:test";
import { messageResponsePlanDraftSchema } from "../contracts/message-response-plan.js";
import type { MessageResponsePlanStore, ResponsePlanPreparation, ResponsePlanPreparationResult } from "./message-response-plan-store.js";
import { prepareMessageResponsePlan, type PrepareMessageResponsePlanInput } from "./prepare-message-response-plan.js";

const planId = "00000000-0000-4000-8000-000000000004";

function input(): PrepareMessageResponsePlanInput {
  return {
    job: {
      id: "00000000-0000-4000-8000-000000000003", type: "processar_mensagem",
      messageId: "00000000-0000-4000-8000-000000000001", status: "processando",
      attempts: 1, maxAttempts: 3, lockedAt: new Date("2026-11-16T12:00:00Z"),
    },
    context: {
      message: {
        id: "00000000-0000-4000-8000-000000000001", provider: "simulador", externalId: "origem-sintetica",
        direction: "entrada", senderType: "contato", kind: "texto", body: "Olá",
        createdAt: new Date("2026-11-16T12:00:00Z"),
      },
      conversation: { id: "00000000-0000-4000-8000-000000000002", status: "aguardando_menu" },
      contact: { id: "00000000-0000-4000-8000-000000000005", phone: "+15550114917", displayName: null },
    },
    profile: {
      name: "Clínica Sintética", timezone: "America/Sao_Paulo", currency: "BRL",
      openingHours: [{ dayOfWeek: 1, start: "08:00", end: "18:00" }],
      services: [{ id: "avaliacao", name: "Avaliação sintética", description: "Informações administrativas", priceInCents: 12000 }],
      menuOptions: [
        { number: "1", label: "Serviços", action: "informar_servicos" },
        { number: "2", label: "Valores", action: "informar_valores_horarios" },
        { number: "3", label: "Recepção", action: "solicitar_recepcao" },
      ],
      messages: {
        greeting: "Olá", menuIntro: "Escolha", invalidOption: "Opção inválida", servicesIntro: "Serviços",
        serviceQuestion: "Qual serviço?", pricesAndHoursIntro: "Valores e horários", schedulingQuestion: "Deseja solicitar?",
        outOfHoursNotice: "Fora do expediente",
      },
    },
    decision: { action: "enviar_abertura", nextStatus: "aguardando_menu" },
  };
}

function capture(result: ResponsePlanPreparationResult = { status: "preparado", planId }) {
  const commands: ResponsePlanPreparation[] = [];
  const store: MessageResponsePlanStore = { async prepare(command) { commands.push(command); return result; } };
  return { store, commands };
}

test("preparação entrega snapshot completo e tentativa à porta em uma única chamada", async () => {
  const request = input();
  const { store, commands } = capture();
  deepEqual(await prepareMessageResponsePlan(request, store), { status: "preparado", planId });
  equal(commands.length, 1);
  const command = commands[0];
  ok(command);
  deepEqual(command.attempt, { id: request.job.id, attempts: 1 });
  deepEqual(command.draft, {
    messageId: request.context.message.id, conversationId: request.context.conversation.id,
    expectedStatus: "aguardando_menu", decision: request.decision, referenceAt: request.context.message.createdAt,
    blocks: [
      { position: 1, text: "Clínica Sintética\nOlá" },
      { position: 2, text: "Escolha\n1 — Serviços\n2 — Valores\n3 — Recepção" },
    ],
  });
  deepEqual(messageResponsePlanDraftSchema.parse(command.draft), command.draft);
});

test("referência do expediente é a persistência da mensagem, não o horário da reserva", async () => {
  const request = input();
  request.job = { ...request.job, lockedAt: new Date("2026-11-17T01:00:00Z") }; // Mensagem registrada às 09:00.
  const { store, commands } = capture();
  await prepareMessageResponsePlan(request, store);
  equal(commands[0]?.draft.blocks.length, 2);
  request.context.message.createdAt = new Date("2026-11-16T22:00:00Z");
  await prepareMessageResponsePlan(request, store);
  equal(commands[1]?.draft.blocks.length, 3);
  match(commands[1]?.draft.blocks[1]?.text ?? "", /^Fora do expediente/);
  deepEqual(commands[1]?.draft.blocks.map((block) => block.position), [1, 2, 3]);
});

test("informações e menu inválido mantêm seus textos e estados propostos no plano", async () => {
  for (const decision of [
    { action: "informar_servicos", nextStatus: "aguardando_detalhes" },
    { action: "informar_valores_horarios", nextStatus: "aguardando_detalhes" },
    { action: "reapresentar_menu", nextStatus: "aguardando_menu" },
  ] as const) {
    const request = { ...input(), decision };
    const { store, commands } = capture();
    await prepareMessageResponsePlan(request, store);
    const draft = commands[0]?.draft;
    ok(draft);
    equal(draft.blocks.length, 2);
    deepEqual(draft.decision, decision);
    equal(messageResponsePlanDraftSchema.safeParse(draft).success, true);
    equal(request.context.conversation.status, "aguardando_menu");
  }
});

test("plano existente retorna o ID original sem informar nova preparação", async () => {
  const request = input();
  request.profile.messages.greeting = "Texto alterado desde a primeira tentativa";
  request.context.conversation.status = "aguardando_detalhes";
  const result = { status: "existente", planId } as const;
  const { store } = capture(result);
  equal(await prepareMessageResponsePlan(request, store), result);
});

test("reserva/contexto desatualizados e adiamento não são convertidos em sucesso", async () => {
  const results: ResponsePlanPreparationResult[] = [
    { status: "reserva_desatualizada" }, { status: "contexto_desatualizado" },
    { status: "adiado", reason: "abertura_pendente" },
    { status: "adiado", reason: "resposta_anterior_pendente" },
  ];
  for (const result of results) {
    const { store } = capture(result);
    equal(await prepareMessageResponsePlan(input(), store), result);
  }
});

test("falha da porta é propagada sem resultado de preparação", async () => {
  const failure = new Error("Falha sintética de persistência");
  const store: MessageResponsePlanStore = { async prepare() { throw failure; } };
  await rejects(prepareMessageResponsePlan(input(), store), (error: unknown) => error === failure);
});

test("reserva de outra mensagem é recusada antes da porta", async () => {
  const request = input();
  request.job = { ...request.job, messageId: "00000000-0000-4000-8000-000000000099" };
  const { store, commands } = capture();
  await rejects(prepareMessageResponsePlan(request, store), { message: "A reserva e o contexto devem pertencer à mesma mensagem." });
  equal(commands.length, 0);
});

test("contadores inválidos são recusados antes da porta", async () => {
  for (const attempts of [0, -1, NaN, Infinity, 1.5, 4]) {
    const request = input();
    request.job = { ...request.job, attempts };
    const { store, commands } = capture();
    await rejects(prepareMessageResponsePlan(request, store), RangeError);
    equal(commands.length, 0);
  }
});

test("mensagem não elegível é recusada antes da porta", async () => {
  const requests = [input(), input(), input(), input(), input()];
  const [media, outgoing, bot, blank, missing] = requests;
  ok(media && outgoing && bot && blank && missing);
  media.context.message.kind = "audio";
  outgoing.context.message.direction = "saida";
  bot.context.message.senderType = "bot";
  blank.context.message.body = " \n";
  missing.context.message.body = null;
  for (const request of requests) {
    const { store, commands } = capture();
    await rejects(prepareMessageResponsePlan(request, store), { message: "A mensagem não permite preparar uma resposta de texto." });
    equal(commands.length, 0);
  }
});

test("preparação preserva entradas e não compartilha data ou decisão com a porta", async () => {
  const request = input();
  const before = structuredClone(request);
  const { store, commands } = capture();
  await prepareMessageResponsePlan(request, store);
  const draft = commands[0]?.draft;
  ok(draft);
  draft.referenceAt.setUTCFullYear(2000);
  draft.decision = { action: "informar_servicos", nextStatus: "aguardando_detalhes" };
  draft.blocks[0] = { position: 1, text: "Alteração apenas na cópia" };
  deepEqual(request, before);
});
