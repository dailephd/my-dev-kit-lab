import type { V043TargetImmutabilityConfigV1, V043TargetImmutabilityRunResultV1 } from "../../../evaluation/targetImmutability/index.js";
import type { StageContextDeterminismResultV1 } from "../../../evaluation/stageContextDeterminism/index.js";
import type { V043StageContextEvaluationResultV1 } from "../../../evaluation/stageContextMetrics/index.js";
import type { V043StageContextStrategyExecutionResult, V043StageContextStrategyExecutionStatus } from "./v043StrategyExecutionTypes.js";
import type { V043StageContextStrategyId } from "./v043StrategyIds.js";

export interface V043RunAssuranceConfigV1 {
  repeatCount?: number;
  targetImmutability?: V043TargetImmutabilityConfigV1;
}

export interface ResolvedV043RunAssuranceConfigV1 {
  repeatCount: number;
  targetImmutability?: V043TargetImmutabilityConfigV1;
}

export type V043StageContextRunAssuranceStatus = "passed" | "failed" | "not-applicable";

export type V043StageContextRunAssuranceIssueCode =
  | "EXECUTION_NOT_COMPLETED"
  | "EVALUATION_NOT_COMPLETED"
  | "TARGET_SNAPSHOT_UNAVAILABLE"
  | "TARGET_MUTATION_DETECTED"
  | "DETERMINISM_UNAVAILABLE"
  | "NONDETERMINISTIC_RESULT"
  | "UNEXPECTED_ASSURANCE_ERROR";

export interface V043StageContextRunAssuranceIssue {
  code: V043StageContextRunAssuranceIssueCode;
  runNumber: number | null;
  fieldPath: string;
  message: string;
  details?: unknown;
}

export interface V043StageContextAssuranceRunRecordV1 {
  runNumber: number;
  executionStatus: V043StageContextStrategyExecutionStatus;
  evaluationStatus: "completed" | "not-applicable" | "failed";
  targetImmutability: V043TargetImmutabilityRunResultV1;
}

export interface V043StageContextRunAssuranceResultV1 {
  strategyId: V043StageContextStrategyId;
  status: V043StageContextRunAssuranceStatus;
  repeatCount: number;
  primaryExecution: V043StageContextStrategyExecutionResult;
  primaryEvaluation: V043StageContextEvaluationResultV1;
  runRecords: V043StageContextAssuranceRunRecordV1[];
  determinism: StageContextDeterminismResultV1;
  issues: V043StageContextRunAssuranceIssue[];
}
