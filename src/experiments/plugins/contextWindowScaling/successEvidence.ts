import { calculateContextBudgetUtilizationPercent, classifyContextFit } from "./contextBudget.js";
import type { ContextBudgetTokens, ContextFitStatus } from "./types.js";

/** Fit evidence for a cell; "unavailable" only when the treatment context was never measured. */
export type ContextFitEvidenceStatus = ContextFitStatus | "unavailable";

export type BudgetCellEvaluationStatus = "evaluated" | "not-evaluated-context-too-large" | "unavailable";

export type CorrectnessEvidence = {
  availability: "available" | "unavailable";
  score: number | null;
  pass: boolean | null;
};

export type SuccessReason =
  | "correctness-pass"
  | "correctness-fail"
  | "context-too-large"
  | "evaluation-unavailable"
  | "context-unavailable";

export type SuccessEvidence = {
  status: "available" | "unavailable";
  success: boolean | null;
  reason: SuccessReason;
};

export type BudgetCellEvidence = {
  contextBudgetTokens: ContextBudgetTokens;
  contextFitStatus: ContextFitEvidenceStatus;
  /** Uncapped; null only when the context measurement is unavailable. */
  contextBudgetUtilizationPercent: number | null;
  evaluationStatus: BudgetCellEvaluationStatus;
  correctness: CorrectnessEvidence;
  successEvidence: SuccessEvidence;
};

export const UNAVAILABLE_CORRECTNESS: CorrectnessEvidence = { availability: "unavailable", score: null, pass: null };

/** The existing scorer's own passed result is used as-is; no score threshold is defined here. */
export function toCorrectnessEvidence(scored: {
  available: boolean;
  score: number | null;
  passed: boolean | null;
}): CorrectnessEvidence {
  if (!scored.available || scored.score === null || scored.passed === null) {
    return { ...UNAVAILABLE_CORRECTNESS };
  }
  return { availability: "available", score: scored.score, pass: scored.passed };
}

export function deriveSuccessEvidence(args: {
  contextFitStatus: ContextFitEvidenceStatus;
  correctness: CorrectnessEvidence;
}): SuccessEvidence {
  if (args.contextFitStatus === "unavailable") {
    return { status: "unavailable", success: null, reason: "context-unavailable" };
  }
  if (args.contextFitStatus === "context-too-large") {
    return { status: "available", success: false, reason: "context-too-large" };
  }
  if (args.correctness.availability !== "available" || args.correctness.pass === null) {
    return { status: "unavailable", success: null, reason: "evaluation-unavailable" };
  }
  return args.correctness.pass
    ? { status: "available", success: true, reason: "correctness-pass" }
    : { status: "available", success: false, reason: "correctness-fail" };
}

/**
 * One cell per budget. `shared` is the single deterministic evaluation of this treatment's context
 * (null when it was never requested because no budget fits or the context is unavailable).
 */
export function buildBudgetCell(args: {
  contextBudgetTokens: ContextBudgetTokens;
  contextEstimatedTokens: number | null;
  shared: CorrectnessEvidence | null;
}): BudgetCellEvidence {
  if (args.contextEstimatedTokens === null) {
    return {
      contextBudgetTokens: args.contextBudgetTokens,
      contextFitStatus: "unavailable",
      contextBudgetUtilizationPercent: null,
      evaluationStatus: "unavailable",
      correctness: { ...UNAVAILABLE_CORRECTNESS },
      successEvidence: deriveSuccessEvidence({ contextFitStatus: "unavailable", correctness: UNAVAILABLE_CORRECTNESS }),
    };
  }
  const fit = classifyContextFit(args.contextEstimatedTokens, args.contextBudgetTokens);
  const utilization = calculateContextBudgetUtilizationPercent(args.contextEstimatedTokens, args.contextBudgetTokens);
  if (fit === "context-too-large") {
    return {
      contextBudgetTokens: args.contextBudgetTokens,
      contextFitStatus: fit,
      contextBudgetUtilizationPercent: utilization,
      evaluationStatus: "not-evaluated-context-too-large",
      correctness: { ...UNAVAILABLE_CORRECTNESS },
      successEvidence: deriveSuccessEvidence({ contextFitStatus: fit, correctness: UNAVAILABLE_CORRECTNESS }),
    };
  }
  const correctness = args.shared ?? { ...UNAVAILABLE_CORRECTNESS };
  return {
    contextBudgetTokens: args.contextBudgetTokens,
    contextFitStatus: fit,
    contextBudgetUtilizationPercent: utilization,
    evaluationStatus: correctness.availability === "available" ? "evaluated" : "unavailable",
    correctness: { ...correctness },
    successEvidence: deriveSuccessEvidence({ contextFitStatus: fit, correctness }),
  };
}
