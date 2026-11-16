import { z } from "zod";
import type { HumanHandoffStore } from "./human-handoff-store.js";

export const humanHandoffLeadIdSchema = z.uuid().transform((id) => id.toLowerCase());

export async function assumeHumanAttendance(leadId: unknown, store: HumanHandoffStore) {
  const parsed = humanHandoffLeadIdSchema.safeParse(leadId);
  if (!parsed.success) return { status: "entrada_invalida" } as const;
  // O estado é autorizado somente na transação da porta, nunca por leitura prévia.
  return store.assume(parsed.data);
}
