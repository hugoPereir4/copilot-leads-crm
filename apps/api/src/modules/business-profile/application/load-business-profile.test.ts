import { equal, rejects } from "node:assert/strict";
import { test } from "node:test";
import type { BusinessProfile } from "../contracts/business-profile.js";
import type { BusinessProfileReader } from "./business-profile-reader.js";
import { loadBusinessProfile } from "./load-business-profile.js";

test("carga do perfil solicita a leitura e preserva o resultado da porta", async () => {
  const profile: BusinessProfile = {
    name: "Negócio sintético", timezone: "UTC", currency: "BRL", openingHours: [],
    services: [{ id: "servico", name: "Serviço sintético", description: "Descrição", priceInCents: null }],
    menuOptions: [
      { number: "1", label: "Serviços", action: "informar_servicos" },
      { number: "2", label: "Valores", action: "informar_valores_horarios" },
      { number: "3", label: "Recepção", action: "solicitar_recepcao" },
    ],
    messages: {
      greeting: "Olá", menuIntro: "Menu", invalidOption: "Opção inválida",
      servicesIntro: "Serviços", serviceQuestion: "Qual serviço?",
      pricesAndHoursIntro: "Valores e horários", schedulingQuestion: "Deseja solicitar?",
      outOfHoursNotice: "Fora do expediente",
    },
  };
  let calls = 0;
  const reader: BusinessProfileReader = { async read() { calls++; return profile; } };
  equal(await loadBusinessProfile(reader), profile);
  equal(calls, 1);
});

test("carga do perfil propaga falha sem fabricar uma configuração de fallback", async () => {
  const failure = new Error("Falha sintética de configuração.");
  const reader: BusinessProfileReader = { async read() { throw failure; } };
  await rejects(loadBusinessProfile(reader), (error: unknown) => error === failure);
});
