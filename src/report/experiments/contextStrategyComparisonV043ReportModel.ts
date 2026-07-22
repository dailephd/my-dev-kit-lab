export const V043_REPORT_DETAIL_LIMIT = 100;

export interface V043BoundedReportListV1<T> {
  totalCount: number;
  displayedCount: number;
  omittedCount: number;
  items: T[];
}

export interface V043ReportIssueV1 {
  code: string;
  fieldPath: string | null;
  message: string;
  runNumber: number | null;
}

export type V043ReportArtifactKind =
  | "expectation-fixture"
  | "context-capsule"
  | "retrieval-audit-record"
  | "workflow-instruction-packet"
  | "full-workflow-library";

export interface V043ReportArtifactMetadataV1 {
  sourceInstance: string;
  artifactKind: V043ReportArtifactKind;
  sourcePath: string;
  schemaVersion: string;
  generatedAt: string | null;
  producerName: string | null;
  producerVersion: string | null;
  role: string | null;
  workflowId: string | null;
  stageId: string | null;
  catalogSchemaVersion: string | null;
  catalogVersion: string | null;
  fixtureId: string | null;
  caseId: string | null;
  title: string | null;
}

export interface V043ReportExecutionSummaryV1 {
  status: "completed" | "unavailable" | "not-applicable" | "invalid-input" | "failed";
  issues: V043BoundedReportListV1<V043ReportIssueV1>;
}

export interface V043ReportRatioMetricV1 {
  availability: "available" | "unavailable" | "not-applicable";
  numerator: number | null;
  denominator: number | null;
  rate: number | null;
  matchedExpectationIds: V043BoundedReportListV1<string>;
  missingExpectationIds: V043BoundedReportListV1<string>;
  reason: string | null;
}

export interface V043ReportCountMetricV1 {
  availability: "available" | "unavailable" | "not-applicable";
  count: number | null;
  evidenceKeys: V043BoundedReportListV1<string>;
  reason: string | null;
}

export interface V043ReportResponsibilityMappingV1 {
  sourceArtifact: "context-capsule" | "retrieval-audit-record";
  sourceInstance: string;
  requested: boolean;
  operational: boolean;
  mappedCount: number;
  partiallyMappedCount: number;
  unmappedCount: number;
  notApplicableCount: number;
  denominator: number;
  mappedRate: number | null;
}

export interface V043ReportStateComparisonV1 {
  sourceArtifact: string;
  sourceInstance: string;
  expectationFieldPath: string;
  artifactFieldPath: string | null;
  availability: "available" | "unavailable" | "not-applicable";
  expected: unknown;
  actual: unknown;
  matched: boolean | null;
  reason: string | null;
}

export interface V043ReportContextSizeSourceV1 {
  sourceInstance: string;
  sourceKind: string;
  characterCount: number;
  estimatedTokenCount: number;
}

export interface V043ReportContextSizeV1 {
  sources: V043BoundedReportListV1<V043ReportContextSizeSourceV1>;
  totalCharacterCount: number;
  totalEstimatedTokenCount: number;
  tokenEstimateFormula: "ceil(characterCount / 4) per source";
}

export interface V043ReportExpectationMatchV1 {
  expectationId: string;
  inclusion: "required" | "allowed" | "forbidden";
  sourceArtifact: string;
  category: string;
  targetKey: string;
  outcome: "matched" | "missing" | "violated";
  matchedSourceInstances: string[];
  matchedSourceFieldPaths: string[];
}

export interface V043ReportObservedEvidenceV1 {
  sourceArtifact: string;
  sourceInstance: string;
  category: string;
  targetKey: string;
  sourceFieldPath: string;
}

export interface V043ReportTargetMutationV1 {
  id: string;
  kind: string;
  fieldPath: string;
  before: unknown;
  after: unknown;
}

export interface V043ReportRunRecordV1 {
  runNumber: number;
  executionStatus: string;
  evaluationStatus: string;
  targetImmutabilityAvailability: "available" | "unavailable";
  targetImmutabilityStatus: "unchanged" | "mutated" | null;
  newMutationCount: number | null;
  targetImmutabilityReason: string | null;
  mutations: V043BoundedReportListV1<V043ReportTargetMutationV1>;
}

export interface V043ReportDeterminismV1 {
  availability: "available" | "unavailable" | "not-applicable";
  repeatCount: number;
  deterministic: boolean | null;
  baselineSha256: string | null;
  runDigests: V043BoundedReportListV1<{
    runNumber: number;
    sha256: string;
  }>;
  mismatchRunNumbers: number[];
  reason: string | null;
}

export interface V043ReportMetricsV1 {
  requiredEvidenceRecall: V043ReportRatioMetricV1;
  allowedEvidenceCoverage: V043ReportRatioMetricV1;
  forbiddenEvidenceInclusion: V043ReportRatioMetricV1;
  irrelevantFileInclusion: V043ReportCountMetricV1;
  irrelevantInstructionInclusion: V043ReportCountMetricV1;
  requiredProvenanceRecall: V043ReportRatioMetricV1;
  responsibilityMappingCompleteness: V043BoundedReportListV1<V043ReportResponsibilityMappingV1>;
  stateComparisons: V043BoundedReportListV1<V043ReportStateComparisonV1>;
  contextSize: V043ReportContextSizeV1;
  consideredButUnselectedReads: V043ReportCountMetricV1;
  unnecessaryReads: V043ReportCountMetricV1;
  targetImmutability: V043ReportCountMetricV1;
}

export interface V043ReportEvaluationSummaryV1 {
  status: "completed" | "not-applicable" | "failed";
  reason: string | null;
  warnings: V043BoundedReportListV1<string>;
  expectationMatches: V043BoundedReportListV1<V043ReportExpectationMatchV1>;
  observedEvidence: V043BoundedReportListV1<V043ReportObservedEvidenceV1>;
  metrics: V043ReportMetricsV1 | null;
}

export interface V043ReportAssuranceSummaryV1 {
  status: "passed" | "failed" | "not-applicable";
  repeatCount: number;
  runRecords: V043BoundedReportListV1<V043ReportRunRecordV1>;
  determinism: V043ReportDeterminismV1;
  issues: V043BoundedReportListV1<V043ReportIssueV1>;
}

export interface ContextStrategyComparisonV043StrategyReportV1 {
  strategyId: string;
  artifacts: V043BoundedReportListV1<V043ReportArtifactMetadataV1>;
  execution: V043ReportExecutionSummaryV1;
  evaluation: V043ReportEvaluationSummaryV1;
  assurance: V043ReportAssuranceSummaryV1;
}

export interface ContextStrategyComparisonV043ReportSummaryV1 {
  strategyCount: number;
  completedExecutionCount: number;
  invalidInputExecutionCount: number;
  failedExecutionCount: number;
  completedEvaluationCount: number;
  notApplicableEvaluationCount: number;
  failedEvaluationCount: number;
  passedAssuranceCount: number;
  failedAssuranceCount: number;
  notApplicableAssuranceCount: number;
}

export interface ContextStrategyComparisonV043ReportV1 {
  schemaVersion: "1.0.0";
  detailLimit: 100;
  summary: ContextStrategyComparisonV043ReportSummaryV1;
  strategies: ContextStrategyComparisonV043StrategyReportV1[];
  interpretation: {
    summary: string;
    limitations: string[];
  };
}
