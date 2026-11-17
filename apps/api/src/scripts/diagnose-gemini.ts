import { randomUUID } from "node:crypto";
import { GoogleGenAI } from "@google/genai";
import { readQualificationConfig } from "../config/qualification.js";
import { diagnoseGeminiError, geminiClientOptions, geminiQualificationRequest } from "../modules/leads/infrastructure/gemini-lead-qualifier.js";
import type { QualificationInput } from "../modules/leads/contracts/qualification.js";

export type GeminiDiagnosticStage = "A" | "B" | "C" | "D";
export type GeminiDiagnosticRequest = ReturnType<typeof geminiQualificationRequest>;
type BasicDiagnosticRequest = { model: string; contents: string; config: {
  maxOutputTokens: number; abortSignal: AbortSignal; responseMimeType?: string; responseJsonSchema?: unknown;
} };
export type DiagnosticRequest = BasicDiagnosticRequest | GeminiDiagnosticRequest;
export type DiagnosticTransport = { generateContent(request: DiagnosticRequest): Promise<unknown> };
export type DiagnosticResult = {
  stage: GeminiDiagnosticStage;
  model: string;
  result: "aprovado" | "falhou";
  elapsedMs: number;
  httpStatus?: number;
  providerCode?: string;
  providerField?: string;
  providerDetail?: string;
  category?: string;
};

const stageNames: Record<GeminiDiagnosticStage, string> = {
  A: "Requisição básica",
  B: "Modo JSON",
  C: "Schema mínimo",
  D: "Schema real do projeto",
};

const syntheticQualification: QualificationInput = {
  business: { name: "Clínica Fictícia", services: [{ id: "avaliacao", name: "Avaliação funcional" }] },
  previousMessages: ["Quais horários vocês têm?"],
  currentMessage: "Gostaria de agendar uma avaliação na próxima semana.",
  truncated: false,
};

export function buildGeminiDiagnosticRequest(stage: GeminiDiagnosticStage, model: string, signal: AbortSignal): DiagnosticRequest {
  if (stage === "D") return geminiQualificationRequest(syntheticQualification, model, signal);
  const request: BasicDiagnosticRequest = {
    model,
    contents: stage === "A"
      ? "Responda somente com a palavra OK."
      : stage === "B"
        ? "Responda como JSON com uma propriedade ok booleana definida como true."
        : "Responda como JSON com uma propriedade ok booleana definida como true.",
    config: { maxOutputTokens: 24, abortSignal: signal },
  };
  if (stage === "B") request.config.responseMimeType = "application/json";
  if (stage === "C") {
    request.config.responseMimeType = "application/json";
    request.config.responseJsonSchema = {
      type: "object", properties: { ok: { type: "boolean" } }, required: ["ok"], additionalProperties: false,
    };
  }
  return request;
}

export function geminiDiagnosticConfig(environment: Readonly<Record<string, string | undefined>>) {
  if (!environment.GEMINI_API_KEY?.trim()) throw new Error("missing_api_key");
  if (!environment.GEMINI_MODEL?.trim()) throw new Error("missing_model");
  return readQualificationConfig({ ...environment, QUALIFIER_PROVIDER: "gemini" });
}

export async function runGeminiDiagnostics(
  environment: Readonly<Record<string, string | undefined>>,
  createTransport: (config: ReturnType<typeof geminiDiagnosticConfig>) => DiagnosticTransport,
  report: (result: DiagnosticResult) => void,
): Promise<DiagnosticResult[]> {
  const config = geminiDiagnosticConfig(environment);
  const transport = createTransport(config);
  const results: DiagnosticResult[] = [];

  for (const stage of ["A", "B", "C", "D"] as const) {
    const startedAt = performance.now();
    const controller = new AbortController();
    try {
      await transport.generateContent(buildGeminiDiagnosticRequest(stage, config.model, controller.signal));
      const result: DiagnosticResult = { stage, model: config.model, result: "aprovado", elapsedMs: Math.round(performance.now() - startedAt) };
      results.push(result);
      report(result);
    } catch (error) {
      const diagnostic = diagnoseGeminiError(error);
      const result: DiagnosticResult = {
        stage, model: config.model, result: "falhou", elapsedMs: Math.round(performance.now() - startedAt),
        ...(diagnostic.httpStatus === undefined ? {} : { httpStatus: diagnostic.httpStatus }),
        ...(diagnostic.providerCode === undefined ? {} : { providerCode: diagnostic.providerCode }),
        ...(diagnostic.providerField === undefined ? {} : { providerField: diagnostic.providerField }),
        ...(diagnostic.providerDetail === undefined ? {} : { providerDetail: diagnostic.providerDetail }),
        category: diagnostic.category,
      };
      results.push(result);
      report(result);
      break;
    }
  }
  return results;
}

export function createGeminiDiagnosticTransport(config: ReturnType<typeof geminiDiagnosticConfig>): DiagnosticTransport {
  // Importing the same SDK client/options as production preserves API version, auth, timeout and retry behavior.
  const client = new GoogleGenAI(geminiClientOptions(config));
  return { generateContent: (request) => client.models.generateContent(request as Parameters<typeof client.models.generateContent>[0]) };
}

export async function runManualGeminiDiagnostic(
  environment: Readonly<Record<string, string | undefined>>,
  confirm: () => Promise<boolean>,
  report: (line: string) => void,
  createTransport = createGeminiDiagnosticTransport,
): Promise<boolean> {
  report("Aviso: este diagnóstico pode realizar até 4 requisições reais ao Gemini e consumir sua cota gratuita.");
  report("Serão enviados somente textos sintéticos. Nenhuma resposta ou prompt será exibido nos logs.");
  if (!await confirm()) { report("Diagnóstico cancelado; nenhuma requisição foi enviada."); return false; }
  let results: DiagnosticResult[];
  try {
    results = await runGeminiDiagnostics(environment, createTransport, (result) => {
      report(JSON.stringify({ stage: result.stage, name: stageNames[result.stage], model: result.model,
        result: result.result, elapsedMs: result.elapsedMs,
        ...(result.httpStatus === undefined ? {} : { httpStatus: result.httpStatus }),
        ...(result.providerCode === undefined ? {} : { providerCode: result.providerCode }),
        ...(result.providerField === undefined ? {} : { providerField: result.providerField }),
        ...(result.providerDetail === undefined ? {} : { providerDetail: result.providerDetail }),
        ...(result.category === undefined ? {} : { category: result.category }) }));
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "";
    const category = message === "missing_api_key" ? "missing_api_key"
      : message === "missing_model" ? "missing_model" : "configuration_error";
    report(JSON.stringify({ result: "falhou", category, diagnosticId: randomUUID() }));
    return false;
  }
  return results.every((result) => result.result === "aprovado");
}
