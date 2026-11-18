import { equal, match, notEqual, ok } from "node:assert/strict";
import { test } from "node:test";
import { productionScryptParameters, ScryptPasswordHasher } from "./scrypt-password-hasher.js";
import { sessionTokens } from "./session-tokens.js";

// Custo baixo só nos testes; a produção usa N = 2^17.
const hasher = new ScryptPasswordHasher({ logN: 10, r: 8, p: 1, maxmem: 32 * 1024 * 1024 });
const password = "senha sintetica longa";

test("hasher scrypt usa o formato com parâmetros e confere senha certa e errada", async () => {
  const encoded = await hasher.hash(password);
  match(encoded, /^scrypt\$10\$8\$1\$[A-Za-z0-9_-]{22}\$[A-Za-z0-9_-]{43}$/);
  ok(!encoded.includes(password));
  equal(await hasher.verify(password, encoded), true);
  equal(await hasher.verify(`${password}!`, encoded), false);
  equal(await hasher.verify("", encoded), false);
  match(new ScryptPasswordHasher()["prefix" as never] as string, /^scrypt\$17\$8\$1$/);
  equal(productionScryptParameters.maxmem, 256 * 1024 * 1024);
});

test("salts diferentes geram hashes diferentes para a mesma senha", async () => {
  const [first, second] = await Promise.all([hasher.hash(password), hasher.hash(password)]);
  notEqual(first, second); notEqual(first.split("$")[4], second.split("$")[4]);
  equal(await hasher.verify(password, first), true); equal(await hasher.verify(password, second), true);
});

test("formato ou parâmetros estranhos devolvem false sem lançar", async () => {
  const encoded = await hasher.hash(password);
  const [, , , , salt, key] = encoded.split("$");
  const other = await new ScryptPasswordHasher({ logN: 11, r: 8, p: 1, maxmem: 32 * 1024 * 1024 }).hash(password);
  for (const candidate of ["", "texto", other, `bcrypt$10$8$1$${salt}$${key}`, `scrypt$10$8$2$${salt}$${key}`,
    `scrypt$10$8$1$${salt}`, `scrypt$10$8$1$${salt}$${key}$extra`, `scrypt$10$8$1$${salt}$${key!.slice(1)}`,
    `scrypt$10$8$1$${salt}$${key}=`, `scrypt$10$8$1$***$${key}`, `scrypt$10$8$1$${salt}$${"A".repeat(43)}`]) {
    equal(await hasher.verify(password, candidate), false, candidate);
  }
  // Parâmetro acima de maxmem faria o scrypt lançar; o verify continua devolvendo false.
  const greedy = new ScryptPasswordHasher({ logN: 20, r: 8, p: 1, maxmem: 1024 });
  equal(await greedy.verify(password, `scrypt$20$8$1$${salt}$${key}`), false);
});

test("token de sessão tem 32 bytes em base64url e só tokens bem formados viram digest", () => {
  const token = sessionTokens.issue();
  match(token, /^[A-Za-z0-9_-]{43}$/); notEqual(token, sessionTokens.issue());
  const digest = sessionTokens.digest(token); ok(digest); equal(digest.length, 32);
  equal(sessionTokens.digest(token)!.equals(digest), true);
  for (const invalid of ["", "curto", `${token}x`, `${token.slice(0, 42)}*`, `${token.slice(0, 42)}=`]) {
    equal(sessionTokens.digest(invalid), undefined);
  }
});
