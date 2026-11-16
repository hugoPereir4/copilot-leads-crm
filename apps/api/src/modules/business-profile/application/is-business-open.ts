import type { BusinessProfile } from "../contracts/business-profile.js";

type BusinessSchedule = Pick<BusinessProfile, "timezone" | "openingHours">;

// O instante é obrigatório: não consulta o relógio nem o fuso padrão do servidor.
export function isBusinessOpen(profile: BusinessSchedule, at: Date): boolean {
  if (!Number.isFinite(at.getTime())) throw new RangeError("Instante de expediente inválido.");
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: profile.timezone, weekday: "short", hour: "2-digit", minute: "2-digit",
    hourCycle: "h23", numberingSystem: "latn",
  }).formatToParts(at);
  const part = (type: Intl.DateTimeFormatPartTypes): string => {
    const value = parts.find((candidate) => candidate.type === type)?.value;
    if (value === undefined) throw new Error("Não foi possível interpretar o horário do negócio.");
    return value;
  };
  const day = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].indexOf(part("weekday"));
  if (day < 0) throw new Error("Não foi possível interpretar o dia do negócio.");
  const time = `${part("hour")}:${part("minute")}`;
  // HH:mm canônico permite comparação textual, com precisão de minuto.
  return profile.openingHours.some((interval) =>
    interval.dayOfWeek === day && interval.start <= time && time < interval.end);
}
