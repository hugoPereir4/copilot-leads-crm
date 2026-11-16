import type { JobAttempt } from "../../jobs/application/job-lifecycle.js";
import type { MessageResponsePlanDraft } from "../contracts/message-response-plan.js";

export type ResponsePlanPreparation = {
  readonly attempt: JobAttempt;
  readonly draft: MessageResponsePlanDraft;
};

export type ResponsePlanPreparationResult =
  | { readonly status: "preparado"; readonly planId: string }
  | { readonly status: "existente"; readonly planId: string }
  | { readonly status: "reserva_desatualizada" }
  | { readonly status: "contexto_desatualizado" }
  | { readonly status: "adiado"; readonly reason: "abertura_pendente" | "resposta_anterior_pendente" };

// Contrato da transação, implementado pelo adapter PostgreSQL da etapa 4.19:
// - Conferir id + attempts + processando e os vínculos job/mensagem/conversa.
//   Expiração, isoladamente, não invalida a tentativa (política da etapa 4.12).
// - Com tentativa válida, devolver o plano já existente da mensagem antes de
//   exigir o estado esperado para uma NOVA preparação. Nunca sobrescrever textos.
// - Para plano novo, reler estado, elegibilidade da mensagem e situação da abertura
//   sob bloqueio da conversa. No máximo uma abertura por conversa e um plano por
//   mensagem; outra resposta pendente adia a preparação, sem concluir o job.
// - Gravar plano e todos os blocos na mesma transação, sem envio ou transição de
//   conversa. Posição começa em 1. Falha deve desfazer toda a preparação.
// O resultado existente não autoriza envio: o executor deverá ler o original
// e revalidar suas próprias condições. Esta porta somente prepara a intenção.
export interface MessageResponsePlanStore {
  prepare(input: ResponsePlanPreparation): Promise<ResponsePlanPreparationResult>;
}
