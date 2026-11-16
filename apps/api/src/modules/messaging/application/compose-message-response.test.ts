import { deepEqual, equal, match, notEqual, ok, throws } from "node:assert/strict";
import { test } from "node:test";
import type { BusinessProfile } from "../../business-profile/contracts/business-profile.js";
import type { MessageProcessingDecision } from "../contracts/message-processing-decision.js";
import { composeMessageResponse } from "./compose-message-response.js";

const at = new Date("2026-11-16T12:00:00Z"); // Segunda, 09:00 em São Paulo.
const opening: MessageProcessingDecision = { action: "enviar_abertura", nextStatus: "aguardando_menu" };
const prices: MessageProcessingDecision = { action: "informar_valores_horarios", nextStatus: "aguardando_detalhes" };

function profile(): BusinessProfile {
  return {
    name: "Clínica Sintética", timezone: "America/Sao_Paulo", currency: "BRL",
    openingHours: [
      { dayOfWeek: 1, start: "13:00", end: "18:00" },
      { dayOfWeek: 1, start: "08:00", end: "12:00" },
    ],
    services: [
      { id: "avaliacao", name: "Avaliação sintética", description: "Informações administrativas", priceInCents: 12000 },
      { id: "sessao", name: "Sessão sintética", description: "Pedido de agendamento", priceInCents: 10050 },
    ],
    menuOptions: [
      { number: "7", label: "Serviços", action: "informar_servicos" },
      { number: "8", label: "Valores", action: "informar_valores_horarios" },
      { number: "9", label: "Recepção", action: "solicitar_recepcao" },
    ],
    messages: {
      greeting: "Olá, esta é uma demonstração.", menuIntro: "Escolha uma opção:",
      invalidOption: "Opção não reconhecida.", servicesIntro: "Serviços configurados:",
      serviceQuestion: "Qual serviço interessa?", pricesAndHoursIntro: "Valores e horários:",
      schedulingQuestion: "Deseja solicitar um agendamento? A recepção confirmará a disponibilidade.",
      outOfHoursNotice: "Fora do expediente. Confira os horários a seguir:",
    },
  };
}

const menu = "Escolha uma opção:\n7 — Serviços\n8 — Valores\n9 — Recepção";
const hours = ["Horários de atendimento (America/Sao_Paulo):",
  "Segunda-feira: 08:00 às 12:00; 13:00 às 18:00", "Terça-feira: Fechado",
  "Quarta-feira: Fechado", "Quinta-feira: Fechado", "Sexta-feira: Fechado", "Sábado: Fechado", "Domingo: Fechado"].join("\n");

test("abertura dentro do expediente compõe nome, saudação e menu em ordem", () => {
  deepEqual(composeMessageResponse(opening, profile(), at), ["Clínica Sintética\nOlá, esta é uma demonstração.", menu]);
});

test("abertura fora do expediente inclui aviso e horários antes do menu, inclusive no almoço", () => {
  for (const instant of ["2026-11-16T15:30:00Z", "2026-11-17T12:00:00Z"]) {
    deepEqual(composeMessageResponse(opening, profile(), new Date(instant)), [
      "Clínica Sintética\nOlá, esta é uma demonstração.",
      `Fora do expediente. Confira os horários a seguir:\n\n${hours}`, menu,
    ]);
  }
});

test("opção inválida reapresenta texto e menu configurados sem repetir abertura ou aviso", () => {
  deepEqual(composeMessageResponse({ action: "reapresentar_menu", nextStatus: "aguardando_menu" }, profile(),
    new Date("2026-11-16T22:00:00Z")), ["Opção não reconhecida.", menu]);
});

test("serviços apresentam descrições e pergunta sem incluir preços ou aviso de expediente", () => {
  deepEqual(composeMessageResponse({ action: "informar_servicos", nextStatus: "aguardando_detalhes" }, profile(), at), [
    "Serviços configurados:\n\nAvaliação sintética: Informações administrativas\nSessão sintética: Pedido de agendamento",
    "Qual serviço interessa?",
  ]);
});

test("valores usam centavos, horários ordenados, dias fechados e pergunta de solicitação", () => {
  const response = composeMessageResponse(prices, profile(), at);
  // Intl usa espaço não separável entre moeda e valor.
  deepEqual(response, [
    `Valores e horários:\n\nAvaliação sintética: R$\u00a0120,00\nSessão sintética: R$\u00a0100,50\n\n${hours}`,
    "Deseja solicitar um agendamento? A recepção confirmará a disponibilidade.",
  ]);
});

test("valor ausente não é inventado nem confundido com serviço gratuito", () => {
  const business = profile();
  business.services = [
    { id: "ausente", name: "Sem preço", description: "Sintético", priceInCents: null },
    { id: "gratuito", name: "Gratuito", description: "Sintético", priceInCents: 0 },
  ];
  const result = composeMessageResponse(prices, business, at).join("\n");
  match(result, /Sem preço: Valor não informado/);
  match(result, /Gratuito: R\$\u00a00,00/);
});

test("formatação preserva centavos em todo o intervalo de inteiros seguros do contrato", () => {
  const business = profile();
  business.services = [{ id: "limite", name: "Limite sintético", description: "Sintético", priceInCents: Number.MAX_SAFE_INTEGER }];
  match(composeMessageResponse(prices, business, at).join("\n"), /R\$\u00a090\.071\.992\.547\.409,91/);
});

test("semana vazia aparece fechada em todos os dias e a abertura ainda oferece menu", () => {
  const business = profile();
  business.openingHours = [];
  const response = composeMessageResponse(opening, business, at);
  equal(response.length, 3);
  equal(response[1]?.match(/: Fechado/g)?.length, 7);
  equal(response[2], menu);
});

test("recepção, qualificação, silêncio e adiamento não compõem respostas adicionais", () => {
  const decisions: MessageProcessingDecision[] = [
    { action: "solicitar_recepcao", nextStatus: "aguardando_humano", lead: { stage: "novo", needsReview: false } },
    { action: "solicitar_qualificacao", nextStatus: "qualificando" },
    { action: "adiar", reason: "qualificacao_em_andamento" },
    ...(["mensagem_nao_recebida_do_contato", "midia_nao_processavel", "texto_vazio",
      "aguardando_humano", "em_atendimento_humano", "conversa_encerrada"] as const)
      .map((reason) => ({ action: "ignorar" as const, reason })),
  ];
  for (const decision of decisions) deepEqual(composeMessageResponse(decision, profile(), at), []);
});

test("textos-base, nome e ordem do menu vêm do perfil sem alterar sua formatação", () => {
  const business = profile();
  business.name = "Outro negócio sintético";
  business.messages.greeting = "Saudação alternativa\nCom segunda linha";
  business.messages.menuIntro = "Menu alternativo:";
  business.menuOptions.reverse();
  deepEqual(composeMessageResponse(opening, business, at), [
    "Outro negócio sintético\nSaudação alternativa\nCom segunda linha",
    "Menu alternativo:\n9 — Recepção\n8 — Valores\n7 — Serviços",
  ]);
});

test("composição é determinística, não modifica entradas e devolve listas independentes", () => {
  const business = profile();
  const before = structuredClone({ business, opening, at });
  const first = composeMessageResponse(opening, business, at);
  const second = composeMessageResponse(opening, business, at);
  deepEqual(first, second);
  notEqual(first, second);
  first.push("Alteração local");
  ok(!second.includes("Alteração local"));
  composeMessageResponse(prices, business, at); // Ordenação dos horários também deve preservar o perfil.
  deepEqual({ business, opening, at }, before);
});

test("abertura com instante inválido rejeita em vez de inventar expediente", () => {
  throws(() => composeMessageResponse(opening, profile(), new Date(NaN)), {
    name: "RangeError", message: "Instante de expediente inválido.",
  });
});
