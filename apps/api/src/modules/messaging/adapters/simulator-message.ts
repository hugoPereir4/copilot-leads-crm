import { z } from "zod";
import type { NormalizedMessage } from "../contracts/normalized-message.js";

const envelopeSchema = z.object({ fromMe: z.boolean() });
const commonFields = {
  id: z.string().refine((value) => value.trim().length > 0),
  from: z.string().regex(/^[+][1-9][0-9]{1,14}$/),
  fromMe: z.literal(false),
  timestamp: z.iso.datetime({ offset: true }).transform((value) => new Date(value)).pipe(z.date()),
};
const incomingSchema = z.discriminatedUnion("type", [
  z.object({ ...commonFields, type: z.literal("text"), body: z.string().refine((value) => value.trim().length > 0) }),
  z.object({ ...commonFields, type: z.literal("audio") }),
  z.object({ ...commonFields, type: z.literal("other") }),
]);

export type SimulatorMessageResult =
  | { status: "invalida"; fields: readonly string[] }
  | { status: "ignorada"; reason: "mensagem_propria" }
  | { status: "normalizada"; message: NormalizedMessage };

function invalidFields(error: z.ZodError): SimulatorMessageResult {
  return { status: "invalida", fields: [...new Set(error.issues.map((issue) => issue.path.join(".") || "message"))] };
}

export function adaptSimulatorMessage(payload: unknown): SimulatorMessageResult {
  const envelope = envelopeSchema.safeParse(payload);
  if (!envelope.success) return invalidFields(envelope.error);
  // Ecos de envio não entram no fluxo de recepção nem exigem texto ou remetente.
  if (envelope.data.fromMe) return { status: "ignorada", reason: "mensagem_propria" };

  const result = incomingSchema.safeParse(payload);
  if (!result.success) return invalidFields(result.error);
  const input = result.data;
  const common = { provider: "simulador", externalId: input.id, phone: input.from, receivedAt: input.timestamp };
  if (input.type === "text") {
    return { status: "normalizada", message: { ...common, kind: "texto", text: input.body } };
  }
  return { status: "normalizada", message: { ...common, kind: input.type === "audio" ? "audio" : "outro" } };
}
