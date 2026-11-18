import { randomBytes, scrypt, timingSafeEqual, type ScryptOptions } from "node:crypto";
import type { PasswordHasher } from "../application/ports.js";

export type ScryptParameters = { logN: number; r: number; p: number; maxmem: number };

// N = 2^17, r = 8, p = 1: cerca de 128 MiB por derivação (128 · N · r bytes).
export const productionScryptParameters: ScryptParameters = { logN: 17, r: 8, p: 1, maxmem: 256 * 1024 * 1024 };

const saltBytes = 16;
const keyBytes = 32;
const base64url = /^[A-Za-z0-9_-]+$/;

function derive(password: string, salt: Buffer, parameters: ScryptParameters) {
  const options: ScryptOptions = { N: 2 ** parameters.logN, r: parameters.r, p: parameters.p, maxmem: parameters.maxmem };
  return new Promise<Buffer>((resolve, reject) => {
    scrypt(password, salt, keyBytes, options, (error, key) => { if (error) reject(error); else resolve(key); });
  });
}

function decode(value: string | undefined, bytes: number) {
  if (value === undefined || !base64url.test(value)) return undefined;
  const decoded = Buffer.from(value, "base64url");
  // Recodificar recusa variantes não canônicas do mesmo conteúdo.
  return decoded.length === bytes && decoded.toString("base64url") === value ? decoded : undefined;
}

// Formato: scrypt$<logN>$<r>$<p>$<salt base64url>$<hash base64url>.
export class ScryptPasswordHasher implements PasswordHasher {
  private readonly prefix: string;

  constructor(private readonly parameters: ScryptParameters = productionScryptParameters) {
    this.prefix = `scrypt$${parameters.logN}$${parameters.r}$${parameters.p}`;
  }

  async hash(password: string) {
    const salt = randomBytes(saltBytes);
    const key = await derive(password, salt, this.parameters);
    return `${this.prefix}$${salt.toString("base64url")}$${key.toString("base64url")}`;
  }

  async verify(password: string, encodedHash: string) {
    try {
      const parts = encodedHash.split("$");
      // Só os parâmetros com que este hasher foi construído; qualquer outro formato é falso.
      if (parts.length !== 6 || parts.slice(0, 4).join("$") !== this.prefix) return false;
      const salt = decode(parts[4], saltBytes), expected = decode(parts[5], keyBytes);
      if (!salt || !expected) return false;
      return timingSafeEqual(await derive(password, salt, this.parameters), expected);
    } catch { return false; }
  }
}
