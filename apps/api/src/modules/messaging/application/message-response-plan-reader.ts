import type { MessageResponsePlanSnapshot } from "../contracts/message-response-plan-snapshot.js";

// A mensagem de origem identifica no máximo um plano, inclusive terminado.
// Ausência retorna undefined; dados inválidos e falhas rejeitam a Promise.
// É uma fotografia do plano e seus blocos: não reserva job ou autoriza envio.
export interface MessageResponsePlanReader {
  findByMessageId(messageId: string): Promise<MessageResponsePlanSnapshot | undefined>;
}
