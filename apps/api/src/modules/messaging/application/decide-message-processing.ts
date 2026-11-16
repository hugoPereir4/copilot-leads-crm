import type { BusinessProfile } from "../../business-profile/contracts/business-profile.js";
import type { MessageProcessingContext } from "../contracts/message-processing-context.js";
import type { MessageProcessingDecision } from "../contracts/message-processing-decision.js";

export interface MessageProcessingDecisionInput {
  context: MessageProcessingContext;
  profile: Pick<BusinessProfile, "menuOptions">;
  // Obrigatório, sem default: o contexto de leitura não contém esse controle.
  // Só é consultado em aguardando_menu. Sua persistência fica para outra etapa.
  openingStatus: "pendente" | "enviada";
}

export function decideMessageProcessing({
  context, profile, openingStatus,
}: MessageProcessingDecisionInput): MessageProcessingDecision {
  const { message, conversation } = context;
  if (message.direction !== "entrada" || message.senderType !== "contato") {
    return { action: "ignorar", reason: "mensagem_nao_recebida_do_contato" };
  }
  if (message.kind !== "texto") return { action: "ignorar", reason: "midia_nao_processavel" };
  const text = message.body?.trim();
  if (!text) return { action: "ignorar", reason: "texto_vazio" };

  // Estados humanos/encerrados prevalecem mesmo com abertura marcada pendente.
  const status = conversation.status;
  switch (status) {
    case "aguardando_humano":
    case "em_atendimento_humano":
      return { action: "ignorar", reason: status };
    case "encerrada":
      return { action: "ignorar", reason: "conversa_encerrada" };
    case "qualificando":
      // Não descartar a mensagem nem iniciar uma segunda qualificação.
      // O futuro executor precisará tratar o adiamento sem concluir o job.
      return { action: "adiar", reason: "qualificacao_em_andamento" };
    case "aguardando_detalhes":
      return { action: "solicitar_qualificacao", nextStatus: "qualificando" };
    case "aguardando_menu": {
      if (openingStatus === "pendente") {
        return { action: "enviar_abertura", nextStatus: "aguardando_menu" };
      }
      const option = profile.menuOptions.find((candidate) => candidate.number === text);
      if (option) {
        switch (option.action) {
          case "informar_servicos":
          case "informar_valores_horarios":
            return { action: option.action, nextStatus: "aguardando_detalhes" };
          case "solicitar_recepcao":
            return {
              action: "solicitar_recepcao", nextStatus: "aguardando_humano",
              lead: { stage: "novo", needsReview: false },
            };
          default:
            return unreachable(option.action);
        }
      }
      // Somente dígitos ASCII isolados são tratados como escolha numérica.
      // Não converter para Number: "01" não equivale à opção "1".
      if (/^[0-9]+$/.test(text)) {
        return { action: "reapresentar_menu", nextStatus: "aguardando_menu" };
      }
      return { action: "solicitar_qualificacao", nextStatus: "qualificando" };
    }
    default:
      return unreachable(status);
  }
}

function unreachable(value: never): never {
  void value;
  throw new Error("Estado ou ação de processamento não reconhecido.");
}
