import { deepEqual, equal, throws } from "node:assert/strict";
import { test } from "node:test";
import { DatabaseConfigurationError, readDatabaseConfig } from "./database.js";

const validEnvironment = {
  POSTGRES_DB: "copilot_leads",
  POSTGRES_USER: "copilot_dev",
  POSTGRES_PASSWORD: "senha-ficticia-de-teste",
};

test("lê a porta publicada no Windows e preserva caracteres da senha", () => {
  const password = " senha-ficticia@:/# ";
  deepEqual(readDatabaseConfig({
    ...validEnvironment,
    POSTGRES_HOST: "127.0.0.1",
    POSTGRES_PORT: "15432",
    POSTGRES_PASSWORD: password,
  }), {
    host: "127.0.0.1",
    port: 15432,
    database: "copilot_leads",
    user: "copilot_dev",
    password,
  });
});

test("usa endereço e porta locais padrão quando não informados", () => {
  const config = readDatabaseConfig(validEnvironment);
  equal(config.host, "127.0.0.1");
  equal(config.port, 5432);
});

test("rejeita porta vazia, inválida ou fora do intervalo TCP", () => {
  for (const port of ["", "abc", "0", "-1", "65536", "5432.5"]) {
    throws(() => readDatabaseConfig({ ...validEnvironment, POSTGRES_PORT: port }),
      DatabaseConfigurationError);
  }
});

test("rejeita banco, usuário ou senha ausentes antes de conectar", () => {
  for (const field of ["POSTGRES_DB", "POSTGRES_USER", "POSTGRES_PASSWORD"] as const) {
    throws(() => readDatabaseConfig({ ...validEnvironment, [field]: undefined }),
      DatabaseConfigurationError);
    throws(() => readDatabaseConfig({ ...validEnvironment, [field]: "" }),
      DatabaseConfigurationError);
  }
});

test("rejeita nomes e endereço compostos apenas por espaços", () => {
  for (const field of ["POSTGRES_DB", "POSTGRES_USER", "POSTGRES_HOST"]) {
    throws(() => readDatabaseConfig({ ...validEnvironment, [field]: "   " }),
      DatabaseConfigurationError);
  }
});

test("relata campos inválidos sem revelar a senha ou outros valores", () => {
  const privateValue = "valor-ficticio-que-nao-deve-aparecer";
  throws(() => readDatabaseConfig({
    ...validEnvironment,
    POSTGRES_PORT: privateValue,
    POSTGRES_PASSWORD: privateValue,
  }), (error: unknown) => {
    equal(error instanceof DatabaseConfigurationError, true);
    const message = (error as Error).message;
    equal(message.includes("POSTGRES_PORT"), true);
    equal(message.includes(privateValue), false);
    return true;
  });
});
