// O contador identifica a tentativa reservada e nunca é zerado neste fluxo.
export type JobAttempt = {
  readonly id: string;
  readonly attempts: number;
};

export type JobFailureKind = "transitoria" | "definitiva";

export type JobFailureDecision =
  | { readonly retry: true; readonly delaySeconds: number }
  | { readonly retry: false };

export type JobCompletionResult =
  | { readonly status: "concluido" }
  | { readonly status: "reserva_desatualizada" };

export type JobFailureResult =
  | { readonly status: "pendente"; readonly runAt: Date }
  | { readonly status: "falhou" }
  | { readonly status: "reserva_desatualizada" };

// Cada alteração exige a mesma tentativa ainda em processamento. A porta
// confere o limite persistido antes de reagendar e não incrementa attempts.
// Erros são códigos controlados; não recebe texto de exceções ou payloads.
export interface JobLifecycle {
  complete(attempt: JobAttempt): Promise<JobCompletionResult>;
  fail(attempt: JobAttempt, decision: JobFailureDecision): Promise<JobFailureResult>;
}
