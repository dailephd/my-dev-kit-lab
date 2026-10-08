import type { ExperimentRunStatus } from "../../types.js";
import type { AgentSuccessEvidenceAvailability } from "./executionTypes.js";
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

export type AgentSuccessTreatmentAnalysisV1 = {
  treatmentId: AgentSuccessRateTreatmentId;
  caseId: string;
  executionStatus: ExperimentRunStatus;
  evidenceAvailability: AgentSuccessEvidenceAvailability;
  metrics: Record<AgentSuccessMetricId, AgentSuccessMetricV1>;
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
};

export type AgentSuccessComparisonV1 = {
  basis: "matched-evaluable-cases";
  matchedCaseIds: string[];
  /** Cases excluded from matched metrics, with the treatments whose task success could not be determined. */
  incompleteCases: Array<{ caseId: string; unavailableTreatmentIds: AgentSuccessRateTreatmentId[] }>;
  pairedOutcomes: { bothSucceeded: number; onlyRawFullFileSucceeded: number; onlyContextPackSucceeded: number; neitherSucceeded: number };
};
