import {
  buildBudgetCell,
  computeRelevantFileEvidence,
  mapExecutionToRun,
  type CaseExecutionEvidenceV1,
  type ContextWindowScalingTreatmentId,
  type CorrectnessEvidence,
  type TreatmentExecutionEvidenceV1,
} from "../../../src/experiments/plugins/contextWindowScaling/index.js";
import type { ExperimentTarget } from "../../../src/experiments/types.js";

export const PASS: CorrectnessEvidence = { availability: "available", score: 1, pass: true };
export const FAIL: CorrectnessEvidence = { availability: "available", score: 0.4, pass: false };
export const UNAVAILABLE: CorrectnessEvidence = { availability: "unavailable", score: null, pass: null };

export const target: ExperimentTarget = {
  kind: "self",
  targetRoot: process.cwd(),
  toolRoot: process.cwd(),
  packageName: null,
  packageVersion: null,
  hasPackageJson: true,
  hasLockfile: true,
  branch: null,
  commit: null,
  hasGit: false,
  isSelf: true,
};

/**
 * Synthetic treatment evidence built with the real cell owner. tokens === null means the context
 * was never measured. `shared` is the single evaluation shared by every fitting budget.
 */
export function treatmentEvidence(args: {
  variantId: ContextWindowScalingTreatmentId;
  budgets: readonly number[];
  tokens: number | null;
  shared: CorrectnessEvidence | null;
  expectedFiles?: readonly string[];
  observedFiles?: readonly string[] | null;
}): TreatmentExecutionEvidenceV1 {
  const observedFiles = args.tokens === null ? null : args.observedFiles === undefined ? [] : args.observedFiles;
  return {
    variantId: args.variantId,
    status: args.tokens === null ? "skipped" : "completed",
    context: {
      status: args.tokens === null ? "unavailable" : "available",
      characterCount: args.tokens === null ? null : args.tokens * 4,
      estimatedTokens: args.tokens,
      tokenCountMethod: args.tokens === null ? null : "estimated_chars_div_4",
      observedFiles: observedFiles === null ? null : [...observedFiles],
      warnings: [],
      reason: args.tokens === null ? "unavailable" : null,
    },
    evaluation: {
      status: args.shared === null ? "not-evaluated-no-fitting-budget" : "evaluated",
      agentId: null,
      agentStatus: null,
      evaluationCount: 0,
      correctness: args.shared ?? UNAVAILABLE,
      failureReasons: [],
      warnings: [],
      reason: null,
    },
    relevantFileEvidence: computeRelevantFileEvidence({
      expectedFiles: args.expectedFiles ?? ["src/a.ts"],
      observedFiles,
    }),
    budgetCells: args.budgets.map((contextBudgetTokens) =>
      buildBudgetCell({ contextBudgetTokens, contextEstimatedTokens: args.tokens, shared: args.shared })
    ),
    errors: [],
  };
}

export function caseEvidence(caseId: string, treatments: TreatmentExecutionEvidenceV1[]): CaseExecutionEvidenceV1 {
  return {
    caseId,
    caseName: `Case ${caseId}`,
    benchmarkProject: "synthetic",
    targetRoot: "benchmarks/projects/synthetic",
    taskLocality: null,
    treatments,
  };
}

export function syntheticRun(budgets: number[], cases: CaseExecutionEvidenceV1[], artifactPath = "context-window-scaling-execution.json") {
  return mapExecutionToRun({
    runId: "synthetic-run",
    startedAt: "2026-01-01T00:00:00.000Z",
    completedAt: "2026-01-01T00:00:01.000Z",
    target,
    contextBudgets: budgets,
    executionEvidence: cases,
    artifactPath,
  });
}
