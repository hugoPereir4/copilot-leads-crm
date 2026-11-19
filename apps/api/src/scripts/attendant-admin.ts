import { createAttendant, setAttendantPassword, type AttendantInputField } from "../modules/auth/application/manage-attendants.js";
import type { AttendantStore, PasswordHasher } from "../modules/auth/application/ports.js";
import { displayNameSchema, passwordSchema, usernameSchema, type Attendant } from "../modules/auth/contracts/attendant.js";
import { AuthConfigurationError, readDemoAccessConfig, type DemoAccess } from "../config/auth.js";

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

export const demoAttendantDisplayName = "Atendente de demonstração";

export type SeedDemoResult =
  | { status: "criado" | "senha_atualizada"; attendant: Attendant }
  | { status: "entrada_invalida"; fields: AttendantInputField[] }
  | { status: "usuario_nao_demo" };

// Cria o atendente de demonstração ou, se ele já existe, troca a senha (o que também encerra as sessões dele).
// O status "duplicado" de createAttendant decide o caminho; nenhuma mensagem de erro é interpretada.
// Proteção: um usuário existente com outro nome de exibição não é o atendente de demonstração, e a senha dele não é trocada.
export async function seedDemoAttendant(input: DemoAccess, dependencies: { attendants: AttendantStore; hasher: PasswordHasher },
  retries = 1): Promise<SeedDemoResult> {
  const created = await createAttendant({ ...input, displayName: demoAttendantDisplayName }, dependencies);
  if (created.status !== "duplicado") return created;
  // "duplicado" só acontece depois de o usuário passar no usernameSchema.
  const existing = await dependencies.attendants.findByUsername(usernameSchema.parse(input.username));
  if (existing && existing.displayName !== demoAttendantDisplayName) return { status: "usuario_nao_demo" };
  const updated = await setAttendantPassword(input, dependencies);
  if (updated.status === "atualizado") return { status: "senha_atualizada", attendant: updated.attendant };
  if (updated.status === "entrada_invalida") return updated;
  // Apagado entre a criação e a troca: uma nova tentativa recria.
  if (retries > 0) return seedDemoAttendant(input, dependencies, retries - 1);
  throw new Error("O atendente de demonstração mudou durante o seed; rode o comando de novo.");
}

export type SeedDemoCommandDependencies = Omit<AttendantCommandDependencies, "readPassword">;

// npm run attendant:seed-demo: lê DEMO_USERNAME e DEMO_PASSWORD do ambiente, sem perguntar nada no terminal.
// Mensagens citam só os nomes das variáveis; a senha nunca é impressa. Devolve o código de saída.
export async function runSeedDemoCommand(environment: Readonly<Record<string, string | undefined>>, dependencies: SeedDemoCommandDependencies):
  Promise<number> {
  const { out, err } = dependencies;
  let access: DemoAccess | undefined;
  try { access = readDemoAccessConfig(environment); }
  catch (error) {
    if (!(error instanceof AuthConfigurationError)) throw error;
    err(`${error.message} DEMO_USERNAME: 3 a 32 caracteres entre a-z, 0-9, ponto, hífen e sublinhado. DEMO_PASSWORD: 12 a 128 caracteres.`);
    return 1;
  }
  if (!access) { err("Defina DEMO_USERNAME e DEMO_PASSWORD no ambiente (.env) para criar o atendente de demonstração."); return 1; }
  const result = await seedDemoAttendant(access, dependencies);
  if (result.status === "criado") { out(`Atendente de demonstração criado. id=${result.attendant.id} username=${result.attendant.username}`); return 0; }
  if (result.status === "senha_atualizada") {
    out(`Senha do atendente de demonstração atualizada e sessões encerradas. id=${result.attendant.id} username=${result.attendant.username}`);
    return 0;
  }
  if (result.status === "usuario_nao_demo") {
    err(`O usuário ${access.username} já existe e não é o atendente de demonstração; a senha não foi alterada. Use outro DEMO_USERNAME.`);
    return 1;
  }
  err("Dados do atendente de demonstração inválidos. Confira: DEMO_USERNAME, DEMO_PASSWORD.");
  return 1;
}
