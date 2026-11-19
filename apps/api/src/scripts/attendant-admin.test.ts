import { deepEqual, equal, ok } from "node:assert/strict";
import { test } from "node:test";
import type { AttendantStore, PasswordHasher, StoredAttendant } from "../modules/auth/application/ports.js";
import { demoAttendantDisplayName, runAttendantCommand, runSeedDemoCommand, seedDemoAttendant } from "./attendant-admin.js";

const secret = "senha-sintetica-12";

function harness(passwords: string[]) {
  const stored = new Map<string, StoredAttendant>(); const out: string[] = [], err: string[] = [], prompts: string[] = [];
  let revoked = 0;
  const attendants: AttendantStore = {
    async findByUsername(username) { return stored.get(username); },
    async create(input) {
      if (stored.has(input.username)) return { status: "duplicado" };
      const attendant = { id: "00000000-0000-4000-8000-000000000001", username: input.username, displayName: input.displayName };
      stored.set(input.username, { ...attendant, passwordHash: input.passwordHash }); return { status: "criado", attendant };
    },
    async setPasswordAndRevokeSessions(username, passwordHash) {
      const item = stored.get(username); if (!item) return { status: "nao_encontrado" };
      stored.set(username, { ...item, passwordHash }); revoked++;
      return { status: "atualizado", attendant: { id: item.id, username: item.username, displayName: item.displayName } };
    },
  };
  const hasher: PasswordHasher = { async hash(password) { return `hash-de-${password.length}`; }, async verify() { return false; } };
  const run = (args: string[]) => runAttendantCommand(args, { attendants, hasher, out: (line) => out.push(line), err: (line) => err.push(line),
    async readPassword(prompt) { prompts.push(prompt); const next = passwords.shift(); ok(next !== undefined, "leitura inesperada"); return next; } });
  const seed = (environment: Record<string, string | undefined>) => runSeedDemoCommand(environment,
    { attendants, hasher, out: (line) => out.push(line), err: (line) => err.push(line) });
  return { run, seed, attendants, hasher, stored, out, err, prompts, revoked: () => revoked };
}

test("create pede a senha duas vezes e imprime só id e username", async () => {
  const cli = harness([secret, secret]);
  equal(await cli.run(["create", " Hugo ", "Hugo Pereira"]), 0);
  equal(cli.prompts.length, 2); deepEqual(cli.err, []);
  deepEqual(cli.out, ["Atendente criado. id=00000000-0000-4000-8000-000000000001 username=hugo"]);
  equal(cli.stored.get("hugo")?.displayName, "Hugo Pereira");
  ok(![...cli.out, ...cli.err].join("\n").includes(secret)); ok(!cli.out.join("\n").includes("hash-de"));
});

test("senhas diferentes e tamanho inválido falham sem criar o atendente", async () => {
  for (const [passwords, message] of [[[secret, `${secret}x`], "As senhas não conferem."], [["curta", "curta"], "A senha deve ter de 12 a 128 caracteres."],
    [["x".repeat(129), "x".repeat(129)], "A senha deve ter de 12 a 128 caracteres."]] as const) {
    const cli = harness([...passwords]);
    equal(await cli.run(["create", "hugo", "Hugo"]), 1); deepEqual(cli.err, [message]); equal(cli.stored.size, 0);
    ok(!cli.err.join("").includes(passwords[0]));
  }
});

test("usuário duplicado falha antes de pedir senha; set-password exige usuário existente e revoga sessões", async () => {
  const cli = harness([secret, secret]);
  equal(await cli.run(["create", "hugo", "Hugo"]), 0);
  equal(await cli.run(["create", "HUGO", "Outro"]), 1); deepEqual(cli.err, ["O usuário hugo já existe."]); equal(cli.prompts.length, 2);
  equal(await cli.run(["set-password", "ninguem"]), 1); equal(cli.err.at(-1), "O usuário ninguem não foi encontrado.");
  const replaced = harness(["nova-senha-sintetica", "nova-senha-sintetica"]);
  replaced.stored.set("hugo", { id: "00000000-0000-4000-8000-000000000002", username: "hugo", displayName: "Hugo", passwordHash: "antigo" });
  equal(await replaced.run(["set-password", "hugo"]), 0); equal(replaced.revoked(), 1);
  deepEqual(replaced.out, ["Senha alterada e sessões encerradas. id=00000000-0000-4000-8000-000000000002 username=hugo"]);
  equal(replaced.stored.get("hugo")?.passwordHash, "hash-de-20");
});

test("argumentos ausentes, extras ou inválidos mostram o uso sem pedir senha", async () => {
  for (const args of [[], ["create"], ["create", "hugo"], ["create", "hugo", "Hugo", "extra"], ["set-password"], ["remover", "hugo"]]) {
    const cli = harness([]); equal(await cli.run(args), 1); ok(cli.err[0]?.startsWith("Uso:")); equal(cli.prompts.length, 0);
  }
  for (const args of [["create", "x", "Hugo"], ["create", "hugo", "   "], ["set-password", "com espaço"]]) {
    const cli = harness([]); equal(await cli.run(args), 1); ok(cli.err[0]?.includes("inválido")); equal(cli.prompts.length, 0);
  }
});

const demoSecret = "senha-demo-sintetica";

test("seed-demo cria o atendente de demonstração quando ele não existe, sem perguntar nem imprimir a senha", async () => {
  const cli = harness([]);
  equal(await cli.seed({ DEMO_USERNAME: " Demo ", DEMO_PASSWORD: demoSecret }), 0);
  deepEqual(cli.prompts, []); deepEqual(cli.err, []);
  deepEqual(cli.out, ["Atendente de demonstração criado. id=00000000-0000-4000-8000-000000000001 username=demo"]);
  deepEqual(cli.stored.get("demo"), { id: "00000000-0000-4000-8000-000000000001", username: "demo", displayName: demoAttendantDisplayName,
    passwordHash: `hash-de-${demoSecret.length}` });
  equal(cli.revoked(), 0); ok(!cli.out.join("\n").includes(demoSecret));
});

test("seed-demo troca a senha e encerra as sessões quando o atendente de demonstração já existe", async () => {
  const cli = harness([]);
  equal(await cli.seed({ DEMO_USERNAME: "demo", DEMO_PASSWORD: demoSecret }), 0);
  const newSecret = "outra-senha-demo-sintetica";
  equal(await cli.seed({ DEMO_USERNAME: "demo", DEMO_PASSWORD: newSecret }), 0);
  equal(cli.stored.get("demo")?.passwordHash, `hash-de-${newSecret.length}`); equal(cli.revoked(), 1);
  equal(cli.out[1], "Senha do atendente de demonstração atualizada e sessões encerradas. id=00000000-0000-4000-8000-000000000001 username=demo");
  ok(![...cli.out, ...cli.err].join("\n").includes(newSecret)); equal(cli.stored.size, 1);
  deepEqual(await seedDemoAttendant({ username: "demo", password: newSecret }, cli), { status: "senha_atualizada",
    attendant: { id: "00000000-0000-4000-8000-000000000001", username: "demo", displayName: demoAttendantDisplayName } });
});

test("seed-demo recusa senha curta e não troca a senha de um atendente real com o mesmo usuário", async () => {
  const cli = harness([]);
  equal(await cli.seed({ DEMO_USERNAME: "demo", DEMO_PASSWORD: "curta-demo" }), 1);
  equal(cli.stored.size, 0); ok(cli.err[0]?.includes("DEMO_PASSWORD")); ok(!cli.err.join("\n").includes("curta-demo"));
  deepEqual(await seedDemoAttendant({ username: "demo", password: "curta-demo" }, cli), { status: "entrada_invalida", fields: ["password"] });
  // Um atendente real com o mesmo usuário não tem a senha trocada.
  cli.stored.set("hugo", { id: "real", username: "hugo", displayName: "Hugo", passwordHash: "hash-real" });
  equal(await cli.seed({ DEMO_USERNAME: "hugo", DEMO_PASSWORD: demoSecret }), 1);
  equal(cli.stored.get("hugo")?.passwordHash, "hash-real"); equal(cli.revoked(), 0);
  ok(cli.err.at(-1)?.includes("não é o atendente de demonstração")); ok(!cli.err.join("\n").includes(demoSecret));
});

test("seed-demo sai com erro sem vazar valores quando faltam variáveis", async () => {
  for (const [environment, names] of [[{}, ["DEMO_USERNAME", "DEMO_PASSWORD"]], [{ DEMO_USERNAME: "demo" }, ["DEMO_PASSWORD"]],
    [{ DEMO_PASSWORD: demoSecret }, ["DEMO_USERNAME"]], [{ DEMO_USERNAME: "", DEMO_PASSWORD: "" }, ["DEMO_USERNAME", "DEMO_PASSWORD"]]] as const) {
    const cli = harness([]);
    equal(await cli.seed(environment), 1);
    deepEqual(cli.out, []); equal(cli.err.length, 1); equal(cli.stored.size, 0); deepEqual(cli.prompts, []);
    for (const name of names) ok(cli.err[0]!.includes(name));
    ok(!cli.err[0]!.includes(demoSecret));
  }
});
