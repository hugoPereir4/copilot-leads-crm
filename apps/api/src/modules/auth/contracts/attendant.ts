import { z } from "zod";

// Mesmo formato do CHECK da migração; trim e minúsculas antes de validar.
export const usernameSchema = z.string().trim().toLowerCase().regex(/^[a-z0-9._-]{3,32}$/);
export const displayNameSchema = z.string().trim().min(1).max(80);
// A senha não é normalizada: espaços fazem parte dela.
export const passwordSchema = z.string().min(12).max(128);

// Corpo do login: só a forma. Formato do usuário e tamanho da senha não viram 400,
// para que qualquer credencial errada receba a mesma resposta (invalid_credentials).
export const loginRequestSchema = z.strictObject({
  username: z.string().max(256),
  password: z.string().max(1024),
});

export type Attendant = { id: string; username: string; displayName: string };
