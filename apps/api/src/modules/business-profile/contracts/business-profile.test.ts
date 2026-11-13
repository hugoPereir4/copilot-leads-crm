import { deepEqual, equal, ok } from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import { businessProfileSchema } from "./business-profile.js";

const definition: unknown = JSON.parse(await readFile(new URL("../../../../config/business-profile.json", import.meta.url), "utf8"));
const validProfile = () => businessProfileSchema.parse(definition);

test("perfil fictício versionado atende ao contrato sem transformar seus dados", () => {
  deepEqual(validProfile(), definition);
});

test("nome, números, rótulos e textos podem mudar na configuração", () => {
  const profile = validProfile();
  profile.name = " Outro negócio fictício ";
  profile.messages.greeting = " Outra saudação\n";
  profile.menuOptions.forEach((option, index) => { option.number = String(index + 7); option.label = `Rótulo ${index}`; });
  deepEqual(businessProfileSchema.parse(profile), profile);
});

test("fuso horário precisa ser reconhecido pelo Intl do Node", () => {
  for (const timezone of ["", " ", "Fuso/Inexistente"]) {
    equal(businessProfileSchema.safeParse({ ...validProfile(), timezone }).success, false);
  }
  equal(businessProfileSchema.safeParse({ ...validProfile(), timezone: "UTC" }).success, true);
});

test("horários rejeitam dia inválido, formato incorreto e faixas sem duração positiva no mesmo dia", () => {
  for (const interval of [
    { dayOfWeek: -1, start: "08:00", end: "12:00" },
    { dayOfWeek: 7, start: "08:00", end: "12:00" },
    { dayOfWeek: 1.5, start: "08:00", end: "12:00" },
    { dayOfWeek: 1, start: "8:00", end: "12:00" },
    { dayOfWeek: 1, start: "08:60", end: "12:00" },
    { dayOfWeek: 1, start: "08:00", end: "24:00" },
    { dayOfWeek: 1, start: "08:00", end: "08:00" },
    { dayOfWeek: 1, start: "23:00", end: "01:00" },
  ]) {
    equal(businessProfileSchema.safeParse({ ...validProfile(), openingHours: [interval] }).success, false);
  }
});

test("horários recusam sobreposição e aceitam intervalos adjacentes, dias distintos ou semana fechada", () => {
  const profile = validProfile();
  profile.openingHours = [
    { dayOfWeek: 1, start: "11:00", end: "13:00" },
    { dayOfWeek: 1, start: "08:00", end: "12:00" },
  ];
  const before = structuredClone(profile);
  equal(businessProfileSchema.safeParse(profile).success, false);
  deepEqual(profile, before);
  profile.openingHours = [
    { dayOfWeek: 1, start: "08:00", end: "12:00" },
    { dayOfWeek: 1, start: "12:00", end: "18:00" },
    { dayOfWeek: 2, start: "08:00", end: "12:00" },
  ];
  equal(businessProfileSchema.safeParse(profile).success, true);
  equal(businessProfileSchema.safeParse({ ...profile, openingHours: [] }).success, true);
});

test("serviços exigem IDs únicos e valores nulos ou inteiros seguros não negativos em centavos", () => {
  const profile = validProfile();
  const service = profile.services[0];
  ok(service);
  for (const priceInCents of [-1, 10.5, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1]) {
    equal(businessProfileSchema.safeParse({ ...profile, services: [{ ...service, priceInCents }] }).success, false);
  }
  for (const priceInCents of [null, 0, 12000]) {
    equal(businessProfileSchema.safeParse({ ...profile, services: [{ ...service, priceInCents }] }).success, true);
  }
  equal(businessProfileSchema.safeParse({ ...profile, services: [service, { ...service }] }).success, false);
  equal(businessProfileSchema.safeParse({ ...profile, services: [{ ...service, id: "ID com espaços" }] }).success, false);
});

test("menu exige números únicos e as três ações conhecidas uma vez cada", () => {
  const profile = validProfile();
  const first = profile.menuOptions[0];
  const second = profile.menuOptions[1];
  ok(first && second);
  for (const number of ["0", "01", "1.5", "x"]) {
    equal(businessProfileSchema.safeParse({ ...profile,
      menuOptions: [{ ...first, number }, ...profile.menuOptions.slice(1)] }).success, false);
  }
  for (const replacement of [
    { ...second, number: first.number },
    { ...second, action: first.action },
    { ...second, action: "acao_desconhecida" },
  ]) {
    equal(businessProfileSchema.safeParse({ ...profile,
      menuOptions: [first, replacement, ...profile.menuOptions.slice(2)] }).success, false);
  }
  equal(businessProfileSchema.safeParse({ ...profile, menuOptions: profile.menuOptions.slice(1) }).success, false);
});

test("perfil exige textos preenchidos, catálogo não vazio e moeda BRL", () => {
  const profile = validProfile();
  const service = profile.services[0];
  ok(service);
  for (const input of [
    { ...profile, name: " " },
    { ...profile, currency: "OUTRA" },
    { ...profile, messages: { ...profile.messages, greeting: "\t" } },
    { ...profile, services: [] },
    { ...profile, services: [{ ...service, description: "" }] },
  ]) equal(businessProfileSchema.safeParse(input).success, false);
});

test("campos ausentes ou desconhecidos são rejeitados para detectar erros de edição", () => {
  const profile = validProfile();
  for (const input of [
    {}, null, [], { ...profile, campoDesconhecido: true },
    { ...profile, messages: { ...profile.messages, gretting: "Erro de digitação" } },
  ]) equal(businessProfileSchema.safeParse(input).success, false);
});
