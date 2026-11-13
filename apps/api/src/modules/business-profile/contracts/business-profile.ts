import { z } from "zod";

const text = z.string().refine((value) => value.trim().length > 0);
const time = z.string().regex(/^(?:[01][0-9]|2[0-3]):[0-5][0-9]$/);
const openingInterval = z.strictObject({
  dayOfWeek: z.number().int().min(0).max(6), // Domingo = 0; sábado = 6.
  start: time,
  end: time,
}).refine((interval) => interval.start < interval.end, {
  message: "O início deve ser anterior ao fim no mesmo dia.", path: ["end"],
});

export const businessProfileSchema = z.strictObject({
  name: text,
  timezone: text.refine((value) => {
    try { new Intl.DateTimeFormat("pt-BR", { timeZone: value }); return true; }
    catch { return false; }
  }, "Fuso horário não reconhecido."),
  currency: z.literal("BRL"),
  openingHours: z.array(openingInterval),
  services: z.array(z.strictObject({
    id: z.string().regex(/^[a-z][a-z0-9_-]*$/),
    name: text,
    description: text,
    priceInCents: z.number().int().min(0).max(Number.MAX_SAFE_INTEGER).nullable(),
  })).min(1),
  menuOptions: z.array(z.strictObject({
    number: z.string().regex(/^[1-9][0-9]?$/),
    label: text,
    action: z.enum(["informar_servicos", "informar_valores_horarios", "solicitar_recepcao"]),
  })).length(3),
  messages: z.strictObject({
    greeting: text,
    menuIntro: text,
    invalidOption: text,
    servicesIntro: text,
    serviceQuestion: text,
    pricesAndHoursIntro: text,
    schedulingQuestion: text,
    outOfHoursNotice: text,
  }),
}).superRefine((profile, context) => {
  const serviceIds = new Set<string>();
  profile.services.forEach((service, index) => {
    if (serviceIds.has(service.id)) {
      context.addIssue({ code: "custom", path: ["services", index, "id"], message: "ID de serviço repetido." });
    }
    serviceIds.add(service.id);
  });
  const numbers = new Set<string>();
  const actions = new Set<string>();
  profile.menuOptions.forEach((option, index) => {
    if (numbers.has(option.number)) {
      context.addIssue({ code: "custom", path: ["menuOptions", index, "number"], message: "Número de opção repetido." });
    }
    if (actions.has(option.action)) {
      context.addIssue({ code: "custom", path: ["menuOptions", index, "action"], message: "Ação de menu repetida." });
    }
    numbers.add(option.number);
    actions.add(option.action);
  });
  // Ordena uma cópia apenas para validar; a ordem fornecida no JSON é preservada.
  const intervals = profile.openingHours.toSorted((a, b) => a.dayOfWeek - b.dayOfWeek || a.start.localeCompare(b.start));
  for (let index = 1; index < intervals.length; index++) {
    const previous = intervals[index - 1];
    const current = intervals[index];
    if (previous && current && previous.dayOfWeek === current.dayOfWeek && previous.end > current.start) {
      context.addIssue({ code: "custom", path: ["openingHours"], message: "Faixas do mesmo dia não podem se sobrepor." });
    }
  }
});

export type BusinessProfile = z.output<typeof businessProfileSchema>;
