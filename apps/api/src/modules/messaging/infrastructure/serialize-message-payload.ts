import { z } from "zod";

const jsonPayloadSchema = z.json();

export class MessagePayloadSerializationError extends Error {
  constructor() {
    super("O payload original da mensagem deve conter apenas valores JSON válidos.");
    this.name = "MessagePayloadSerializationError";
  }
}

export function serializeMessagePayload(payload: unknown): string {
  try {
    // Valida antes de serializar: undefined e números não finitos não devem
    // desaparecer nem virar null silenciosamente no original armazenado.
    const value = jsonPayloadSchema.parse(payload);
    const serialized = JSON.stringify(value);
    if (serialized === undefined) throw new MessagePayloadSerializationError();
    return serialized;
  } catch {
    // Não inclui conteúdo do payload ou detalhes da validação no erro.
    throw new MessagePayloadSerializationError();
  }
}
