import { deepEqual, equal, ok } from "node:assert/strict";
import { test } from "node:test";
import type { AttendantStore, PasswordHasher, StoredAttendant } from "../modules/auth/application/ports.js";
import { runAttendantCommand } from "./attendant-admin.js";

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
  return { run, stored, out, err, prompts, revoked: () => revoked };
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
