import { deepEqual, equal, ok, match, rejects } from "node:assert/strict";
import { test } from "node:test";
import { readQualificationConfig } from "../config/qualification.js";
import { geminiResponseJsonSchema } from "../modules/leads/infrastructure/gemini-lead-qualifier.js";
import { buildGeminiDiagnosticRequest, geminiDiagnosticConfig, runGeminiDiagnostics, runManualGeminiDiagnostic,
  type DiagnosticRequest } from "./diagnose-gemini.js";

const environment = { GEMINI_API_KEY: "SYNTHETIC_API_KEY_DO_NOT_LOG", GEMINI_MODEL: "gemini-3.1-flash-lite" };

test("as quatro etapas usam progressivamente JSON e o schema real de produção", () => {
  const signal = new AbortController().signal;
  const basic = buildGeminiDiagnosticRequest("A", environment.GEMINI_MODEL, signal);
  const json = buildGeminiDiagnosticRequest("B", environment.GEMINI_MODEL, signal);
  const minimal = buildGeminiDiagnosticRequest("C", environment.GEMINI_MODEL, signal);
  const real = buildGeminiDiagnosticRequest("D", environment.GEMINI_MODEL, signal);
  for (const request of [basic, json, minimal, real]) {
    equal(request.model, environment.GEMINI_MODEL);
    equal(request.config.abortSignal, signal);
    ok(!JSON.stringify(request).includes(environment.GEMINI_API_KEY));
  }
  equal("responseMimeType" in basic.config, false);
  equal("responseJsonSchema" in basic.config, false);
  equal(json.config.responseMimeType, "application/json");
  equal("responseJsonSchema" in json.config, false);
  equal(minimal.config.responseMimeType, "application/json");
  deepEqual(minimal.config.responseJsonSchema, {
    type: "object", properties: { ok: { type: "boolean" } }, required: ["ok"], additionalProperties: false,
  });
  equal(real.config.responseMimeType, "application/json");
  equal(real.config.maxOutputTokens, 768);
  deepEqual(real.config.responseJsonSchema, geminiResponseJsonSchema());
  ok(real.contents.includes("Clínica Fictícia"));
});

test("configuração de diagnóstico exige chave e modelo antes de criar qualquer transporte", async () => {
  equal(geminiDiagnosticConfig(environment).model, readQualificationConfig({ ...environment, QUALIFIER_PROVIDER: "gemini" }).model);
  let calls = 0, transports = 0;
  const create = async (env: Record<string, string | undefined>) => runGeminiDiagnostics(env, () => {
    transports++;
    return { async generateContent() { calls++; return {}; } };
  }, () => {});
  await rejects(create({ GEMINI_MODEL: environment.GEMINI_MODEL }), /missing_api_key/);
  await rejects(create({ GEMINI_API_KEY: environment.GEMINI_API_KEY }), /missing_model/);
  equal(transports, 0); equal(calls, 0);
});

test("requisições são sequenciais e a primeira falha interrompe as etapas seguintes", async () => {
  const stages: string[] = [];
  const reports: unknown[] = [];
  const results = await runGeminiDiagnostics(environment, () => ({ async generateContent(request: DiagnosticRequest) {
    const current = stages.length;
    stages.push(request.config.responseJsonSchema ? "schema" : request.config.responseMimeType ? "json" : "basic");
    if (current === 2) throw { name: "ApiError", status: 400, message: JSON.stringify({ error: {
      status: "INVALID_ARGUMENT", details: [{ fieldViolations: [{ field: "generation_config.response_schema.properties[0].value.enum",
        description: "Unsupported enum schema" }] }],
    } }) };
    return { text: "NEVER_LOG_MODEL_OUTPUT" };
  } }), (result) => reports.push(result));
  deepEqual(stages, ["basic", "json", "schema"]);
  equal(results.length, 3); equal(results[0]?.result, "aprovado"); equal(results[2]?.result, "falhou");
  equal(results[2]?.httpStatus, 400); equal(results[2]?.providerCode, "INVALID_ARGUMENT");
  equal(results[2]?.providerField, "generation_config.response_schema.properties[0].value.enum");
  equal(results[2]?.providerDetail, "unsupported_schema_field");
  ok(!JSON.stringify(reports).includes("NEVER_LOG_MODEL_OUTPUT"));
  ok(!JSON.stringify(reports).includes(environment.GEMINI_API_KEY));
});

test("diagnóstico real exige confirmação explícita, sanitiza dados e nunca relata conteúdo", async () => {
  const reports: string[] = [];
  let requests = 0;
  const canceled = await runManualGeminiDiagnostic(environment, async () => false, (line) => reports.push(line), () => {
    throw new Error("transport must not be created before confirmation");
  });
  equal(canceled, false); equal(reports.length, 3);
  match(reports[0]!, /até 4 requisições reais/);
  const failedReports: string[] = [];
  const success = await runManualGeminiDiagnostic(environment, async () => true, (line) => failedReports.push(line),
    () => ({ async generateContent() {
      requests++;
      throw { status: 400, message: JSON.stringify({ error: { status: "INVALID_ARGUMENT", message: "SYNTHETIC_PRIVATE_TEXT" } }) };
    } }));
  equal(success, false); equal(requests, 1);
  ok(!failedReports.join("\n").includes("SYNTHETIC_PRIVATE_TEXT"));
  ok(!failedReports.join("\n").includes(environment.GEMINI_API_KEY));
});

test("falha de configuração informa o motivo sem expor a chave", async () => {
  const reports: string[] = [];
  const success = await runManualGeminiDiagnostic({ ...environment, QUALIFIER_TIMEOUT_MS: "8000" }, async () => true,
    (line) => reports.push(line), () => { throw new Error("transport must not be created with invalid configuration"); });
  equal(success, false);
  const result = JSON.parse(reports.at(-1)!) as { category?: string; reason?: string };
  equal(result.category, "configuration_error"); match(result.reason ?? "", /QUALIFIER_TIMEOUT_MS/);
  ok(!reports.join("\n").includes(environment.GEMINI_API_KEY));
  const other: string[] = [];
  await runManualGeminiDiagnostic(environment, async () => true, (line) => other.push(line),
    () => { throw new Error(`falha privada ${environment.GEMINI_API_KEY}`); });
  const generic = JSON.parse(other.at(-1)!) as Record<string, unknown>;
  equal(generic.category, "configuration_error"); equal("reason" in generic, false);
  ok(!other.join("\n").includes(environment.GEMINI_API_KEY));
});
