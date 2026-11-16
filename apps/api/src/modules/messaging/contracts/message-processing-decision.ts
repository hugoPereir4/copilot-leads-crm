// Intenções internas, produzidas pela aplicação. nextStatus é uma proposta;
// retornar uma decisão não executa efeitos nem altera a conversa ou o job.
export type MessageProcessingDecision =
  | { action: "enviar_abertura"; nextStatus: "aguardando_menu" }
  | { action: "reapresentar_menu"; nextStatus: "aguardando_menu" }
  | { action: "informar_servicos"; nextStatus: "aguardando_detalhes" }
  | { action: "informar_valores_horarios"; nextStatus: "aguardando_detalhes" }
  | {
    action: "solicitar_recepcao";
    nextStatus: "aguardando_humano";
    lead: { stage: "novo"; needsReview: false };
  }
  | { action: "solicitar_qualificacao"; nextStatus: "qualificando" }
  | { action: "adiar"; reason: "qualificacao_em_andamento" }
  | {
    action: "ignorar";
    reason:
      | "mensagem_nao_recebida_do_contato"
      | "midia_nao_processavel"
      | "texto_vazio"
      | "aguardando_humano"
      | "em_atendimento_humano"
      | "conversa_encerrada";
  };
