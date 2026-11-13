import { readFile } from "node:fs/promises";
import type { BusinessProfileReader } from "../application/business-profile-reader.js";
import { businessProfileSchema, type BusinessProfile } from "../contracts/business-profile.js";

type ProfileFileErrorCode = "profile_unavailable" | "invalid_json" | "invalid_profile";
const errorMessages = {
  profile_unavailable: "Não foi possível ler a configuração do negócio.",
  invalid_json: "A configuração do negócio contém JSON inválido.",
  invalid_profile: "A configuração do negócio não corresponde ao contrato esperado.",
};

export class BusinessProfileFileError extends Error {
  constructor(readonly code: ProfileFileErrorCode) {
    super(errorMessages[code]);
    this.name = "BusinessProfileFileError";
  }
}

export class JsonBusinessProfileReader implements BusinessProfileReader {
  constructor(private readonly file: URL = new URL("../../../../config/business-profile.json", import.meta.url)) {}

  async read(): Promise<BusinessProfile> {
    let content: string;
    try { content = await readFile(this.file, "utf8"); }
    catch { throw new BusinessProfileFileError("profile_unavailable"); }
    let input: unknown;
    try { input = JSON.parse(content); }
    catch { throw new BusinessProfileFileError("invalid_json"); }
    const parsed = businessProfileSchema.safeParse(input);
    if (!parsed.success) throw new BusinessProfileFileError("invalid_profile");
    return parsed.data;
  }
}
