import { z } from "zod";

// Identificadores são opacos: validamos vazio sem alterar a identidade do provedor.
const identifierSchema = z.string().refine((value) => value.trim().length > 0);
const commonFields = {
  provider: identifierSchema,
  externalId: identifierSchema,
  phone: z.string().regex(/^[+][1-9][0-9]{1,14}$/),
  receivedAt: z.date(),
};

export const normalizedMessageSchema = z.discriminatedUnion("kind", [
  z.object({
    ...commonFields,
    kind: z.literal("texto"),
    text: z.string().refine((value) => value.trim().length > 0),
  }),
  z.object({ ...commonFields, kind: z.literal("audio") }),
  z.object({ ...commonFields, kind: z.literal("outro") }),
]);

export type NormalizedMessage = z.output<typeof normalizedMessageSchema>;
