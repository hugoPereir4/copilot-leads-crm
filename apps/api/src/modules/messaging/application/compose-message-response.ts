import { isBusinessOpen } from "../../business-profile/application/is-business-open.js";
import type { BusinessProfile } from "../../business-profile/contracts/business-profile.js";
import type { MessageProcessingDecision } from "../contracts/message-processing-decision.js";

// Lista de textos em ordem, sem envio, IDs de provedor ou confirmação de efeitos.
// O instante só é usado para compor a abertura; o perfil já deve estar validado.
export function composeMessageResponse(
  decision: MessageProcessingDecision, profile: BusinessProfile, at: Date,
): string[] {
  const { messages } = profile;
  switch (decision.action) {
    case "enviar_abertura": {
      const opening = [`${profile.name}\n${messages.greeting}`];
      if (!isBusinessOpen(profile, at)) {
        opening.push(`${messages.outOfHoursNotice}\n\n${formatOpeningHours(profile)}`);
      }
      return [...opening, formatMenu(profile)];
    }
    case "reapresentar_menu":
      return [messages.invalidOption, formatMenu(profile)];
    case "informar_servicos":
      return [
        `${messages.servicesIntro}\n\n${profile.services.map((service) => `${service.name}: ${service.description}`).join("\n")}`,
        messages.serviceQuestion,
      ];
    case "informar_valores_horarios":
      return [
        [messages.pricesAndHoursIntro,
          profile.services.map((service) => `${service.name}: ${service.priceInCents === null
            ? "Valor não informado" : formatPrice(service.priceInCents, profile.currency)}`).join("\n"),
          formatOpeningHours(profile)].join("\n\n"),
        messages.schedulingQuestion,
      ];
    case "solicitar_recepcao":
    case "solicitar_qualificacao":
    case "ignorar":
    case "adiar":
      return [];
    default:
      return unreachable(decision);
  }
}

function formatMenu(profile: BusinessProfile): string {
  return `${profile.messages.menuIntro}\n${profile.menuOptions.map((option) => `${option.number} — ${option.label}`).join("\n")}`;
}

function formatOpeningHours(profile: BusinessProfile): string {
  const days = [
    { number: 1, name: "Segunda-feira" }, { number: 2, name: "Terça-feira" },
    { number: 3, name: "Quarta-feira" }, { number: 4, name: "Quinta-feira" },
    { number: 5, name: "Sexta-feira" }, { number: 6, name: "Sábado" }, { number: 0, name: "Domingo" },
  ];
  const lines = days.map((day) => {
    const intervals = profile.openingHours.filter((interval) => interval.dayOfWeek === day.number)
      .toSorted((a, b) => a.start.localeCompare(b.start));
    const hours = intervals.length === 0 ? "Fechado"
      : intervals.map((interval) => `${interval.start} às ${interval.end}`).join("; ");
    return `${day.name}: ${hours}`;
  });
  return [`Horários de atendimento (${profile.timezone}):`, ...lines].join("\n");
}

function formatPrice(priceInCents: number, currency: BusinessProfile["currency"]): string {
  // Evita perder centavos ao dividir inteiros próximos de MAX_SAFE_INTEGER.
  const cents = BigInt(priceInCents);
  const fraction = (cents % 100n).toString().padStart(2, "0");
  return new Intl.NumberFormat("pt-BR", { style: "currency", currency })
    .formatToParts(cents / 100n)
    .map((part) => part.type === "fraction" ? fraction : part.value).join("");
}

function unreachable(value: never): never {
  void value;
  throw new Error("Decisão de composição não reconhecida.");
}
