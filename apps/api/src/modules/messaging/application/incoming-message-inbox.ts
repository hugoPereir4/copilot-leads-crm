import type { NormalizedMessage } from "../contracts/normalized-message.js";

export type IncomingMessageInput = {
  readonly message: NormalizedMessage;
  // O caso de uso transporta o original sem conhecer o formato do provedor.
  readonly rawPayload: unknown;
};

export type MessageRegistration = IncomingMessageInput & {
  readonly enqueueProcessing: boolean;
};

export type MessageReceipt = {
  readonly status: "registrada" | "duplicada";
  readonly messageId: string;
};

// Porta do módulo. A implementação futura deverá gravar mensagem e eventual job
// na mesma transação e reconhecer duplicatas por (provider, external_id).
// Também deverá reutilizar o contato e sua conversa aberta, preservando ciclos
// encerrados. Uma duplicata retorna o ID original sem repetir esses efeitos.
export interface IncomingMessageInbox {
  register(input: MessageRegistration): Promise<MessageReceipt>;
}
