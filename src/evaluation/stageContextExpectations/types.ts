import type { ContextAdequacyStatus, FreshnessState } from "../upstreamArtifacts/index.js";

export type StageContextExpectationInclusion = "required" | "allowed" | "forbidden";

export type StageContextExpectationSourceArtifact =
  | "context-capsule"
  | "retrieval-audit-record"
  | "workflow-instruction-packet"
  | "full-workflow-library";

export type StageContextExpectationCategory =
  | "file"
  | "symbol"
  | "source-range"
  | "contract"
  | "validator"
  | "constant"
  | "error"
  | "schema-or-serializer"
  | "production-responsibility"
  | "test-file"
  | "fixture"
  | "factory"
  | "mock"
  | "setup-file"
  | "test-configuration"
  | "package-script"
  | "test-command"
  | "workflow"
  | "stage"
  | "command"
  | "rule"
  | "report-contract"
  | "provenance";

export type StageContextPathExpectationCategory =
  | "file"
  | "test-file"
  | "fixture"
  | "factory"
  | "mock"
  | "setup-file"
  | "test-configuration";

export interface StageContextPathExpectationV1 {
  expectationId: string;
  inclusion: StageContextExpectationInclusion;
  sourceArtifact: "context-capsule";
  category: StageContextPathExpectationCategory;
  match: {
    path: string;
  };
  notes: string[];
}

export type StageContextSymbolExpectationCategory =
  | "symbol"
  | "contract"
  | "validator"
  | "constant"
  | "error"
  | "schema-or-serializer";

export interface StageContextSymbolExpectationV1 {
  expectationId: string;
  inclusion: StageContextExpectationInclusion;
  sourceArtifact: "context-capsule";
  category: StageContextSymbolExpectationCategory;
  match: {
    symbolId: string;
  };
  notes: string[];
}

export interface StageContextSourceRangeExpectationV1 {
  expectationId: string;
  inclusion: StageContextExpectationInclusion;
  sourceArtifact: "context-capsule";
  category: "source-range";
  match: {
    filePath: string;
    startLine: number;
    endLine: number;
  };
  notes: string[];
}

export interface StageContextProductionResponsibilityExpectationV1 {
  expectationId: string;
  inclusion: StageContextExpectationInclusion;
  sourceArtifact: "context-capsule" | "retrieval-audit-record";
  category: "production-responsibility";
  match: {
    responsibilityId: string;
  };
  notes: string[];
}

export interface StageContextPackageScriptExpectationV1 {
  expectationId: string;
  inclusion: StageContextExpectationInclusion;
  sourceArtifact: "context-capsule";
  category: "package-script";
  match: {
    name: string;
  };
  notes: string[];
}

export interface StageContextTestCommandExpectationV1 {
  expectationId: string;
  inclusion: StageContextExpectationInclusion;
  sourceArtifact: "context-capsule";
  category: "test-command";
  match: {
    commandText: string;
  };
  notes: string[];
}

export type StageContextWorkflowStableIdCategory = "workflow" | "stage" | "command" | "rule" | "report-contract";

export interface StageContextWorkflowStableIdExpectationV1 {
  expectationId: string;
  inclusion: StageContextExpectationInclusion;
  sourceArtifact: "workflow-instruction-packet" | "full-workflow-library";
  category: StageContextWorkflowStableIdCategory;
  match: {
    id: string;
  };
  notes: string[];
}

export interface StageContextProvenanceExpectationV1 {
  expectationId: string;
  inclusion: StageContextExpectationInclusion;
  sourceArtifact:
    | "context-capsule"
    | "retrieval-audit-record"
    | "workflow-instruction-packet"
    | "full-workflow-library";
  category: "provenance";
  match: {
    evidenceId: string;
  };
  notes: string[];
}

export type StageContextExpectationItemV1 =
  | StageContextPathExpectationV1
  | StageContextSymbolExpectationV1
  | StageContextSourceRangeExpectationV1
  | StageContextProductionResponsibilityExpectationV1
  | StageContextPackageScriptExpectationV1
  | StageContextTestCommandExpectationV1
  | StageContextWorkflowStableIdExpectationV1
  | StageContextProvenanceExpectationV1;

export interface ExpectedMyDevKitContextArtifactStateV1 {
  contextAdequacyStatus?: ContextAdequacyStatus;
  roleAdequacyStatus?: ContextAdequacyStatus;
  freshnessState?: FreshnessState;
  truncated?: boolean;
  fullFileFallbackUsed?: number;
  unresolvedItemIds?: string[];
  warningCount?: number;
}

export interface ExpectedWorkflowInstructionPacketStateV1 {
  adequacyStatus?: "adequate" | "inadequate";
  truncated?: boolean;
  unresolvedReferences?: string[];
  warningCount?: number;
}

export interface ExpectedTargetImmutabilityStateV1 {
  newMutationCount: number;
}

export interface StageContextExpectedStatesV1 {
  contextCapsule?: ExpectedMyDevKitContextArtifactStateV1;
  retrievalAuditRecord?: ExpectedMyDevKitContextArtifactStateV1;
  workflowInstructionPacket?: ExpectedWorkflowInstructionPacketStateV1;
  targetImmutability?: ExpectedTargetImmutabilityStateV1;
}

export interface StageContextExpectationFixtureV1 {
  schemaVersion: string;
  caseId: string;
  title: string;
  description: string;
  expectedEvidence: StageContextExpectationItemV1[];
  expectedStates: StageContextExpectedStatesV1;
  warnings: string[];
}
