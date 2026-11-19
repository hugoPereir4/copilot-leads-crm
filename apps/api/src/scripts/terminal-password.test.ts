import { deepEqual, equal, ok, rejects } from "node:assert/strict";
import { PassThrough } from "node:stream";
import { test } from "node:test";
import { createPasswordReader, PasswordInputCancelled, type PasswordInput } from "./terminal-password.js";

function terminal(tty: boolean) {
  const input = new PassThrough() as PassThrough & PasswordInput;
  const rawModes: boolean[] = [];
  if (tty) { input.isTTY = true; input.isRaw = false; input.setRawMode = (mode: boolean) => { rawModes.push(mode); input.isRaw = mode; }; }
  let written = ""; let interrupted = 0;
  const read = createPasswordReader(input, { write: (text: string) => { written += text; } }, () => { interrupted++; });
  return { input, read, rawModes, output: () => written, interrupted: () => interrupted };
}
const tick = () => new Promise((resolve) => setImmediate(resolve));

test("TTY mostra um asterisco por caractere, trata Backspace e restaura o modo raw", async () => {
  const t = terminal(true);
  const first = t.read("Senha: "); t.input.write("ab\x7fcé\b\bd\r");
  equal(await first, "ad");
  equal(t.output(), "Senha: **\b \b**\b \b\b \b*\n");
  deepEqual(t.rawModes, [true, false]);
});

test("\\r\\n conta como um Enter mesmo quando o \\n chega em outro bloco", async () => {
  const t = terminal(true);
  const first = t.read("Senha: "); t.input.write("senha-sintetica\r");
  equal(await first, "senha-sintetica");
  const second = t.read("Confirme: "); t.input.write("\nsenha-sintetica\r\n");
  equal(await second, "senha-sintetica");
  ok(!t.output().includes("senha-sintetica"));
});

test("fora de TTY lê linhas sem eco e guarda o que chegou depois do Enter", async () => {
  const t = terminal(false);
  t.input.write("primeira-linha\r\nsegunda-linha\n");
  equal(await t.read("Senha: "), "primeira-linha");
  equal(await t.read("Confirme: "), "segunda-linha");
  equal(t.output(), "Senha: \nConfirme: \n");
  const ended = terminal(false); ended.input.end("sem-enter");
  equal(await ended.read("Senha: "), "sem-enter");
  await rejects(ended.read("Confirme: "), PasswordInputCancelled);
});

test("Ctrl+C restaura o terminal, chama a interrupção e não devolve a senha", async () => {
  const t = terminal(true);
  const reading = t.read("Senha: "); t.input.write("parcial\x03resto\r");
  await rejects(reading, PasswordInputCancelled);
  equal(t.interrupted(), 1); deepEqual(t.rawModes, [true, false]);
  ok(!t.output().includes("parcial"));
});

test("sequências de escape (setas) e outros controles são ignorados", async () => {
  const t = terminal(true);
  const reading = t.read("Senha: "); t.input.write("a\x1b[Db\x1b[C\tc"); await tick(); t.input.write("\n");
  equal(await reading, "abc");
});
