import { createAttendant, setAttendantPassword } from "../modules/auth/application/manage-attendants.js";
import type { AttendantStore, PasswordHasher } from "../modules/auth/application/ports.js";
import { displayNameSchema, passwordSchema, usernameSchema } from "../modules/auth/contracts/attendant.js";

export type AttendantCommandDependencies = {
  attendants: AttendantStore;
  hasher: PasswordHasher;
  // Leitura sem eco no terminal; nunca por argumento ou variável de ambiente.
  readPassword(prompt: string): Promise<string>;
  out(line: string): void;
  err(line: string): void;
};

const usage = [
  "Uso:",
  "  npm run attendant:create -- <usuario> \"<nome de exibição>\"",
  "  npm run attendant:set-password -- <usuario>",
].join("\n");

async function askPassword(dependencies: AttendantCommandDependencies) {
  const password = await dependencies.readPassword("Senha (12 a 128 caracteres): ");
  const confirmation = await dependencies.readPassword("Confirme a senha: ");
  if (password !== confirmation) { dependencies.err("As senhas não conferem."); return undefined; }
  if (!passwordSchema.safeParse(password).success) { dependencies.err("A senha deve ter de 12 a 128 caracteres."); return undefined; }
  return password;
}

// Saída só com id e username; senha e hash nunca são impressos. Devolve o código de saída.
export async function runAttendantCommand(args: readonly string[], dependencies: AttendantCommandDependencies): Promise<number> {
  const [command, ...rest] = args;
  const { attendants, hasher, out, err } = dependencies;
  if (command === "create" && rest.length === 2) {
    const username = usernameSchema.safeParse(rest[0]);
    if (!username.success) { err("Usuário inválido: use de 3 a 32 caracteres entre a-z, 0-9, ponto, hífen e sublinhado."); return 1; }
    if (!displayNameSchema.safeParse(rest[1]).success) { err("Nome de exibição inválido: use de 1 a 80 caracteres."); return 1; }
    if (await attendants.findByUsername(username.data)) { err(`O usuário ${username.data} já existe.`); return 1; }
    const password = await askPassword(dependencies); if (password === undefined) return 1;
    const result = await createAttendant({ username: username.data, displayName: rest[1]!, password }, { attendants, hasher });
    if (result.status === "duplicado") { err(`O usuário ${username.data} já existe.`); return 1; }
    if (result.status === "entrada_invalida") { err("Dados do atendente inválidos."); return 1; }
    out(`Atendente criado. id=${result.attendant.id} username=${result.attendant.username}`);
    return 0;
  }
  if (command === "set-password" && rest.length === 1) {
    const username = usernameSchema.safeParse(rest[0]);
    if (!username.success) { err("Usuário inválido: use de 3 a 32 caracteres entre a-z, 0-9, ponto, hífen e sublinhado."); return 1; }
    if (!await attendants.findByUsername(username.data)) { err(`O usuário ${username.data} não foi encontrado.`); return 1; }
    const password = await askPassword(dependencies); if (password === undefined) return 1;
    const result = await setAttendantPassword({ username: username.data, password }, { attendants, hasher });
    if (result.status === "nao_encontrado") { err(`O usuário ${username.data} não foi encontrado.`); return 1; }
    if (result.status === "entrada_invalida") { err("Dados do atendente inválidos."); return 1; }
    out(`Senha alterada e sessões encerradas. id=${result.attendant.id} username=${result.attendant.username}`);
    return 0;
  }
  err(usage);
  return 1;
}
