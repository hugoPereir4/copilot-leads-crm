import type { MessageProcessingContext } from "../contracts/message-processing-context.js";

// O ID interno vem da mensagem persistida (UUID). Ausência retorna undefined;
// falhas de infraestrutura ou contexto inválido devem rejeitar a Promise.
// Segue o vínculo original da mensagem, inclusive com conversa encerrada.
// O resultado é uma fotografia: não reserva job, bloqueia conversa ou autoriza envio.
export interface MessageProcessingContextReader {
  findByMessageId(messageId: string): Promise<MessageProcessingContext | undefined>;
}
