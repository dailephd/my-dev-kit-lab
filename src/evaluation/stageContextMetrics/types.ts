import type { JsonValue } from "../upstreamArtifacts/index.js";
import type {
  StageContextExpectationCategory,
  StageContextExpectationInclusion,
  StageContextExpectationSourceArtifact
} from "../stageContextExpectations/index.js";
import type { V043StageContextStrategyExecutionStatus } from "../../experiments/plugins/contextStrategyComparison/v043StrategyExecutionTypes.js";
import type { V043StageContextStrategyId } from "../../experiments/plugins/contextStrategyComparison/v043StrategyIds.js";
import type { V043TargetImmutabilityRunResultV1 } from "../targetImmutability/index.js";

export type StageContextMetricAvailability = "available" | "unavailable" | "not-applicable";

export interface StageContextRatioMetricV1 {
  availability: StageContextMetricAvailability;
  numerator: number | null;
  denominator: number | null;
  rate: number | null;
  matchedExpectationIds: string[];
  missingExpectationIds: string[];
  reason: string | null;
}

export interface StageContextCountMetricV1 {
  availability: StageContextMetricAvailability;
  count: number | null;
  evidenceKeys: string[];
  reason: string | null;
}

export interface StageContextObservedEvidenceV1 {
  sourceArtifact: StageContextExpectationSourceArtifact;
  sourceInstance: string;
  category: StageContextExpectationCategory;
  targetKey: string;
  sourceFieldPath: string;
}

export type StageContextExpectationMatchOutcome = "matched" | "missing" | "violated";

export interface StageContextExpectationMatchV1 {
  expectationId: string;
  inclusion: StageContextExpectationInclusion;
  sourceArtifact: StageContextExpectationSourceArtifact;
  category: StageContextExpectationCategory;
  targetKey: string;
  outcome: StageContextExpectationMatchOutcome;
  matchedSourceInstances: string[];
  matchedSourceFieldPaths: string[];
}

export interface StageContextStateComparisonV1 {
  sourceArtifact: "context-capsule" | "retrieval-audit-record" | "workflow-instruction-packet" | "target-immutability";
  sourceInstance: string;
  expectationFieldPath: string;
  artifactFieldPath: string | null;
  availability: StageContextMetricAvailability;
  expected: JsonValue | null;
  actual: JsonValue | null;
  matched: boolean | null;
  reason: string | null;
}

export interface StageContextResponsibilityMappingMetricV1 {
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

export interface StageContextSizeSourceV1 {
  sourceInstance: string;
  sourceKind: "context-capsule" | "retrieval-audit-record" | "workflow-instruction-packet" | "full-workflow-library-text";
  characterCount: number;
  estimatedTokenCount: number;
}

export interface StageContextSizeMetricV1 {
  availability: "available";
  sources: StageContextSizeSourceV1[];
  totalCharacterCount: number;
  totalEstimatedTokenCount: number;
}

export interface V043StageContextEvaluationMetricsV1 {
  requiredEvidenceRecall: StageContextRatioMetricV1;
  allowedEvidenceCoverage: StageContextRatioMetricV1;
  forbiddenEvidenceInclusion: StageContextRatioMetricV1;
  irrelevantFileInclusion: StageContextCountMetricV1;
  irrelevantInstructionInclusion: StageContextCountMetricV1;
  requiredProvenanceRecall: StageContextRatioMetricV1;
  responsibilityMappingCompleteness: StageContextResponsibilityMappingMetricV1[];
  stateComparisons: StageContextStateComparisonV1[];
  contextSize: StageContextSizeMetricV1;
  consideredButUnselectedReads: StageContextCountMetricV1;
  unnecessaryReads: StageContextCountMetricV1;
  targetImmutability: StageContextCountMetricV1;
}

export interface V043StageContextEvaluationCompletedV1 {
  status: "completed";
  strategyId: V043StageContextStrategyId;
  executionStatus: "completed";
  expectationMatches: StageContextExpectationMatchV1[];
  observedEvidence: StageContextObservedEvidenceV1[];
  metrics: V043StageContextEvaluationMetricsV1;
  warnings: string[];
}

export interface V043StageContextEvaluationNotApplicableV1 {
  status: "not-applicable";
  strategyId: V043StageContextStrategyId | null;
  executionStatus: "invalid-input" | "failed" | "unavailable" | "not-applicable";
  reason: string;
}

export interface V043StageContextEvaluationFailedV1 {
  status: "failed";
  strategyId: V043StageContextStrategyId | null;
  executionStatus: V043StageContextStrategyExecutionStatus;
  reason: string;
}

export type V043StageContextEvaluationResultV1 =
  | V043StageContextEvaluationCompletedV1
  | V043StageContextEvaluationNotApplicableV1
  | V043StageContextEvaluationFailedV1;

export interface V043StageContextEvaluationContextV1 {
  targetImmutability?: V043TargetImmutabilityRunResultV1;
}
