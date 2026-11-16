import { deepEqual, equal, throws } from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { test } from "node:test";
import type { BusinessProfile } from "../contracts/business-profile.js";
import { isBusinessOpen } from "./is-business-open.js";

type Schedule = Pick<BusinessProfile, "timezone" | "openingHours">;
const schedule = (): Schedule => ({
  timezone: "America/Sao_Paulo",
  openingHours: [
    { dayOfWeek: 1, start: "08:00", end: "12:00" },
    { dayOfWeek: 1, start: "13:00", end: "18:00" },
  ],
});

test("expediente inclui abertura e exclui fechamento com precisão até os milissegundos da fronteira", () => {
  for (const [at, expected] of [
    ["2026-11-16T10:59:59.999Z", false], ["2026-11-16T11:00:00.000Z", true],
    ["2026-11-16T14:59:59.999Z", true], ["2026-11-16T15:00:00.000Z", false],
    ["2026-11-16T20:59:59.999Z", true], ["2026-11-16T21:00:00.000Z", false],
  ] as const) equal(isBusinessOpen(schedule(), new Date(at)), expected, at);
});

test("intervalo de almoço fica fechado até a reabertura exata", () => {
  for (const [at, expected] of [
    ["2026-11-16T15:30:00Z", false], ["2026-11-16T15:59:59.999Z", false],
    ["2026-11-16T16:00:00Z", true],
  ] as const) equal(isBusinessOpen(schedule(), new Date(at)), expected);
});

test("dia sem faixas e semana inteira vazia representam fechado", () => {
  equal(isBusinessOpen(schedule(), new Date("2026-11-17T12:00:00Z")), false);
  equal(isBusinessOpen({ ...schedule(), openingHours: [] }, new Date("2026-11-16T12:00:00Z")), false);
});

test("numeração de domingo a sábado é respeitada para todos os dias", () => {
  for (let day = 0; day < 7; day++) {
    const profile: Schedule = { timezone: "UTC", openingHours: [{ dayOfWeek: day, start: "08:00", end: "10:00" }] };
    equal(isBusinessOpen(profile, new Date(`2026-11-${String(15 + day)}T09:00:00Z`)), true);
    equal(isBusinessOpen(profile, new Date(`2026-11-${String(15 + (day + 1) % 7)}T09:00:00Z`)), false);
  }
});

test("faixas adjacentes e fora de ordem não criam lacuna nem modificam o perfil", () => {
  const profile: Schedule = { timezone: "UTC", openingHours: [
    { dayOfWeek: 1, start: "12:00", end: "18:00" },
    { dayOfWeek: 1, start: "08:00", end: "12:00" },
  ] };
  const before = structuredClone(profile);
  equal(isBusinessOpen(profile, new Date("2026-11-16T12:00:00Z")), true);
  deepEqual(profile, before);
});

test("dia e hora são locais ao negócio inclusive quando a data UTC é outra", () => {
  const profile: Schedule = { timezone: "Asia/Tokyo", openingHours: [{ dayOfWeek: 1, start: "00:00", end: "01:00" }] };
  equal(isBusinessOpen(profile, new Date("2026-11-15T15:30:00Z")), true);
  equal(isBusinessOpen(profile, new Date("2026-11-15T14:59:59Z")), false);
  profile.timezone = "America/Sao_Paulo";
  profile.openingHours = [{ dayOfWeek: 0, start: "22:00", end: "23:00" }];
  equal(isBusinessOpen(profile, new Date("2026-11-16T01:30:00Z")), true);
});

test("meia-noite é interpretada como 00 e não como 24", () => {
  const profile: Schedule = { timezone: "UTC", openingHours: [{ dayOfWeek: 1, start: "00:00", end: "00:01" }] };
  equal(isBusinessOpen(profile, new Date("2026-11-16T00:00:00Z")), true);
  equal(isBusinessOpen(profile, new Date("2026-11-16T00:00:59.999Z")), true);
  equal(isBusinessOpen(profile, new Date("2026-11-16T00:01:00Z")), false);
});

test("horário de verão usa o instante real para horas repetidas e saltos", () => {
  const profile: Schedule = { timezone: "America/New_York", openingHours: [{ dayOfWeek: 0, start: "01:00", end: "02:00" }] };
  // Fim do horário de verão: 01:30 ocorre duas vezes, ambas dentro da faixa.
  equal(isBusinessOpen(profile, new Date("2026-11-01T05:30:00Z")), true);
  equal(isBusinessOpen(profile, new Date("2026-11-01T06:30:00Z")), true);
  equal(isBusinessOpen(profile, new Date("2026-11-01T07:00:00Z")), false);
  profile.openingHours = [{ dayOfWeek: 0, start: "02:00", end: "03:00" }];
  // Início do horário de verão: o relógio salta de 01:59 para 03:00.
  equal(isBusinessOpen(profile, new Date("2026-03-08T06:59:59Z")), false);
  equal(isBusinessOpen(profile, new Date("2026-03-08T07:00:00Z")), false);
});

test("instante inválido é rejeitado sem exposição de dados do perfil", () => {
  throws(() => isBusinessOpen(schedule(), new Date(NaN)), {
    name: "RangeError", message: "Instante de expediente inválido.",
  });
});

test("fuso padrão do processo não altera o resultado do expediente configurado", () => {
  const moduleUrl = new URL("./is-business-open.js", import.meta.url).href;
  const source = `import { isBusinessOpen } from ${JSON.stringify(moduleUrl)};
    console.log(JSON.stringify([
      isBusinessOpen(${JSON.stringify(schedule())}, new Date("2026-11-16T11:00:00Z")),
      isBusinessOpen(${JSON.stringify(schedule())}, new Date("2026-11-16T15:30:00Z"))
    ]));`;
  for (const timezone of ["UTC", "Pacific/Honolulu", "Asia/Tokyo"]) {
    const child = spawnSync(process.execPath, ["--input-type=module", "-e", source], {
      env: { ...process.env, TZ: timezone }, encoding: "utf8",
    });
    equal(child.status, 0, child.stderr);
    deepEqual(JSON.parse(child.stdout), [true, false]);
  }
});
