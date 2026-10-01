import type { ExperimentMetric } from "../../types.js";
import type { CaseExecutionEvidenceV1, TreatmentExecutionEvidenceV1 } from "./executionArtifact.js";
import { CONTEXT_WINDOW_SCALING_TREATMENT_IDS, type ContextWindowScalingTreatmentId } from "./metadata.js";
import type { RelevantFileEvidence, RelevantFileEvidenceStatus } from "./relevantFiles.js";
import type { BudgetCellEvidence } from "./successEvidence.js";
import type { ContextBudgetTokens } from "./types.js";

/**
 * The single aggregation owner for context-window-scaling. Reports, generic ExperimentMetric
 * mapping, and later plot builders consume its output; none of them recompute these formulas.
 * It is a pure function of Batch 2 execution evidence: no timestamps, paths, or environment.
 */

export type BudgetTreatmentSummaryV1 = {
  contextBudgetTokens: ContextBudgetTokens;
  variantId: ContextWindowScalingTreatmentId;
  totalCellCount: number;
  contextMeasuredCount: number;
  fitCount: number;
  contextTooLargeCount: number;
  contextUnavailableCount: number;
  successfulCellCount: number;
  notSuccessfulCellCount: number;
  successEvidenceAvailableCount: number;
  successEvidenceUnavailableCount: number;
  /** successful / successEvidenceAvailable * 100; null when nothing is available. Unrounded. */
  successRatePercent: number | null;
  correctnessAvailableCount: number;
  correctnessUnavailableCount: number;
  /** Mean of available existing correctness scores only; null when none. Unrounded. */
  meanCorrectnessScore: number | null;
  utilizationAvailableCount: number;
  utilizationUnavailableCount: number;
  /** Uncapped; null when no utilization is available. */
  meanContextBudgetUtilizationPercent: number | null;
  minContextBudgetUtilizationPercent: number | null;
  maxContextBudgetUtilizationPercent: number | null;
};

/** Context evidence is independent of budget, so it appears once per case and treatment. */
export type CaseTreatmentContextSummaryV1 = {
  caseId: string;
  caseName: string;
  variantId: ContextWindowScalingTreatmentId;
  contextStatus: "available" | "unavailable";
  characterCount: number | null;
  estimatedTokens: number | null;
  tokenCountMethod: string | null;
  observedFileCount: number | null;
  relevantFileEvidence: RelevantFileEvidence;
};

export type RelevantFileSummaryV1 = {
  relevantFileEvidenceAvailableCount: number;
  relevantFileEvidenceUnavailableCount: number;
  relevantFileEvidenceNotApplicableCount: number;
  totalOmittedRelevantFileCount: number;
};

export type ContextWindowScalingRunSummaryV1 = {
  caseCount: number;
  treatmentCount: number;
  budgetCount: number;
  totalBudgetCellCount: number;
  evaluatedBudgetCellCount: number;
  contextTooLargeCellCount: number;
  contextUnavailableCellCount: number;
  correctnessAvailableCellCount: number;
  correctnessUnavailableCellCount: number;
  successEvidenceAvailableCellCount: number;
  successEvidenceUnavailableCellCount: number;
  relevantFileEvidenceAvailableTreatmentCount: number;
  relevantFileEvidenceUnavailableTreatmentCount: number;
  relevantFileEvidenceNotApplicableTreatmentCount: number;
};

export type ContextWindowScalingAggregateV1 = {
  budgets: ContextBudgetTokens[];
  treatments: ContextWindowScalingTreatmentId[];
  runSummary: ContextWindowScalingRunSummaryV1;
  budgetTreatmentSummaries: BudgetTreatmentSummaryV1[];
  caseTreatmentContextSummaries: CaseTreatmentContextSummaryV1[];
  relevantFileSummary: RelevantFileSummaryV1;
};

export function aggregateContextWindowScaling(args: {
  contextBudgets: readonly ContextBudgetTokens[];
  cases: readonly CaseExecutionEvidenceV1[];
}): ContextWindowScalingAggregateV1 {
  const budgets = [...args.contextBudgets].sort((a, b) => a - b);
  const treatments = [...CONTEXT_WINDOW_SCALING_TREATMENT_IDS];
  const treatmentsOf = (variantId: ContextWindowScalingTreatmentId) =>
    args.cases.map((caseEvidence) => ({ caseEvidence, treatment: requireTreatment(caseEvidence, variantId, budgets) }));

  const budgetTreatmentSummaries: BudgetTreatmentSummaryV1[] = [];
  for (const contextBudgetTokens of budgets) {
    for (const variantId of treatments) {
      const cells = treatmentsOf(variantId).map(({ treatment }) => cellFor(treatment, contextBudgetTokens));
      budgetTreatmentSummaries.push(summarizeCells(contextBudgetTokens, variantId, cells));
    }
  }

  const caseTreatmentContextSummaries: CaseTreatmentContextSummaryV1[] = args.cases.flatMap((caseEvidence) =>
    treatments.map((variantId) => {
      const treatment = requireTreatment(caseEvidence, variantId, budgets);
      return {
        caseId: caseEvidence.caseId,
        caseName: caseEvidence.caseName,
        variantId,
        contextStatus: treatment.context.status,
        characterCount: treatment.context.characterCount,
        estimatedTokens: treatment.context.estimatedTokens,
        tokenCountMethod: treatment.context.tokenCountMethod,
        observedFileCount: treatment.context.observedFiles === null ? null : treatment.context.observedFiles.length,
        relevantFileEvidence: structuredClone(treatment.relevantFileEvidence),
      };
    })
  );

  const allCells = budgetTreatmentSummaries;
  const relevant = caseTreatmentContextSummaries.map((summary) => summary.relevantFileEvidence);
  const relevantCount = (status: RelevantFileEvidenceStatus) => relevant.filter((evidence) => evidence.status === status).length;
  const relevantFileSummary: RelevantFileSummaryV1 = {
    relevantFileEvidenceAvailableCount: relevantCount("available"),
    relevantFileEvidenceUnavailableCount: relevantCount("unavailable"),
    relevantFileEvidenceNotApplicableCount: relevantCount("not-applicable"),
    totalOmittedRelevantFileCount: relevant.reduce((sum, evidence) => sum + (evidence.omittedRelevantFileCount ?? 0), 0),
  };
  const sumOf = (pick: (summary: BudgetTreatmentSummaryV1) => number) => allCells.reduce((sum, summary) => sum + pick(summary), 0);
  const evaluatedBudgetCellCount = args.cases
    .flatMap((caseEvidence) => caseEvidence.treatments)
    .flatMap((treatment) => treatment.budgetCells)
    .filter((cell) => cell.evaluationStatus === "evaluated").length;

  return {
    budgets,
    treatments,
    runSummary: {
      caseCount: args.cases.length,
      treatmentCount: treatments.length,
      budgetCount: budgets.length,
      totalBudgetCellCount: sumOf((s) => s.totalCellCount),
      evaluatedBudgetCellCount,
      contextTooLargeCellCount: sumOf((s) => s.contextTooLargeCount),
      contextUnavailableCellCount: sumOf((s) => s.contextUnavailableCount),
      correctnessAvailableCellCount: sumOf((s) => s.correctnessAvailableCount),
      correctnessUnavailableCellCount: sumOf((s) => s.correctnessUnavailableCount),
      successEvidenceAvailableCellCount: sumOf((s) => s.successEvidenceAvailableCount),
      successEvidenceUnavailableCellCount: sumOf((s) => s.successEvidenceUnavailableCount),
      relevantFileEvidenceAvailableTreatmentCount: relevantFileSummary.relevantFileEvidenceAvailableCount,
      relevantFileEvidenceUnavailableTreatmentCount: relevantFileSummary.relevantFileEvidenceUnavailableCount,
      relevantFileEvidenceNotApplicableTreatmentCount: relevantFileSummary.relevantFileEvidenceNotApplicableCount,
    },
    budgetTreatmentSummaries,
    caseTreatmentContextSummaries,
    relevantFileSummary,
  };
}

function requireTreatment(
  caseEvidence: CaseExecutionEvidenceV1,
  variantId: ContextWindowScalingTreatmentId,
  budgets: readonly number[]
): TreatmentExecutionEvidenceV1 {
  const matches = caseEvidence.treatments.filter((treatment) => treatment.variantId === variantId);
  const treatment = matches[0];
  if (matches.length !== 1 || !treatment) {
    throw new Error(`Invalid context-window-scaling evidence: case ${caseEvidence.caseId} must have exactly one ${variantId} treatment.`);
  }
  const cellBudgets = treatment.budgetCells.map((cell) => cell.contextBudgetTokens);
  if (cellBudgets.length !== budgets.length || budgets.some((budget) => cellBudgets.filter((value) => value === budget).length !== 1)) {
    throw new Error(`Invalid context-window-scaling evidence: case ${caseEvidence.caseId} ${variantId} cells do not match the selected budgets.`);
  }
  return treatment;
}

function cellFor(treatment: TreatmentExecutionEvidenceV1, budget: ContextBudgetTokens): BudgetCellEvidence {
  return treatment.budgetCells.find((cell) => cell.contextBudgetTokens === budget)!;
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function summarizeCells(
  contextBudgetTokens: ContextBudgetTokens,
  variantId: ContextWindowScalingTreatmentId,
  cells: readonly BudgetCellEvidence[]
): BudgetTreatmentSummaryV1 {
  const fitCount = cells.filter((cell) => cell.contextFitStatus === "fits").length;
  const contextTooLargeCount = cells.filter((cell) => cell.contextFitStatus === "context-too-large").length;
  const contextUnavailableCount = cells.filter((cell) => cell.contextFitStatus === "unavailable").length;
  const successAvailable = cells.filter((cell) => cell.successEvidence.status === "available");
  const successfulCellCount = successAvailable.filter((cell) => cell.successEvidence.success === true).length;
  const scores = cells
    .filter((cell) => cell.correctness.availability === "available")
    .map((cell) => cell.correctness.score)
    .filter(isFiniteNumber);
  const utilizations = cells.map((cell) => cell.contextBudgetUtilizationPercent).filter(isFiniteNumber);
  const mean = (values: number[]) => (values.length === 0 ? null : values.reduce((sum, value) => sum + value, 0) / values.length);
  return {
    contextBudgetTokens,
    variantId,
    totalCellCount: cells.length,
    contextMeasuredCount: fitCount + contextTooLargeCount,
    fitCount,
    contextTooLargeCount,
    contextUnavailableCount,
    successfulCellCount,
    notSuccessfulCellCount: successAvailable.length - successfulCellCount,
    successEvidenceAvailableCount: successAvailable.length,
    successEvidenceUnavailableCount: cells.length - successAvailable.length,
    successRatePercent: successAvailable.length === 0 ? null : (successfulCellCount / successAvailable.length) * 100,
    correctnessAvailableCount: scores.length,
    correctnessUnavailableCount: cells.length - scores.length,
    meanCorrectnessScore: mean(scores),
    utilizationAvailableCount: utilizations.length,
    utilizationUnavailableCount: cells.length - utilizations.length,
    meanContextBudgetUtilizationPercent: mean(utilizations),
    minContextBudgetUtilizationPercent: utilizations.length === 0 ? null : Math.min(...utilizations),
    maxContextBudgetUtilizationPercent: utilizations.length === 0 ? null : Math.max(...utilizations),
  };
}

/** Run-level scalar metrics: one set per budget x treatment, scoped by variantId and budget-bearing ids. */
export function toAggregateExperimentMetrics(aggregate: ContextWindowScalingAggregateV1): ExperimentMetric[] {
  const metrics: ExperimentMetric[] = [
    { id: "context-window-scaling-case-count", name: "Context-window-scaling case count", value: aggregate.runSummary.caseCount, unit: "count" },
    { id: "context-window-scaling-budget-count", name: "Context budget count", value: aggregate.runSummary.budgetCount, unit: "count" },
  ];
  for (const summary of aggregate.budgetTreatmentSummaries) {
    const prefix = `context-budget-${summary.contextBudgetTokens}`;
    const scoped = (suffix: string, name: string, value: number | null, unit: string, description?: string): ExperimentMetric => ({
      id: `${prefix}-${suffix}`,
      name: `${name} (${summary.contextBudgetTokens} token budget)`,
      value,
      unit,
      ...(description ? { description } : {}),
      variantId: summary.variantId,
    });
    metrics.push(
      scoped("fit-count", "Cases whose context fits", summary.fitCount, "count"),
      scoped("context-too-large-count", "Cases whose context is too large", summary.contextTooLargeCount, "count"),
      scoped("successful-cell-count", "Successful cells", summary.successfulCellCount, "count"),
      scoped("success-rate-percent", "Success rate", summary.successRatePercent, "percent", "Successful cells over success-evidence-available cells; null when none are available."),
      scoped("mean-correctness-score", "Mean correctness score", summary.meanCorrectnessScore, "score", "Mean of available existing correctness scores; unavailable correctness is excluded, not zero."),
      scoped("mean-context-budget-utilization-percent", "Mean context budget utilization", summary.meanContextBudgetUtilizationPercent, "percent", "Uncapped; may exceed 100.")
    );
  }
  return metrics;
}

/** Per-outcome scalar metrics for one treatment, one set per budget cell. */
export function toOutcomeBudgetMetrics(treatment: TreatmentExecutionEvidenceV1, caseId: string): ExperimentMetric[] {
  return treatment.budgetCells.flatMap((cell) => {
    const base = { variantId: treatment.variantId, caseId };
    const prefix = `budget-${cell.contextBudgetTokens}`;
    return [
      { id: `${prefix}-context-budget-utilization-percent`, name: `Context budget utilization (${cell.contextBudgetTokens})`, value: cell.contextBudgetUtilizationPercent, unit: "percent", ...base },
      { id: `${prefix}-correctness-score`, name: `Correctness score (${cell.contextBudgetTokens})`, value: cell.correctness.score, unit: "score", ...base },
      { id: `${prefix}-success`, name: `Success (${cell.contextBudgetTokens})`, value: cell.successEvidence.success, ...base },
    ];
  });
}
