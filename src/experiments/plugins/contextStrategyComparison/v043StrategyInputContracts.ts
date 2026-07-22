import type { ContextRole } from "../../../evaluation/upstreamArtifacts/index.js";

export interface ArchitectureContextOnlyStrategyInputV1 {
  strategyId: "architecture-context-only";
  expectationsPath: string;
  architectureContextCapsulePath: string;
  architectureRetrievalAuditRecordPath?: string;
}

export interface ArchitecturePlusImplementationRefreshStrategyInputV1 {
  strategyId: "architecture-plus-implementation-refresh";
  expectationsPath: string;
  architectureContextCapsulePath: string;
  architectureRetrievalAuditRecordPath?: string;
  implementationContextCapsulePath: string;
  implementationRetrievalAuditRecordPath?: string;
}

export interface ArchitecturePlusImplementationAndTestRefreshStrategyInputV1 {
  strategyId: "architecture-plus-implementation-and-test-refresh";
  expectationsPath: string;
  architectureContextCapsulePath: string;
  architectureRetrievalAuditRecordPath?: string;
  implementationContextCapsulePath: string;
  implementationRetrievalAuditRecordPath?: string;
  testImplementationContextCapsulePath: string;
  testImplementationRetrievalAuditRecordPath?: string;
}

export interface FullWorkflowLibraryStrategyInputV1 {
  strategyId: "full-workflow-library";
  expectationsPath: string;
  fullWorkflowLibraryFixturePath: string;
}

export interface BoundedWorkflowInstructionPacketStrategyInputV1 {
  strategyId: "bounded-workflow-instruction-packet";
  expectationsPath: string;
  workflowInstructionPacketPath: string;
}

export interface CombinedBoundedStageContextArtifactInputV1 {
  role: ContextRole;
  contextCapsulePath: string;
  retrievalAuditRecordPath?: string;
}

export interface CombinedBoundedStageContextStrategyInputV1 {
  strategyId: "combined-bounded-stage-context";
  expectationsPath: string;
  contextArtifacts: CombinedBoundedStageContextArtifactInputV1[];
  workflowInstructionPacketPath: string;
}

export type V043StageContextStrategyInputV1 =
  | ArchitectureContextOnlyStrategyInputV1
  | ArchitecturePlusImplementationRefreshStrategyInputV1
  | ArchitecturePlusImplementationAndTestRefreshStrategyInputV1
  | FullWorkflowLibraryStrategyInputV1
  | BoundedWorkflowInstructionPacketStrategyInputV1
  | CombinedBoundedStageContextStrategyInputV1;
