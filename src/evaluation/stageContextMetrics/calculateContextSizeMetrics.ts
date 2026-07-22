import type {
  ArchitectureContextOnlyExecutionPayloadV1,
  ArchitecturePlusImplementationAndTestRefreshExecutionPayloadV1,
  ArchitecturePlusImplementationRefreshExecutionPayloadV1,
  BoundedWorkflowInstructionPacketExecutionPayloadV1,
  CombinedBoundedStageContextExecutionPayloadV1,
  FullWorkflowLibraryExecutionPayloadV1,
  LoadedContextArtifactPairV1,
  V043StageContextStrategyExecutionSuccess
} from "../../experiments/plugins/contextStrategyComparison/v043StrategyExecutionTypes.js";
import type { StageContextSizeMetricV1, StageContextSizeSourceV1 } from "./types.js";

function estimateTokens(characterCount: number): number {
  return Math.ceil(characterCount / 4);
}

function pairSources(pair: LoadedContextArtifactPairV1, labelPrefix: string): StageContextSizeSourceV1[] {
  const sources: StageContextSizeSourceV1[] = [];
  const capsuleCharacterCount = JSON.stringify(pair.contextCapsule).length;
  sources.push({
    sourceInstance: `${labelPrefix}.contextCapsule`,
    sourceKind: "context-capsule",
    characterCount: capsuleCharacterCount,
    estimatedTokenCount: estimateTokens(capsuleCharacterCount)
  });
  if (pair.retrievalAuditRecord) {
    const auditCharacterCount = JSON.stringify(pair.retrievalAuditRecord).length;
    sources.push({
      sourceInstance: `${labelPrefix}.retrievalAuditRecord`,
      sourceKind: "retrieval-audit-record",
      characterCount: auditCharacterCount,
      estimatedTokenCount: estimateTokens(auditCharacterCount)
    });
  }
  return sources;
}

export function calculateV043ExecutionContextSize(execution: V043StageContextStrategyExecutionSuccess): StageContextSizeMetricV1 {
  const sources: StageContextSizeSourceV1[] = [];

  switch (execution.strategyId) {
    case "architecture-context-only": {
      const payload = execution.payload as ArchitectureContextOnlyExecutionPayloadV1;
      sources.push(...pairSources(payload.architecture, "architecture"));
      break;
    }
    case "architecture-plus-implementation-refresh": {
      const payload = execution.payload as ArchitecturePlusImplementationRefreshExecutionPayloadV1;
      sources.push(...pairSources(payload.architecture, "architecture"));
      sources.push(...pairSources(payload.implementation, "implementation"));
      break;
    }
    case "architecture-plus-implementation-and-test-refresh": {
      const payload = execution.payload as ArchitecturePlusImplementationAndTestRefreshExecutionPayloadV1;
      sources.push(...pairSources(payload.architecture, "architecture"));
      sources.push(...pairSources(payload.implementation, "implementation"));
      sources.push(...pairSources(payload.testImplementation, "testImplementation"));
      break;
    }
    case "full-workflow-library": {
      const payload = execution.payload as FullWorkflowLibraryExecutionPayloadV1;
      const characterCount = payload.fullWorkflowLibrary.rawText.length;
      sources.push({
        sourceInstance: "fullWorkflowLibrary.rawText",
        sourceKind: "full-workflow-library-text",
        characterCount,
        estimatedTokenCount: estimateTokens(characterCount)
      });
      break;
    }
    case "bounded-workflow-instruction-packet": {
      const payload = execution.payload as BoundedWorkflowInstructionPacketExecutionPayloadV1;
      const characterCount = JSON.stringify(payload.workflowInstructionPacket).length;
      sources.push({
        sourceInstance: "workflowInstructionPacket",
        sourceKind: "workflow-instruction-packet",
        characterCount,
        estimatedTokenCount: estimateTokens(characterCount)
      });
      break;
    }
    case "combined-bounded-stage-context": {
      const payload = execution.payload as CombinedBoundedStageContextExecutionPayloadV1;
      payload.contextArtifacts.forEach((pair, index) => {
        sources.push(...pairSources(pair, `contextArtifacts[${index}]`));
      });
      const characterCount = JSON.stringify(payload.workflowInstructionPacket).length;
      sources.push({
        sourceInstance: "workflowInstructionPacket",
        sourceKind: "workflow-instruction-packet",
        characterCount,
        estimatedTokenCount: estimateTokens(characterCount)
      });
      break;
    }
  }

  const totalCharacterCount = sources.reduce((sum, source) => sum + source.characterCount, 0);
  const totalEstimatedTokenCount = sources.reduce((sum, source) => sum + source.estimatedTokenCount, 0);

  return { availability: "available", sources, totalCharacterCount, totalEstimatedTokenCount };
}
