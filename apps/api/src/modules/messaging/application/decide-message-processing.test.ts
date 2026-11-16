import { deepEqual, notEqual } from "node:assert/strict";
import { test } from "node:test";
import type { BusinessProfile } from "../../business-profile/contracts/business-profile.js";
import type { MessageProcessingContext } from "../contracts/message-processing-context.js";
import { decideMessageProcessing, type MessageProcessingDecisionInput } from "./decide-message-processing.js";

type Status = MessageProcessingContext["conversation"]["status"];

function input(status: Status = "aguardando_menu", body: string | null = "Olá"): MessageProcessingDecisionInput {
  return {
    context: {
      message: {
        id: "00000000-0000-4000-8000-000000000001", provider: "simulador",
        externalId: "decisao-sintetica", direction: "entrada", senderType: "contato",
        kind: "texto", body, createdAt: new Date("2026-11-13T12:00:00Z"),
      },
      conversation: { id: "00000000-0000-4000-8000-000000000002", status },
      contact: { id: "00000000-0000-4000-8000-000000000003", phone: "+15550114915", displayName: null },
    },
    profile: {
      menuOptions: [
        { number: "1", label: "Serviços", action: "informar_servicos" },
        { number: "2", label: "Valores", action: "informar_valores_horarios" },
        { number: "3", label: "Recepção", action: "solicitar_recepcao" },
      ],
    },
    openingStatus: "enviada",
  };
}

test("abertura pendente propõe saudação e menu sem interpretar a primeira mensagem", () => {
  for (const body of ["Olá", "1", "2", "3", "999"]) {
    const request = input("aguardando_menu", body);
    request.openingStatus = "pendente";
    deepEqual(decideMessageProcessing(request), { action: "enviar_abertura", nextStatus: "aguardando_menu" });
  }
});

test("menu já enviado não abre novamente o ciclo", () => {
  deepEqual(decideMessageProcessing(input("aguardando_menu", "Olá")), {
    action: "solicitar_qualificacao", nextStatus: "qualificando",
  });
});

test("opções de serviços e valores propõem informações e espera por detalhes", () => {
  for (const [body, action] of [["1", "informar_servicos"], ["2", "informar_valores_horarios"]]) {
    deepEqual(decideMessageProcessing(input("aguardando_menu", body)), { action, nextStatus: "aguardando_detalhes" });
  }
});

test("recepção propõe lead Novo sem Revisar, sem solicitar qualificação", () => {
  deepEqual(decideMessageProcessing(input("aguardando_menu", "3")), {
    action: "solicitar_recepcao", nextStatus: "aguardando_humano", lead: { stage: "novo", needsReview: false },
  });
});

test("escolhas respeitam números, rótulos e ordem do perfil sem fixar 1, 2 e 3", () => {
  const request = input();
  const menuOptions: BusinessProfile["menuOptions"] = [
    { number: "9", label: "Atendimento", action: "solicitar_recepcao" },
    { number: "7", label: "Catálogo", action: "informar_servicos" },
    { number: "8", label: "Tabela", action: "informar_valores_horarios" },
  ];
  request.profile = { menuOptions };
  for (const option of menuOptions) {
    request.context.message.body = option.number;
    deepEqual(decideMessageProcessing(request).action, option.action);
  }
  request.context.message.body = "1";
  deepEqual(decideMessageProcessing(request), { action: "reapresentar_menu", nextStatus: "aguardando_menu" });
});

test("espaços externos são desconsiderados apenas na interpretação do menu", () => {
  const request = input("aguardando_menu", " \t2\n");
  deepEqual(decideMessageProcessing(request), { action: "informar_valores_horarios", nextStatus: "aguardando_detalhes" });
  deepEqual(request.context.message.body, " \t2\n");
});

test("números não configurados reapresentam menu sem coerção nem qualificação", () => {
  for (const body of ["0", "4", "99", "100", "01", "000", "999999999999999999999999"]) {
    deepEqual(decideMessageProcessing(input("aguardando_menu", body)), {
      action: "reapresentar_menu", nextStatus: "aguardando_menu",
    });
  }
});

test("texto livre no menu solicita qualificação sem inferir intenção pelo conteúdo", () => {
  for (const body of ["Quero informações", "opção 1", "1.5", "-1", "1 ou 2?", "1\n2"]) {
    deepEqual(decideMessageProcessing(input("aguardando_menu", body)), {
      action: "solicitar_qualificacao", nextStatus: "qualificando",
    });
  }
});

test("detalhes seguem para qualificação inclusive se a resposta parecer opção de menu", () => {
  for (const body of ["Avaliação na próxima semana", "1", "3", "99"]) {
    const request = input("aguardando_detalhes", body);
    request.openingStatus = "pendente";
    deepEqual(decideMessageProcessing(request), { action: "solicitar_qualificacao", nextStatus: "qualificando" });
  }
});

test("qualificação em andamento adia sem iniciar outra extração nem propor descarte", () => {
  for (const openingStatus of ["pendente", "enviada"] as const) {
    deepEqual(decideMessageProcessing({ ...input("qualificando", "Mais informações"), openingStatus }), {
      action: "adiar", reason: "qualificacao_em_andamento",
    });
  }
});

test("estados humanos e encerrado preservam silêncio mesmo com abertura pendente", () => {
  for (const [status, reason] of [
    ["aguardando_humano", "aguardando_humano"],
    ["em_atendimento_humano", "em_atendimento_humano"],
    ["encerrada", "conversa_encerrada"],
  ] as const) {
    for (const openingStatus of ["pendente", "enviada"] as const) {
      for (const body of ["1", "3", "Olá"]) {
        deepEqual(decideMessageProcessing({ ...input(status, body), openingStatus }), { action: "ignorar", reason });
      }
    }
  }
});

test("saídas e remetentes bot ou atendente não produzem ações automáticas", () => {
  for (const direction of ["entrada", "saida"] as const) {
    for (const senderType of ["contato", "bot", "atendente"] as const) {
      if (direction === "entrada" && senderType === "contato") continue;
      const request = input();
      request.context.message.direction = direction;
      request.context.message.senderType = senderType;
      request.openingStatus = "pendente";
      deepEqual(decideMessageProcessing(request), { action: "ignorar", reason: "mensagem_nao_recebida_do_contato" });
    }
  }
});

test("mídias não produzem abertura, encaminhamento ou qualificação", () => {
  for (const kind of ["audio", "outro"] as const) {
    const request = input("aguardando_menu", "3");
    request.context.message.kind = kind;
    request.openingStatus = "pendente";
    deepEqual(decideMessageProcessing(request), { action: "ignorar", reason: "midia_nao_processavel" });
  }
});

test("texto nulo, vazio ou só espaços não produz efeitos em nenhum estado", () => {
  for (const status of ["aguardando_menu", "aguardando_detalhes", "qualificando",
    "aguardando_humano", "em_atendimento_humano", "encerrada"] as const) {
    for (const body of [null, "", " \t\n"]) {
      deepEqual(decideMessageProcessing({ ...input(status, body), openingStatus: "pendente" }), {
        action: "ignorar", reason: "texto_vazio",
      });
    }
  }
});

test("decisão é determinística e não modifica entradas, datas ou objetos de decisões anteriores", () => {
  const request = input("aguardando_menu", "3");
  const before = structuredClone(request);
  const first = decideMessageProcessing(request);
  const second = decideMessageProcessing(request);
  deepEqual(first, second);
  notEqual(first, second);
  deepEqual(request, before);
  if (first.action === "solicitar_recepcao" && second.action === "solicitar_recepcao") {
    notEqual(first.lead, second.lead);
  }
});
