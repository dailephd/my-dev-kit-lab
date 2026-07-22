import type {
  ArchitectureContextOnlyExecutionPayloadV1,
  ArchitecturePlusImplementationAndTestRefreshExecutionPayloadV1,
  ArchitecturePlusImplementationRefreshExecutionPayloadV1,
  BoundedWorkflowInstructionPacketExecutionPayloadV1,
  CombinedBoundedStageContextExecutionPayloadV1,
  FullWorkflowLibraryExecutionPayloadV1,
  LoadedContextArtifactPairV1,
  V043StageContextStrategyExecutionResult,
  V043StageContextStrategyExecutionSuccess
} from "../../experiments/plugins/contextStrategyComparison/v043StrategyExecutionTypes.js";
import { collectContextCapsuleEvidence } from "./collectContextCapsuleEvidence.js";
import { collectRetrievalAuditEvidence } from "./collectRetrievalAuditEvidence.js";
import { collectFullWorkflowLibraryEvidence, collectWorkflowInstructionPacketEvidence } from "./collectWorkflowInstructionEvidence.js";
import { matchStageContextExpectations } from "./matchStageContextExpectations.js";
import {
  calculateAllowedEvidenceCoverage,
  calculateForbiddenEvidenceInclusion,
  calculateIrrelevantFileInclusion,
  calculateIrrelevantInstructionInclusion,
  calculateRequiredEvidenceRecall,
  calculateRequiredProvenanceRecall
} from "./calculateExpectationMetrics.js";
import {
  calculateContextCapsuleResponsibilityMappingMetric,
  calculateRetrievalAuditResponsibilityMappingMetric
} from "./calculateResponsibilityMappingMetrics.js";
import {
  compareExpectedContextCapsuleState,
  compareExpectedRetrievalAuditState,
  compareExpectedTargetImmutabilityState,
  compareExpectedWorkflowInstructionPacketState
} from "./calculateArtifactStateMetrics.js";
import { calculateV043ExecutionContextSize } from "./calculateContextSizeMetrics.js";
import type {
  StageContextCountMetricV1,
  StageContextObservedEvidenceV1,
  StageContextResponsibilityMappingMetricV1,
  StageContextStateComparisonV1,
  V043StageContextEvaluationContextV1,
  V043StageContextEvaluationMetricsV1,
  V043StageContextEvaluationResultV1
} from "./types.js";
import type { V043TargetImmutabilityRunResultV1 } from "../targetImmutability/index.js";

function collectExecutionEvidence(execution: V043StageContextStrategyExecutionSuccess): StageContextObservedEvidenceV1[] {
  const evidence: StageContextObservedEvidenceV1[] = [];

  function pushPairEvidence(pair: LoadedContextArtifactPairV1, labelPrefix: string): void {
    evidence.push(...collectContextCapsuleEvidence(pair.contextCapsule, `${labelPrefix}.contextCapsule`));
    if (pair.retrievalAuditRecord) {
      evidence.push(...collectRetrievalAuditEvidence(pair.retrievalAuditRecord, `${labelPrefix}.retrievalAuditRecord`));
    }
  }

  switch (execution.strategyId) {
    case "architecture-context-only": {
      const payload = execution.payload as ArchitectureContextOnlyExecutionPayloadV1;
      pushPairEvidence(payload.architecture, "architecture");
      break;
    }
    case "architecture-plus-implementation-refresh": {
      const payload = execution.payload as ArchitecturePlusImplementationRefreshExecutionPayloadV1;
      pushPairEvidence(payload.architecture, "architecture");
      pushPairEvidence(payload.implementation, "implementation");
      break;
    }
    case "architecture-plus-implementation-and-test-refresh": {
      const payload = execution.payload as ArchitecturePlusImplementationAndTestRefreshExecutionPayloadV1;
      pushPairEvidence(payload.architecture, "architecture");
      pushPairEvidence(payload.implementation, "implementation");
      pushPairEvidence(payload.testImplementation, "testImplementation");
      break;
    }
    case "full-workflow-library": {
      const payload = execution.payload as FullWorkflowLibraryExecutionPayloadV1;
      evidence.push(...collectFullWorkflowLibraryEvidence(payload.fullWorkflowLibrary, "fullWorkflowLibrary"));
      break;
    }
    case "bounded-workflow-instruction-packet": {
      const payload = execution.payload as BoundedWorkflowInstructionPacketExecutionPayloadV1;
      evidence.push(...collectWorkflowInstructionPacketEvidence(payload.workflowInstructionPacket, "workflowInstructionPacket"));
      break;
    }
    case "combined-bounded-stage-context": {
      const payload = execution.payload as CombinedBoundedStageContextExecutionPayloadV1;
      payload.contextArtifacts.forEach((pair, index) => {
        pushPairEvidence(pair, `contextArtifacts[${index}]`);
      });
      evidence.push(...collectWorkflowInstructionPacketEvidence(payload.workflowInstructionPacket, "workflowInstructionPacket"));
      break;
    }
  }

  return evidence;
}

function collectResponsibilityMetrics(
  execution: V043StageContextStrategyExecutionSuccess
): StageContextResponsibilityMappingMetricV1[] {
  const metrics: StageContextResponsibilityMappingMetricV1[] = [];

  function pushPairMetrics(pair: LoadedContextArtifactPairV1, labelPrefix: string): void {
    metrics.push(calculateContextCapsuleResponsibilityMappingMetric(pair.contextCapsule, `${labelPrefix}.contextCapsule`));
    if (pair.retrievalAuditRecord) {
      metrics.push(
        calculateRetrievalAuditResponsibilityMappingMetric(pair.retrievalAuditRecord, `${labelPrefix}.retrievalAuditRecord`)
      );
    }
  }

  switch (execution.strategyId) {
    case "architecture-context-only": {
      const payload = execution.payload as ArchitectureContextOnlyExecutionPayloadV1;
      pushPairMetrics(payload.architecture, "architecture");
      break;
    }
    case "architecture-plus-implementation-refresh": {
      const payload = execution.payload as ArchitecturePlusImplementationRefreshExecutionPayloadV1;
      pushPairMetrics(payload.architecture, "architecture");
      pushPairMetrics(payload.implementation, "implementation");
      break;
    }
    case "architecture-plus-implementation-and-test-refresh": {
      const payload = execution.payload as ArchitecturePlusImplementationAndTestRefreshExecutionPayloadV1;
      pushPairMetrics(payload.architecture, "architecture");
      pushPairMetrics(payload.implementation, "implementation");
      pushPairMetrics(payload.testImplementation, "testImplementation");
      break;
    }
    case "combined-bounded-stage-context": {
      const payload = execution.payload as CombinedBoundedStageContextExecutionPayloadV1;
      payload.contextArtifacts.forEach((pair, index) => {
        pushPairMetrics(pair, `contextArtifacts[${index}]`);
      });
      break;
    }
    case "full-workflow-library":
    case "bounded-workflow-instruction-packet":
      break;
  }

  return metrics;
}

function buildTargetImmutabilityMetric(
  targetImmutability: V043TargetImmutabilityRunResultV1 | undefined
): StageContextCountMetricV1 {
  if (targetImmutability === undefined) {
    return {
      availability: "unavailable",
      count: null,
      evidenceKeys: [],
      reason: "Target immutability configuration was not supplied for this strategy run."
    };
  }
  if (targetImmutability.availability === "unavailable") {
    return {
      availability: "unavailable",
      count: null,
      evidenceKeys: [],
      reason: targetImmutability.reason
    };
  }
  return {
    availability: "available",
    count: targetImmutability.comparison.newMutationCount,
    evidenceKeys: targetImmutability.comparison.mutations.map((mutation) => mutation.id),
    reason: null
  };
}

function collectStateComparisons(
  execution: V043StageContextStrategyExecutionSuccess,
  targetImmutability: V043TargetImmutabilityRunResultV1 | undefined
): StageContextStateComparisonV1[] {
  const expectedStates = execution.expectations.expectedStates;
  const comparisons: StageContextStateComparisonV1[] = [];

  function pushPairComparisons(pair: LoadedContextArtifactPairV1, labelPrefix: string): void {
    comparisons.push(
      ...compareExpectedContextCapsuleState(expectedStates.contextCapsule, pair.contextCapsule, `${labelPrefix}.contextCapsule`)
    );
    if (pair.retrievalAuditRecord) {
      comparisons.push(
        ...compareExpectedRetrievalAuditState(
          expectedStates.retrievalAuditRecord,
          pair.retrievalAuditRecord,
          `${labelPrefix}.retrievalAuditRecord`
        )
      );
    }
  }

  switch (execution.strategyId) {
    case "architecture-context-only": {
      const payload = execution.payload as ArchitectureContextOnlyExecutionPayloadV1;
      pushPairComparisons(payload.architecture, "architecture");
      break;
    }
    case "architecture-plus-implementation-refresh": {
      const payload = execution.payload as ArchitecturePlusImplementationRefreshExecutionPayloadV1;
      pushPairComparisons(payload.architecture, "architecture");
      pushPairComparisons(payload.implementation, "implementation");
      break;
    }
    case "architecture-plus-implementation-and-test-refresh": {
      const payload = execution.payload as ArchitecturePlusImplementationAndTestRefreshExecutionPayloadV1;
      pushPairComparisons(payload.architecture, "architecture");
      pushPairComparisons(payload.implementation, "implementation");
      pushPairComparisons(payload.testImplementation, "testImplementation");
      break;
    }
    case "full-workflow-library":
      break;
    case "bounded-workflow-instruction-packet": {
      const payload = execution.payload as BoundedWorkflowInstructionPacketExecutionPayloadV1;
      comparisons.push(
        ...compareExpectedWorkflowInstructionPacketState(
          expectedStates.workflowInstructionPacket,
          payload.workflowInstructionPacket,
          "workflowInstructionPacket"
        )
      );
      break;
    }
    case "combined-bounded-stage-context": {
      const payload = execution.payload as CombinedBoundedStageContextExecutionPayloadV1;
      payload.contextArtifacts.forEach((pair, index) => {
        pushPairComparisons(pair, `contextArtifacts[${index}]`);
      });
      comparisons.push(
        ...compareExpectedWorkflowInstructionPacketState(
          expectedStates.workflowInstructionPacket,
          payload.workflowInstructionPacket,
          "workflowInstructionPacket"
        )
      );
      break;
    }
  }

  comparisons.push(...compareExpectedTargetImmutabilityState(expectedStates.targetImmutability, targetImmutability));

  return comparisons;
}

export function evaluateV043StageContextExecution(
  execution: V043StageContextStrategyExecutionResult,
  context?: V043StageContextEvaluationContextV1
): V043StageContextEvaluationResultV1 {
  try {
    if (execution.status === "invalid-input") {
      return {
        status: "not-applicable",
        strategyId: execution.strategyId,
        executionStatus: "invalid-input",
        reason: "Metrics are not applicable because strategy input validation failed."
      };
    }
    if (execution.status === "failed") {
      return {
        status: "not-applicable",
        strategyId: execution.strategyId,
        executionStatus: "failed",
        reason: "Metrics are not applicable because strategy execution failed."
      };
    }

    const status = execution.status as string;
    if (status === "unavailable") {
      return {
        status: "not-applicable",
        strategyId: execution.strategyId,
        executionStatus: "unavailable",
        reason: "Metrics are not applicable because strategy execution is unavailable."
      };
    }
    if (status === "not-applicable") {
      return {
        status: "not-applicable",
        strategyId: execution.strategyId,
        executionStatus: "not-applicable",
        reason: "Metrics are not applicable to this strategy execution."
      };
    }

    const observedEvidence = collectExecutionEvidence(execution);
    const expectationMatches = matchStageContextExpectations(execution.expectations, observedEvidence);

    const metrics: V043StageContextEvaluationMetricsV1 = {
      requiredEvidenceRecall: calculateRequiredEvidenceRecall(expectationMatches),
      allowedEvidenceCoverage: calculateAllowedEvidenceCoverage(expectationMatches),
      forbiddenEvidenceInclusion: calculateForbiddenEvidenceInclusion(expectationMatches),
      irrelevantFileInclusion: calculateIrrelevantFileInclusion(execution.expectations, observedEvidence),
      irrelevantInstructionInclusion: calculateIrrelevantInstructionInclusion(execution.expectations, observedEvidence),
      requiredProvenanceRecall: calculateRequiredProvenanceRecall(expectationMatches),
      responsibilityMappingCompleteness: collectResponsibilityMetrics(execution),
      stateComparisons: collectStateComparisons(execution, context?.targetImmutability),
      contextSize: calculateV043ExecutionContextSize(execution),
      consideredButUnselectedReads: {
        availability: "unavailable",
        count: null,
        evidenceKeys: [],
        reason: "The published upstream artifacts do not expose considered-but-unselected reads."
      },
      unnecessaryReads: {
        availability: "unavailable",
        count: null,
        evidenceKeys: [],
        reason: "The published upstream artifacts do not expose unnecessary-read evidence."
      },
      targetImmutability: buildTargetImmutabilityMetric(context?.targetImmutability)
    };

    return {
      status: "completed",
      strategyId: execution.strategyId,
      executionStatus: "completed",
      expectationMatches,
      observedEvidence,
      metrics,
      warnings: []
    };
  } catch {
    return {
      status: "failed",
      strategyId: execution.strategyId,
      executionStatus: execution.status,
      reason: "Unexpected v0.4.3 stage-context metric evaluation failure."
    };
  }
}
