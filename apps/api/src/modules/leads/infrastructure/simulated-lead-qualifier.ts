import { normalize, hasInstructionAttack } from "../application/qualification-rules.js";
import type { LeadQualifier, QualificationCandidate, QualificationInput } from "../contracts/qualification.js";

export class SimulatedLeadQualifier implements LeadQualifier {
  readonly source = "simulated" as const;
  async qualify(input: QualificationInput): Promise<QualificationCandidate> {
    const text = [...input.previousMessages, input.currentMessage].join("\n");
    const normalized = normalize(text);
    const service = input.business.services.find((item) => normalized.includes(normalize(item.name)) || normalized.includes(normalize(item.id.replaceAll("_", " "))));
    const term = service && (normalized.includes(normalize(service.name)) ? service.name : service.id.replaceAll("_", " "));
    const intentMatch = normalized.match(/agendar|agendamento|marcar|informacoes|valores|preco|horario/);
    const periodMatch = normalized.match(/(?:hoje|amanha|segunda(?:-feira)?|terca(?:-feira)?|quarta(?:-feira)?|quinta(?:-feira)?|sexta(?:-feira)?|sabado|domingo)(?: (?:a|de|pela) (?:manha|tarde|noite))?|(?:a |de |pela )?(?:manha|tarde|noite)|\b(?:[01]?\d|2[0-3])(?::[0-5]\d|h(?:[0-5]\d)?)\b/);
    return { intent: intentMatch ? /agendar|agendamento|marcar/.test(intentMatch[0]) ? "agendamento" : "informacoes" : null,
      serviceId: service?.id ?? null, period: periodMatch?.[0] ?? null, summary: null,
      needsReview: hasInstructionAttack(text) || /\bou\b/.test(normalized),
      evidence: { intent: intentMatch?.[0] ?? null, service: term ?? null, period: periodMatch?.[0] ?? null } };
  }
}
