import type {
  ContextCapsule,
  ContextRole,
  ImplementationContextPacketV1,
  ImplementationContextRetrievalReportV1,
  OrchestratorContextReadinessResultV1,
  RetrievalAuditRecord,
  TestContextPacketV1,
  TestContextRetrievalReportV1,
  WorkflowInstructionPacket
} from "../../../evaluation/upstreamArtifacts/index.js";
import type { MyDevKitContextArtifactConsistencyResult } from "../../../evaluation/stageContextSelectors/index.js";
import type { StageContextExpectationFixtureV1 } from "../../../evaluation/stageContextExpectations/index.js";
import type { FullWorkflowLibraryFixtureV1 } from "./v043FullWorkflowLibraryFixture.js";
import type { V043StageContextStrategyId } from "./v043StrategyIds.js";
import type { V043StageContextStrategyInputV1 } from "./v043StrategyInputContracts.js";

export type V043StageContextStrategyExecutionStatus = "completed" | "unavailable" | "not-applicable" | "invalid-input" | "failed";

export type V043StageContextStrategyExecutionIssueCode =
  | "INVALID_STRATEGY_INPUT"
  | "EXPECTATION_READ_FAILED"
  | "CONTEXT_CAPSULE_READ_FAILED"
  | "RETRIEVAL_AUDIT_READ_FAILED"
  | "WORKFLOW_PACKET_READ_FAILED"
  | "FULL_WORKFLOW_LIBRARY_READ_FAILED"
  | "CONTEXT_ROLE_MISMATCH"
  | "CONTEXT_ARTIFACT_INCONSISTENT"
  | "IMPLEMENTATION_CONTEXT_PACKET_READ_FAILED"
  | "IMPLEMENTATION_CONTEXT_RETRIEVAL_REPORT_READ_FAILED"
  | "TEST_CONTEXT_PACKET_READ_FAILED"
  | "TEST_CONTEXT_RETRIEVAL_REPORT_READ_FAILED"
  | "READINESS_INPUT_INVALID"
  | "UNEXPECTED_EXECUTION_ERROR";

export interface V043StageContextStrategyExecutionIssue {
  code: V043StageContextStrategyExecutionIssueCode;
  fieldPath: string;
  message: string;
  sourcePath?: string;
  details?: unknown;
}

export interface LoadedContextArtifactPairV1 {
  role: ContextRole;
  contextCapsuleSourcePath: string;
  contextCapsule: ContextCapsule;
  retrievalAuditRecordSourcePath?: string;
  retrievalAuditRecord?: RetrievalAuditRecord;
  consistency?: MyDevKitContextArtifactConsistencyResult;
}

export interface ArchitectureContextOnlyExecutionPayloadV1 {
  architecture: LoadedContextArtifactPairV1;
}

export interface ArchitecturePlusImplementationRefreshExecutionPayloadV1 {
  architecture: LoadedContextArtifactPairV1;
  implementation: LoadedContextArtifactPairV1;
}

export interface ArchitecturePlusImplementationAndTestRefreshExecutionPayloadV1 {
  architecture: LoadedContextArtifactPairV1;
  implementation: LoadedContextArtifactPairV1;
  testImplementation: LoadedContextArtifactPairV1;
}

export interface FullWorkflowLibraryExecutionPayloadV1 {
  fullWorkflowLibrarySourcePath: string;
  fullWorkflowLibrary: FullWorkflowLibraryFixtureV1;
}

export interface BoundedWorkflowInstructionPacketExecutionPayloadV1 {
  workflowInstructionPacketSourcePath: string;
  workflowInstructionPacket: WorkflowInstructionPacket;
}

// v0.4.4 Batch 3: producer-readiness bridge payload. Every field is optional -- an
// existing v0.4.3 combined-bounded-stage-context input supplies none of them, and the
// bridge evaluator (evaluateProducerReadinessBridge) reports each dependent metric
// unavailable/not-applicable rather than requiring dummy artifacts.
export interface CombinedBoundedStageContextExecutionPayloadV1 {
  contextArtifacts: LoadedContextArtifactPairV1[];
  workflowInstructionPacketSourcePath: string;
  workflowInstructionPacket: WorkflowInstructionPacket;
  implementationContextPacketSourcePath?: string;
  implementationContextPacket?: ImplementationContextPacketV1;
  implementationContextRetrievalReportSourcePath?: string;
  implementationContextRetrievalReport?: ImplementationContextRetrievalReportV1;
  testContextPacketSourcePath?: string;
  testContextPacket?: TestContextPacketV1;
  testContextRetrievalReportSourcePath?: string;
  testContextRetrievalReport?: TestContextRetrievalReportV1;
  readiness?: OrchestratorContextReadinessResultV1;
}

export interface V043StageContextStrategyExecutionSuccess {
  status: "completed";
  strategyId: V043StageContextStrategyId;
  input: V043StageContextStrategyInputV1;
  expectationsSourcePath: string;
  expectations: StageContextExpectationFixtureV1;
  payload:
    | ArchitectureContextOnlyExecutionPayloadV1
    | ArchitecturePlusImplementationRefreshExecutionPayloadV1
    | ArchitecturePlusImplementationAndTestRefreshExecutionPayloadV1
    | FullWorkflowLibraryExecutionPayloadV1
    | BoundedWorkflowInstructionPacketExecutionPayloadV1
    | CombinedBoundedStageContextExecutionPayloadV1;
  warnings: string[];
}

export interface V043StageContextStrategyExecutionInvalidInput {
  status: "invalid-input";
  strategyId: V043StageContextStrategyId | null;
  input: unknown;
  issues: V043StageContextStrategyExecutionIssue[];
}

export interface V043StageContextStrategyExecutionFailed {
  status: "failed";
  strategyId: V043StageContextStrategyId | null;
  input: unknown;
  issues: V043StageContextStrategyExecutionIssue[];
}

export type V043StageContextStrategyExecutionResult =
  | V043StageContextStrategyExecutionSuccess
  | V043StageContextStrategyExecutionInvalidInput
  | V043StageContextStrategyExecutionFailed;
