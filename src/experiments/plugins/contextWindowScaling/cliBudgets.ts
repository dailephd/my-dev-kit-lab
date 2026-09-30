import { validateContextBudgets } from "./config.js";
import { CONTEXT_BUDGET_16K, CONTEXT_BUDGET_32K, CONTEXT_BUDGET_64K, CONTEXT_BUDGET_8K } from "./contextBudget.js";

/** Closed, lowercase CLI vocabulary. "8k" is 8192 (binary), never 8000. */
const SYMBOLIC_CONTEXT_BUDGETS: Readonly<Record<string, number>> = Object.freeze({
  "8k": CONTEXT_BUDGET_8K,
  "16k": CONTEXT_BUDGET_16K,
  "32k": CONTEXT_BUDGET_32K,
  "64k": CONTEXT_BUDGET_64K,
});

const CANONICAL_POSITIVE_INTEGER = /^[1-9][0-9]*$/;

/**
 * Converts the comma-separated --context-budgets value to numbers (symbolic or canonical base-10
 * integers only), then delegates all domain rules (positive safe integer, no duplicates, ascending
 * order) to validateContextBudgets. Throws with the CLI flag name on any invalid input.
 */
export function parseContextBudgetsCliValue(value: string): number[] {
  const tokens = value.split(",").map((token) => token.trim());
  const numbers = tokens.map((token) => {
    const symbolic = Object.hasOwn(SYMBOLIC_CONTEXT_BUDGETS, token) ? SYMBOLIC_CONTEXT_BUDGETS[token] : undefined;
    if (symbolic !== undefined) return symbolic;
    if (CANONICAL_POSITIVE_INTEGER.test(token)) return Number(token);
    throw new Error(
      `--context-budgets value ${JSON.stringify(token.length > 20 ? `${token.slice(0, 20)}...` : token)} is invalid; use 8k, 16k, 32k, 64k, or a positive base-10 integer.`
    );
  });
  const validated = validateContextBudgets(numbers);
  if (validated.errors.length > 0) {
    throw new Error(`--context-budgets is invalid: ${validated.errors.join(" ")}`);
  }
  return validated.budgets;
}
