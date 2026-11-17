import type { LeadQualification, QualificationSource } from "@copilot-leads/shared";
import { qualificationCandidateSchema, type QualificationInput, type QualificationProfile } from "../contracts/qualification.js";

export const normalize = (text: string) => text.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
export function buildQualificationInput(current: string, previous: readonly string[], profile: QualificationProfile, maxChars: number): QualificationInput {
  const input: QualificationInput = { business: { name: profile.name, services: profile.services.map(({ id, name }) => ({ id, name })) },
    previousMessages: [], currentMessage: "", truncated: false };
  if (JSON.stringify(input).length + 100 > maxChars) throw new Error("Contexto do perfil excede o limite.");
  input.currentMessage = current;
  while (JSON.stringify(input).length > maxChars) { input.currentMessage = input.currentMessage.slice(0, Math.max(0, input.currentMessage.length - 100)); input.truncated = true; }
  for (const text of [...new Set(previous)].filter((text) => text !== current).slice(-10).toReversed()) {
    input.previousMessages.unshift(text);
    if (JSON.stringify(input).length > maxChars) { input.previousMessages.shift(); input.truncated = true; break; }
  }
  return input;
}
export function hasInstructionAttack(text: string) {
  return /ignore.{0,40}(instruc|anterior|regras|sistema)|system\s*prompt|system\s*:|\b(altere|mude|defina|marque).{0,50}(ganho|perdido|qualificado)|\b(diagnostico|prontuario|gravidade|prescrev)/i.test(normalize(text));
}
const periodPattern = /^(?:(?:hoje|amanha|segunda(?:-feira)?|terca(?:-feira)?|quarta(?:-feira)?|quinta(?:-feira)?|sexta(?:-feira)?|sabado|domingo)(?: (?:a|de|pela) (?:manha|tarde|noite))?|(?:(?:a|de|pela) )?(?:manha|tarde|noite)|(?:[01]?\d|2[0-3])(?::[0-5]\d|h(?:[0-5]\d)?))$/;
export function evaluateQualification(raw: unknown, input: QualificationInput, source: QualificationSource): LeadQualification {
  const candidate = qualificationCandidateSchema.parse(raw);
  const text = normalize([...input.previousMessages, input.currentMessage].join("\n"));
  const contains = (evidence: string | null) => evidence !== null && text.includes(normalize(evidence));
  const attacked = hasInstructionAttack(text);
  let intent = candidate.intent;
  if (attacked || !contains(candidate.evidence.intent)
    || (intent === "agendamento" && !/agendar|agendamento|marcar/.test(normalize(candidate.evidence.intent ?? "")))
    || (intent === "informacoes" && !/informac|valor|preco|horario/.test(normalize(candidate.evidence.intent ?? "")))) intent = null;
  const mentioned = input.business.services.filter((service) => {
    const terms = [service.name, service.id.replaceAll("_", " ")];
    return terms.some((term) => text.includes(normalize(term)));
  });
  const service = !attacked && mentioned.length === 1 && mentioned[0]?.id === candidate.serviceId && contains(candidate.evidence.service)
    && [mentioned[0].name, mentioned[0].id.replaceAll("_", " ")].some((term) => normalize(candidate.evidence.service ?? "").includes(normalize(term))) ? mentioned[0] : undefined;
  const period = !attacked && candidate.period && contains(candidate.evidence.period) && contains(candidate.period)
    && normalize(candidate.period) === normalize(candidate.evidence.period ?? "") && periodPattern.test(normalize(candidate.period)) ? candidate.period : null;
  const uncertain = /\b(ou|nao|talvez|cancelar|cancele|desmarcar|desmarque)\b/.test(text);
  const complete = intent === "agendamento" && !!service && !!period && !candidate.needsReview && !input.truncated && !uncertain && !attacked;
  // Resumo construído somente a partir de campos administrativos comprovados.
  // Nunca persistir narrativa livre ou instruções devolvidas pelo modelo.
  const summary = [intent ? `Intenção: ${intent}.` : "", service ? `Serviço: ${service.name}.` : "", period ? `Período: ${period}.` : ""].filter(Boolean).join(" ") || null;
  return { intent, serviceId: service?.id ?? null, serviceName: service?.name ?? null, period, summary,
    needsReview: !complete, source, status: complete ? "qualificado" : "revisao" };
}
