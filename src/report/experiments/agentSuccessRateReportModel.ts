/**
 * Typed agent-success-rate report section. Every value here is copied from the plugin's already-calculated analysis and
 * execution evidence: the report layer rescored nothing, reran no check, reparsed no patch and read no reference patch.
 * It holds no prompt, source-file or patch body and no raw command output.
 */
export const AGENT_SUCCESS_RATE_REPORT_SCHEMA_VERSION = "my-dev-kit-lab-agent-success-rate-report-v1";

export type AgentSuccessReportMetricAvailability = "available" | "unavailable" | "not-applicable";
export type AgentSuccessReportMetricUnit = "count" | "ratio" | "lines" | "ms" | "boolean" | "tokens";

/** A measurement with explicit availability. An absent value is never a zero. */
export type AgentSuccessReportMetricV1 = {
  availability: AgentSuccessReportMetricAvailability;
  value: number | boolean | null;
  unit: AgentSuccessReportMetricUnit;
  reason: string | null;
};

export type AgentSuccessReportMeasurementBasis = "first-attempt" | "final-attempt" | "total-across-attempts";

export type AgentSuccessReportMeasurementTotalV1 = {
  basis: AgentSuccessReportMeasurementBasis;
  contributingCaseCount: number;
  availableCaseCount: number;
  unavailableCaseCount: number;
  /** Sum over available cases only; not a complete total unless unavailableCaseCount is 0. */
  sumOfAvailable: number | null;
  total: AgentSuccessReportMetricV1;
};

export type AgentSuccessReportPairedOutcomesV1 = { bothSucceeded: number; onlyRawFullFileSucceeded: number; onlyContextPackSucceeded: number; neitherSucceeded: number };

export type AgentSuccessReportTreatmentSummaryV1 = {
  treatmentId: string;
  evaluableCases: number;
  initialSuccessfulCases: number;
  initialSuccessRate: AgentSuccessReportMetricV1;
  finalSuccessfulCases: number;
  finalSuccessRate: AgentSuccessReportMetricV1;
  /** Real-agent mode only; null in deterministic-fixture mode, where no repair exists. */
  repair: {
    repairEligibleCases: number;
    repairAttemptedCases: number;
    repairAttempts: number;
    repairedCases: number;
    repairSuccessRate: AgentSuccessReportMetricV1;
    meanAttemptsPerEvaluableCase: AgentSuccessReportMetricV1;
    providerDurationMs: AgentSuccessReportMeasurementTotalV1[];
    providerTokens: AgentSuccessReportMeasurementTotalV1[];
  } | null;
};

export type AgentSuccessReportPairedDifferenceV1 = {
  id: string;
  basis: AgentSuccessReportMeasurementBasis;
  matchedCaseIds: string[];
  rawFullFileMean: AgentSuccessReportMetricV1;
  contextPackMean: AgentSuccessReportMetricV1;
  meanDifference: AgentSuccessReportMetricV1;
};

export type AgentSuccessReportComparisonV1 = {
  /** The comparison was evaluable: at least one case has a determinate verdict for both treatments. */
  comparisonEvaluable: boolean;
  /** Whether matched cases differ between treatments. Descriptive only; this is not an effect estimate. */
  observedOutcomeDifference: "observed" | "not-observed" | "not-evaluable";
  /** Always not-assessed: the experiment makes no statistical or causal claim. */
  statisticalEffect: "not-assessed";
  finalMatchedCaseIds: string[];
  finalIncompleteCases: Array<{ caseId: string; unavailableTreatmentIds: string[] }>;
  finalPairedOutcomes: AgentSuccessReportPairedOutcomesV1;
  initialMatchedCaseIds: string[] | null;
  initialIncompleteCases: Array<{ caseId: string; unavailableTreatmentIds: string[] }> | null;
  initialPairedOutcomes: AgentSuccessReportPairedOutcomesV1 | null;
  pairedDifferences: AgentSuccessReportPairedDifferenceV1[];
};

export type AgentSuccessReportCaseTreatmentV1 = {
  treatmentId: string;
  executionStatus: string;
  evidenceAvailability: string;
  /** Deterministic-fixture mode reports its single fixture attempt as both initial and final. */
  initialTaskSuccess: AgentSuccessReportMetricV1;
  finalTaskSuccess: AgentSuccessReportMetricV1;
  attemptCount: number;
  repairAttemptCount: number;
  repairSucceeded: AgentSuccessReportMetricV1;
  taskCheckPassRate: AgentSuccessReportMetricV1;
  regressionCheckPassRate: AgentSuccessReportMetricV1;
  requiredFactCoverage: AgentSuccessReportMetricV1;
  expectedEditCoverage: AgentSuccessReportMetricV1;
  editScopePrecision: AgentSuccessReportMetricV1;
  unexpectedChangedFiles: AgentSuccessReportMetricV1;
  protectedMutations: AgentSuccessReportMetricV1;
  changedFileCount: AgentSuccessReportMetricV1;
  /** Project-relative paths of the final evaluated patch, bounded for display. */
  changedFiles: { items: string[]; totalCount: number; omittedCount: number } | null;
  totalChurn: AgentSuccessReportMetricV1;
  relativeChurn: AgentSuccessReportMetricV1;
  /** Final attempt only. */
  finalAttemptProviderDurationMs: AgentSuccessReportMetricV1;
  finalAttemptProviderTokens: AgentSuccessReportMetricV1;
  /** Cumulative across attempts; real-agent mode only. */
  totalProviderDurationMs: AgentSuccessReportMetricV1 | null;
  totalProviderTokens: AgentSuccessReportMetricV1 | null;
  errors: Array<{ attemptNumber: number; code: string; message: string }>;
};

export type AgentSuccessReportCaseV1 = {
  caseId: string;
  caseName: string;
  benchmarkProject: string;
  taskLocality: string;
  treatments: AgentSuccessReportCaseTreatmentV1[];
};

export type AgentSuccessReportAttemptV1 = {
  attemptNumber: number;
  providerStatus: string;
  patchOutcome: string;
  verificationAvailability: "available" | "unavailable";
  taskSuccess: AgentSuccessReportMetricV1;
  failureCategory: string;
  repairEligible: boolean;
  providerDurationMs: AgentSuccessReportMetricV1;
  providerTokens: AgentSuccessReportMetricV1;
  tokenAvailability: "available" | "unavailable";
  /** Safe relative references only; null when the artifact does not exist. */
  proposedPatchPath: string | null;
  appliedPatchPath: string | null;
  agentArtifactDirectory: string | null;
};

export type AgentSuccessReportRepairHistoryV1 = {
  caseId: string;
  treatmentId: string;
  attempts: AgentSuccessReportAttemptV1[];
};

export type AgentSuccessRateReportV1 = {
  schemaVersion: typeof AGENT_SUCCESS_RATE_REPORT_SCHEMA_VERSION;
  identity: {
    runId: string;
    pluginId: string;
    pluginSchemaVersion: string;
    runStatus: string;
    executionMode: string;
    providerId: string | null;
    timeoutMs: number | null;
    repairAttempts: number | null;
    maxAttemptsPerTreatment: number;
    treatmentOrder: string[];
    caseCount: number;
    treatmentOutcomeCount: number;
  };
  /** Fixed wording selected by execution mode. */
  scientificStatement: string;
  limitations: string[];
  resultAvailability: {
    overall: "complete" | "partial" | "unavailable";
    evaluableTreatmentOutcomes: number;
    unavailableTreatmentOutcomes: number;
    totalTreatmentOutcomes: number;
    notes: string[];
  };
  treatments: AgentSuccessReportTreatmentSummaryV1[];
  comparison: AgentSuccessReportComparisonV1 | null;
  cases: AgentSuccessReportCaseV1[];
  /** Real-agent mode only; attempts are listed only when they actually executed. */
  repairHistory: AgentSuccessReportRepairHistoryV1[];
  warnings: Array<{ code: string; message: string }>;
  artifacts: Array<{ id: string; label: string; path: string | null; caseId: string | null; variantId: string | null }>;
};
