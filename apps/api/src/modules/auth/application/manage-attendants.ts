import { displayNameSchema, passwordSchema, usernameSchema, type Attendant } from "../contracts/attendant.js";
import type { AttendantStore, PasswordHasher } from "./ports.js";

type Dependencies = { attendants: AttendantStore; hasher: PasswordHasher };
export type AttendantInputField = "username" | "displayName" | "password";

export async function createAttendant(input: { username: string; displayName: string; password: string }, dependencies: Dependencies):
  Promise<{ status: "entrada_invalida"; fields: AttendantInputField[] } | { status: "duplicado" } | { status: "criado"; attendant: Attendant }> {
  const username = usernameSchema.safeParse(input.username);
  const displayName = displayNameSchema.safeParse(input.displayName);
  const password = passwordSchema.safeParse(input.password);
  const fields: AttendantInputField[] = [...(username.success ? [] : ["username" as const]),
    ...(displayName.success ? [] : ["displayName" as const]), ...(password.success ? [] : ["password" as const])];
  if (!username.success || !displayName.success || !password.success) return { status: "entrada_invalida", fields };
  // Falha rápida antes do hash; a unicidade do banco continua sendo a garantia.
  if (await dependencies.attendants.findByUsername(username.data)) return { status: "duplicado" };
  return dependencies.attendants.create({ username: username.data, displayName: displayName.data,
    passwordHash: await dependencies.hasher.hash(password.data) });
}

export async function setAttendantPassword(input: { username: string; password: string }, dependencies: Dependencies):
  Promise<{ status: "entrada_invalida"; fields: AttendantInputField[] } | { status: "nao_encontrado" } | { status: "atualizado"; attendant: Attendant }> {
  const username = usernameSchema.safeParse(input.username);
  const password = passwordSchema.safeParse(input.password);
  if (!username.success || !password.success) {
    return { status: "entrada_invalida", fields: [...(username.success ? [] : ["username" as const]), ...(password.success ? [] : ["password" as const])] };
  }
  if (!await dependencies.attendants.findByUsername(username.data)) return { status: "nao_encontrado" };
  return dependencies.attendants.setPasswordAndRevokeSessions(username.data, await dependencies.hasher.hash(password.data));
}
