import { z } from "zod";

export const profileNameMaxLength = 80;

// Identificadores são opacos: validamos vazio sem alterar a identidade do provedor.
const identifierSchema = z.string().refine((value) => value.trim().length > 0);
const commonFields = {
  provider: identifierSchema,
  externalId: identifierSchema,
  phone: z.string().regex(/^[+][1-9][0-9]{1,14}$/),
  receivedAt: z.date(),
  // Nome de perfil informado pelo provedor: já aparado, não vazio, até 80 caracteres (code points).
  // Dado pessoal: identifica o lead no painel e nunca é enviado à IA.
  profileName: z.string().refine((value) => value.trim() === value && value.length > 0 && [...value].length <= profileNameMaxLength).optional(),
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
