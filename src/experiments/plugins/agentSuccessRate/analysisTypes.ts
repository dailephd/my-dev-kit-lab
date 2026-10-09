import type { ExperimentRunStatus } from "../../types.js";
import type { AgentSuccessAttemptNumber, AgentSuccessEvidenceAvailability, AgentSuccessFailureCategory, AgentSuccessProviderStatus } from "./executionTypes.js";
import type { AgentSuccessExecutionMode, AgentSuccessRateTreatmentId } from "./metadata.js";
import type { AgentSuccessMetricV1 } from "./types.js";

/** Stable metric IDs, in the order they are written to artifacts. */
export const AGENT_SUCCESS_METRIC_IDS = [
  // task success components
  "patchApplied",
  "taskChecksPassed",
  "regressionSafe",
  "requiredFactsSatisfied",
  "protectedIntegrity",
  "taskResolved",
  "taskSuccess",
  // behavior facts
  "requiredFactsTotal",
  "requiredFactsSatisfiedCount",
  "optionalFactsTotal",
  "optionalFactsSatisfiedCount",
  "requiredFactCoverage",
  "factCoverage",
  // verification checks (command/check level only)
  "taskCheckPassedCount",
  "taskCheckTotalCount",
  "taskCheckPassRate",
  "regressionCheckPassedCount",
  "regressionCheckTotalCount",
  "regressionCheckPassRate",
  "regressionFailureCount",
  // edit quality
  "expectedEditFileCount",
  "expectedEditFilesChangedCount",
  "expectedEditCoverage",
  "allowedEditChangedFileCount",
  "unexpectedChangedFileCount",
  "editScopePrecision",
  "protectedMutationCount",
  "attemptedProtectedEditCount",
  // blast radius
  "changedFileCount",
  "addedFileCount",
  "modifiedFileCount",
  "deletedFileCount",
  "linesAdded",
  "linesDeleted",
  "totalChurn",
  "baselineTextLineCount",
  "relativeChurn",
  // time and tokens
  "agentDurationMs",
  "agentTotalTokens",
  "baselineVerificationDurationMs",
  "patchPipelineDurationMs",
  "postEditVerificationDurationMs",
  "evaluationDurationMs"
] as const;

export type AgentSuccessMetricId = (typeof AGENT_SUCCESS_METRIC_IDS)[number];

/** Aggregate mean ID -> the per-case metric it averages. */
export const AGENT_SUCCESS_MEAN_SOURCES = {
  meanTaskCheckPassRate: "taskCheckPassRate",
  meanRegressionCheckPassRate: "regressionCheckPassRate",
  meanRequiredFactCoverage: "requiredFactCoverage",
  meanExpectedEditCoverage: "expectedEditCoverage",
  meanEditScopePrecision: "editScopePrecision",
  meanUnexpectedChangedFileCount: "unexpectedChangedFileCount",
  meanChangedFileCount: "changedFileCount",
  meanTotalChurn: "totalChurn",
  meanRelativeChurn: "relativeChurn",
  meanEvaluationDurationMs: "evaluationDurationMs"
} as const satisfies Record<string, AgentSuccessMetricId>;

export type AgentSuccessMeanId = keyof typeof AGENT_SUCCESS_MEAN_SOURCES;

/** Scientific values for ONE attempt, calculated by the same owner as the final-attempt metrics. */
export type AgentSuccessAttemptAnalysisV1 = {
  attemptNumber: AgentSuccessAttemptNumber;
  providerStatus: AgentSuccessProviderStatus;
  failureCategory: AgentSuccessFailureCategory;
  repairEligible: boolean;
  executionStatus: ExperimentRunStatus;
  evidenceAvailability: AgentSuccessEvidenceAvailability;
  metrics: Record<AgentSuccessMetricId, AgentSuccessMetricV1>;
};

/**
 * Real-agent mode only. Initial-attempt and final outcomes are separate measurements: a repaired success is never
 * reported as an initial-attempt success. Totals are available only when every contributing attempt was measured.
 */
export type AgentSuccessRepairAnalysisV1 = {
  attemptCount: number;
  repairAttemptCount: number;
  /** Whether the initial attempt ended in an eligible implementation failure (independent of the configured allowance). */
  initialAttemptRepairEligible: boolean;
  initialAttemptTaskSuccess: AgentSuccessMetricV1;
  finalTaskSuccess: AgentSuccessMetricV1;
  /** true only for a failed initial attempt followed by a successful final repair; not-applicable when no repair ran. */
  repairSucceeded: AgentSuccessMetricV1;
  firstAttemptProviderDurationMs: AgentSuccessMetricV1;
  finalAttemptProviderDurationMs: AgentSuccessMetricV1;
  totalProviderDurationMs: AgentSuccessMetricV1;
  firstAttemptProviderTokens: AgentSuccessMetricV1;
  finalAttemptProviderTokens: AgentSuccessMetricV1;
  totalProviderTokens: AgentSuccessMetricV1;
  totalEvaluationDurationMs: AgentSuccessMetricV1;
  /** Attempts the provider actually ran, and how many of them carried a duration / total-token measurement. */
  providerAttemptCount: number;
  providerDurationMeasuredAttemptCount: number;
  providerTokenMeasuredAttemptCount: number;
  /** Execution order, contiguous from 1. */
  attempts: AgentSuccessAttemptAnalysisV1[];
};

export type AgentSuccessTreatmentAnalysisV1 = {
  treatmentId: AgentSuccessRateTreatmentId;
  caseId: string;
  executionStatus: ExperimentRunStatus;
  evidenceAvailability: AgentSuccessEvidenceAvailability;
  /** Metrics describe the FINAL evaluated attempt (the only attempt when no repair ran). */
  metrics: Record<AgentSuccessMetricId, AgentSuccessMetricV1>;
  /** Real-agent mode only; deterministic-fixture analysis never carries this key. */
  repair?: AgentSuccessRepairAnalysisV1;
};

export type AgentSuccessCaseAnalysisV1 = {
  caseId: string;
  benchmarkProject: string;
  /** Always in fixed treatment order. */
  treatments: AgentSuccessTreatmentAnalysisV1[];
};

export type AgentSuccessMeanV1 = {
  sourceMetricId: AgentSuccessMetricId;
  /** Cases whose source metric is available for every treatment, in input order. */
  matchedCaseIds: string[];
  metric: AgentSuccessMetricV1;
};

export type AgentSuccessTreatmentAggregateV1 = {
  treatmentId: AgentSuccessRateTreatmentId;
  /** Cases with a determinate task-success verdict for this treatment. */
  evaluableCaseCount: number;
  successfulCaseCount: number;
  taskSuccessRate: AgentSuccessMetricV1;
  /** One attempt per case/treatment, so this equals taskSuccessRate but is recorded separately for later batches. */
  initialAttemptSuccessRate: AgentSuccessMetricV1;
  agentTokenMeasurementsAvailable: number;
  agentTokenMeasurementsUnavailable: number;
  means: Record<AgentSuccessMeanId, AgentSuccessMeanV1>;
  /** Real-agent mode only. */
  repair?: AgentSuccessRepairAggregateV1;
};

/** What a sum or count of provider measurements represents. */
export type AgentSuccessMeasurementBasis = "first-attempt" | "final-attempt" | "total-across-attempts";

/** Explicit availability accounting: the total is available only when no contributing case is missing a measurement. */
export type AgentSuccessMeasurementTotalV1 = {
  basis: AgentSuccessMeasurementBasis;
  /** Cases whose provider ran at least one attempt. */
  contributingCaseCount: number;
  availableCaseCount: number;
  unavailableCaseCount: number;
  /** Sum over available cases only. This is NOT a complete total when unavailableCaseCount > 0. */
  sumOfAvailable: number | null;
  total: AgentSuccessMetricV1;
};

export type AgentSuccessRepairAggregateV1 = {
  initialAttemptEvaluableCount: number;
  initialAttemptSuccessfulCount: number;
  initialAttemptSuccessRate: AgentSuccessMetricV1;
  finalEvaluableCount: number;
  finalSuccessfulCount: number;
  finalTaskSuccessRate: AgentSuccessMetricV1;
  /** Cases whose initial attempt ended in an eligible implementation failure. */
  repairEligibleCaseCount: number;
  /** Cases in which at least one repair attempt executed. */
  repairAttemptedCaseCount: number;
  /** Repair-attempted cases with a determinate repair verdict. This is the repairSuccessRate denominator. */
  repairAttemptedEvaluableCaseCount: number;
  repairedCaseCount: number;
  repairSuccessRate: AgentSuccessMetricV1;
  totalAttemptCount: number;
  totalRepairAttemptCount: number;
  meanAttemptsPerEvaluableCase: AgentSuccessMetricV1;
  providerDurationMs: AgentSuccessMeasurementTotalV1[];
  providerTokens: AgentSuccessMeasurementTotalV1[];
};

/** Scientific truth owner for this experiment. Holds no source text, patch body or command output. */
export type AgentSuccessRateAnalysisV1 = {
  executionMode: AgentSuccessExecutionMode;
  /**
   * False in deterministic-fixture mode. In real-agent mode true only when at least one case has a determinate
   * task-success verdict for both treatments; it describes the comparison actually executed, not a context effect.
   */
  contextEffectEvaluated: boolean;
  treatmentOrder: AgentSuccessRateTreatmentId[];
  caseCount: number;
  cases: AgentSuccessCaseAnalysisV1[];
  /** Per-treatment aggregates in fixed treatment order. There is no ranking, winner, composite score or significance test. */
  aggregates: AgentSuccessTreatmentAggregateV1[];
  limitations: string[];
  /** Real-agent mode only: descriptive matched-case accounting. No ranking, winner, composite or significance test. */
  comparison?: AgentSuccessComparisonV1;
  /** Real-agent mode only: initial-attempt pairing and descriptive paired differences. Never a ranking or winner. */
  repairComparison?: AgentSuccessRepairComparisonV1;
};

export type AgentSuccessComparisonV1 = {
  basis: "matched-evaluable-cases";
  matchedCaseIds: string[];
  /** Cases excluded from matched metrics, with the treatments whose task success could not be determined. */
  incompleteCases: Array<{ caseId: string; unavailableTreatmentIds: AgentSuccessRateTreatmentId[] }>;
  /** Paired outcomes of the FINAL task-success verdict over matchedCaseIds. */
  pairedOutcomes: AgentSuccessPairedOutcomesV1;
};

/**
 * Real-agent mode: the repair-aware extension of the matched comparison. It is a sibling of `comparison` so the
 * established comparison contract is unchanged.
 */
export type AgentSuccessRepairComparisonV1 = {
  /** Paired outcomes of the INITIAL attempt over its own matched cases. */
  initialAttempt: { matchedCaseIds: string[]; incompleteCases: Array<{ caseId: string; unavailableTreatmentIds: AgentSuccessRateTreatmentId[] }>; pairedOutcomes: AgentSuccessPairedOutcomesV1 };
  /** Descriptive paired differences, context-pack minus raw-full-file, over matched cases per measurement. */
  pairedDifferences: AgentSuccessPairedDifferenceV1[];
  /**
   * Three distinct statements: the comparison was evaluable (evaluable), the observed outcomes differ in the executed
   * cases (observedOutcomeDifference), and a statistical or causal effect (always not-assessed).
   */
  interpretation: {
    evaluable: boolean;
    observedOutcomeDifference: "observed" | "not-observed" | "not-evaluable";
    statisticalEffect: "not-assessed";
  };
};

export type AgentSuccessPairedOutcomesV1 = { bothSucceeded: number; onlyRawFullFileSucceeded: number; onlyContextPackSucceeded: number; neitherSucceeded: number };

export type AgentSuccessPairedDifferenceId =
  | "initialAttemptSuccess"
  | "finalSuccess"
  | "repairAttempts"
  | "editScopePrecision"
  | "expectedEditCoverage"
  | "unexpectedChangedFiles"
  | "totalChurn"
  | "providerDurationMs"
  | "providerTokens";

export type AgentSuccessPairedDifferenceV1 = {
  id: AgentSuccessPairedDifferenceId;
  /** Which attempt scope the values come from (edit quality and churn are always the final evaluated patch). */
  basis: AgentSuccessMeasurementBasis;
  matchedCaseIds: string[];
  rawFullFileMean: AgentSuccessMetricV1;
  contextPackMean: AgentSuccessMetricV1;
  /** context-pack mean minus raw-full-file mean. A descriptive difference, not a test statistic. */
  meanDifference: AgentSuccessMetricV1;
};
