import { z } from "zod";

const nonBlankIdentifier = z.string().refine((value) => value.trim().length > 0);

// Modelo de leitura interno. O banco permite body nulo inclusive para texto;
// carregar o contexto não significa aprovar a mensagem para processamento.
export const messageProcessingContextSchema = z.object({
  message: z.object({
    id: z.uuid(),
    provider: nonBlankIdentifier,
    externalId: nonBlankIdentifier,
    direction: z.enum(["entrada", "saida"]),
    senderType: z.enum(["contato", "bot", "atendente"]),
    kind: z.enum(["texto", "audio", "outro"]),
    body: z.string().nullable(),
    // Data de persistência; a data original do provedor não tem coluna própria.
    createdAt: z.date(),
  }),
  conversation: z.object({
    id: z.uuid(),
    status: z.enum([
      "aguardando_menu", "aguardando_detalhes", "qualificando",
      "aguardando_humano", "em_atendimento_humano", "encerrada",
    ]),
  }),
  contact: z.object({
    id: z.uuid(),
    phone: z.string().regex(/^[+][1-9][0-9]{1,14}$/),
    displayName: z.string().nullable(),
  }),
});

export type MessageProcessingContext = z.output<typeof messageProcessingContextSchema>;
