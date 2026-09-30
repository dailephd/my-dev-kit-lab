import type { ContextBudgetEvidence, ContextBudgetTokens, ContextFitStatus } from "./types.js";

export const CONTEXT_BUDGET_8K: ContextBudgetTokens = 8192;
export const CONTEXT_BUDGET_16K: ContextBudgetTokens = 16384;
export const CONTEXT_BUDGET_32K: ContextBudgetTokens = 32768;
export const CONTEXT_BUDGET_64K: ContextBudgetTokens = 65536;

export const STANDARD_CONTEXT_BUDGETS: readonly ContextBudgetTokens[] = Object.freeze([
  CONTEXT_BUDGET_8K,
  CONTEXT_BUDGET_16K,
  CONTEXT_BUDGET_32K,
  CONTEXT_BUDGET_64K,
]);

export function isValidContextBudgetTokens(value: unknown): value is ContextBudgetTokens {
  return typeof value === "number" && Number.isSafeInteger(value) && value > 0;
}

/** Exact boundary fits: estimatedTokens <= budget. */
export function classifyContextFit(
  contextEstimatedTokens: number,
  contextBudgetTokens: ContextBudgetTokens
): ContextFitStatus {
  assertMeasuredTokens(contextEstimatedTokens);
  assertBudget(contextBudgetTokens);
  return contextEstimatedTokens <= contextBudgetTokens ? "fits" : "context-too-large";
}

/** estimated / budget * 100. Not capped at 100 and not rounded. */
export function calculateContextBudgetUtilizationPercent(
  contextEstimatedTokens: number,
  contextBudgetTokens: ContextBudgetTokens
): number {
  assertMeasuredTokens(contextEstimatedTokens);
  assertBudget(contextBudgetTokens);
  return (contextEstimatedTokens / contextBudgetTokens) * 100;
}

export function buildContextBudgetEvidence(
  contextEstimatedTokens: number,
  contextBudgetTokens: ContextBudgetTokens
): ContextBudgetEvidence {
  return {
    contextBudgetTokens,
    contextEstimatedTokens,
    contextFitStatus: classifyContextFit(contextEstimatedTokens, contextBudgetTokens),
    contextBudgetUtilizationPercent: calculateContextBudgetUtilizationPercent(
      contextEstimatedTokens,
      contextBudgetTokens
    ),
  };
}

function assertBudget(value: number): void {
  if (!isValidContextBudgetTokens(value)) {
    throw new RangeError("Context budget must be a positive safe integer.");
  }
}

function assertMeasuredTokens(value: number): void {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0) {
    throw new RangeError("Estimated context tokens must be a nonnegative safe integer.");
  }
}
