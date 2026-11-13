import { deepEqual, throws } from "node:assert/strict";
import { test } from "node:test";
import { decideJobFailure } from "./retry-policy.js";

test("falha transitória usa espera exponencial de cinco segundos com teto de sessenta", () => {
  for (const [attempts, delaySeconds] of [[1, 5], [2, 10], [3, 20], [4, 40], [5, 60], [6, 60], [2147483647, 60]] as const) {
    deepEqual(decideJobFailure("transitoria", attempts), { retry: true, delaySeconds });
  }
});

test("falha definitiva não autoriza novas tentativas", () => {
  for (const attempts of [1, 2, 3]) deepEqual(decideJobFailure("definitiva", attempts), { retry: false });
});

test("política rejeita contador ausente de uma reserva válida", () => {
  for (const attempts of [0, -1, 1.5, NaN, Infinity, -Infinity, Number.MAX_SAFE_INTEGER + 1]) {
    throws(() => decideJobFailure("transitoria", attempts), {
      name: "RangeError", message: "A tentativa deve ser um inteiro positivo.",
    });
  }
});
