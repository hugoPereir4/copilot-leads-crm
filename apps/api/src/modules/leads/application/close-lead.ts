import { z } from "zod";
import type { LeadClosureStore } from "./lead-closure-store.js";

export const leadClosureBodySchema = z.strictObject({ result: z.enum(["ganho", "perdido"]) });
export const leadClosureCommandSchema = leadClosureBodySchema.extend({ leadId: z.uuid().transform((id) => id.toLowerCase()) });

export async function closeLead(leadId: unknown, body: unknown, store: LeadClosureStore) {
  const payload = leadClosureBodySchema.safeParse(body);
  if (!payload.success) return { status: "entrada_invalida" } as const;
  const command = leadClosureCommandSchema.safeParse({ leadId, ...payload.data });
  if (!command.success) return { status: "entrada_invalida" } as const;
  return store.close(command.data);
}
