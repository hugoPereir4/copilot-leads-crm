import { deepEqual, equal, ok, rejects } from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtemp, readFile, rm, rmdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test, type TestContext } from "node:test";
import { pathToFileURL } from "node:url";
import { loadBusinessProfile } from "../application/load-business-profile.js";
import { businessProfileSchema } from "../contracts/business-profile.js";
import { BusinessProfileFileError, JsonBusinessProfileReader } from "./json-business-profile-reader.js";

const definition: unknown = JSON.parse(await readFile(new URL("../../../../config/business-profile.json", import.meta.url), "utf8"));

async function temporaryProfile(t: TestContext) {
  const directory = await mkdtemp(join(tmpdir(), "copilot-business-profile-"));
  const file = join(directory, "profile.json");
  t.after(async () => {
    // Só remove o arquivo conhecido e o diretório criado por este cenário.
    try { await rm(file, { force: true }); } finally { await rmdir(directory); }
  });
  return { file, reader: new JsonBusinessProfileReader(pathToFileURL(file)) };
}

test("leitor padrão carrega o JSON versionado a partir da localização do módulo compilado", async () => {
  deepEqual(await loadBusinessProfile(new JsonBusinessProfileReader()), businessProfileSchema.parse(definition));
  const moduleUrl = new URL("./json-business-profile-reader.js", import.meta.url).href;
  const child = spawnSync(process.execPath, ["--input-type=module", "-e",
    `import { JsonBusinessProfileReader } from ${JSON.stringify(moduleUrl)}; await new JsonBusinessProfileReader().read(); console.log("perfil_carregado");`,
  ], { cwd: tmpdir(), encoding: "utf8" });
  equal(child.status, 0, child.stderr);
  equal(child.stdout.trim(), "perfil_carregado");
});

test("arquivo ausente rejeita com código estável sem expor caminho", async (t) => {
  const { reader } = await temporaryProfile(t);
  await rejects(reader.read(), (error: unknown) => {
    ok(error instanceof BusinessProfileFileError);
    equal(error.code, "profile_unavailable");
    equal(error.message, "Não foi possível ler a configuração do negócio.");
    equal(error.cause, undefined);
    return true;
  });
});

test("JSON malformado rejeita sem expor conteúdo ou erro nativo do parser", async (t) => {
  const { file, reader } = await temporaryProfile(t);
  await writeFile(file, '{ "conteudo_sintetico": ', "utf8");
  await rejects(reader.read(), {
    name: "BusinessProfileFileError", code: "invalid_json", message: "A configuração do negócio contém JSON inválido.",
  });
});

test("JSON incompatível com o schema rejeita sem retornar valores dos campos", async (t) => {
  const { file, reader } = await temporaryProfile(t);
  await writeFile(file, JSON.stringify({ ...businessProfileSchema.parse(definition), timezone: "Fuso/Inexistente" }), "utf8");
  await rejects(reader.read(), {
    name: "BusinessProfileFileError", code: "invalid_profile",
    message: "A configuração do negócio não corresponde ao contrato esperado.",
  });
});

test("nova leitura reflete o arquivo atual e não compartilha o resultado anterior", async (t) => {
  const { file, reader } = await temporaryProfile(t);
  const profile = businessProfileSchema.parse(definition);
  await writeFile(file, JSON.stringify(profile), "utf8");
  const first = await reader.read();
  first.name = "Alteração apenas em memória";
  deepEqual(await reader.read(), profile);
  profile.name = "Outro perfil sintético";
  await writeFile(file, JSON.stringify(profile), "utf8");
  deepEqual(await reader.read(), profile);
});
