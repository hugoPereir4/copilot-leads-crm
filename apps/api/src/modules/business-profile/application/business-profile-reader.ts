import type { BusinessProfile } from "../contracts/business-profile.js";

// Disponibiliza o único perfil configurado da V1, validado em runtime.
// Ausência, indisponibilidade ou configuração inválida devem rejeitar a Promise;
// não há fallback silencioso para dados de demonstração ou perfil vazio.
export interface BusinessProfileReader {
  read(): Promise<BusinessProfile>;
}
