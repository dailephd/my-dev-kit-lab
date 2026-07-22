import { captureTargetSnapshot, compareTargetSnapshots } from "../../../evaluation/targetImmutability/index.js";
import type { V043TargetImmutabilityConfigV1, V043TargetImmutabilityRunResultV1 } from "../../../evaluation/targetImmutability/index.js";
import { calculateStageContextDeterminism } from "../../../evaluation/stageContextDeterminism/index.js";
import type { StageContextDeterminismCandidateV1, StageContextDeterminismResultV1 } from "../../../evaluation/stageContextDeterminism/index.js";
import { evaluateV043StageContextExecution } from "../../../evaluation/stageContextMetrics/index.js";
import type { V043StageContextEvaluationResultV1 } from "../../../evaluation/stageContextMetrics/index.js";
import { executeV043StageContextStrategy } from "./executeV043StageContextStrategy.js";
import type { V043StageContextStrategyExecutionResult } from "./v043StrategyExecutionTypes.js";
import type { V043StageContextStrategyInputV1 } from "./v043StrategyInputContracts.js";
import type {
  ResolvedV043RunAssuranceConfigV1,
  V043StageContextAssuranceRunRecordV1,
  V043StageContextRunAssuranceIssue,
  V043StageContextRunAssuranceResultV1,
  V043StageContextRunAssuranceStatus
} from "./v043RunAssuranceTypes.js";

async function buildRunWithTargetImmutability(
  targetConfig: V043TargetImmutabilityConfigV1 | undefined,
  input: V043StageContextStrategyInputV1
): Promise<{ execution: V043StageContextStrategyExecutionResult; targetImmutability: V043TargetImmutabilityRunResultV1 }> {
  if (targetConfig === undefined) {
    const execution = await executeV043StageContextStrategy(input);
    return {
      execution,
      targetImmutability: {
        availability: "unavailable",
        comparison: null,
        reason: "Target immutability configuration was not supplied for this strategy run."
      }
    };
  }

  const beforeResult = await captureTargetSnapshot(targetConfig);
  const execution = await executeV043StageContextStrategy(input);
  const afterResult = await captureTargetSnapshot(targetConfig);

  if (!beforeResult.ok && !afterResult.ok) {
    return {
      execution,
      targetImmutability: {
        availability: "unavailable",
        comparison: null,
        reason: "Target immutability could not be evaluated because a target snapshot failed.",
        beforeFailure: beforeResult,
        afterFailure: afterResult
      }
    };
  }
  if (!beforeResult.ok) {
    return {
      execution,
      targetImmutability: {
        availability: "unavailable",
        comparison: null,
        reason: "Target immutability could not be evaluated because a target snapshot failed.",
        beforeFailure: beforeResult
      }
    };
  }
  if (!afterResult.ok) {
    return {
      execution,
      targetImmutability: {
        availability: "unavailable",
        comparison: null,
        reason: "Target immutability could not be evaluated because a target snapshot failed.",
        afterFailure: afterResult
      }
    };
  }

  const comparison = compareTargetSnapshots(beforeResult.snapshot, afterResult.snapshot);
  return {
    execution,
    targetImmutability: { availability: "available", comparison, reason: null }
  };
}

function computeStatus(
  issues: V043StageContextRunAssuranceIssue[],
  config: ResolvedV043RunAssuranceConfigV1
): V043StageContextRunAssuranceStatus {
  if (issues.length > 0) return "failed";
  const anyCheckApplies = config.targetImmutability !== undefined || config.repeatCount > 1;
  return anyCheckApplies ? "passed" : "not-applicable";
}

export async function runV043StageContextStrategyWithAssurance(
  input: V043StageContextStrategyInputV1,
  config: ResolvedV043RunAssuranceConfigV1
): Promise<V043StageContextRunAssuranceResultV1> {
  const runRecords: V043StageContextAssuranceRunRecordV1[] = [];
  const determinismCandidates: StageContextDeterminismCandidateV1[] = [];
  const issues: V043StageContextRunAssuranceIssue[] = [];
  let primaryExecution: V043StageContextStrategyExecutionResult | undefined;
  let primaryEvaluation: V043StageContextEvaluationResultV1 | undefined;

  try {
    for (let runNumber = 1; runNumber <= config.repeatCount; runNumber += 1) {
      const { execution, targetImmutability } = await buildRunWithTargetImmutability(config.targetImmutability, input);
      const evaluation = evaluateV043StageContextExecution(execution, { targetImmutability });

      if (runNumber === 1) {
        primaryExecution = execution;
        primaryEvaluation = evaluation;
      }

      runRecords.push({
        runNumber,
        executionStatus: execution.status,
        evaluationStatus: evaluation.status,
        targetImmutability
      });

      determinismCandidates.push({
        runNumber,
        value: { execution, evaluation, targetImmutability }
      });

      if (execution.status !== "completed") {
        issues.push({
          code: "EXECUTION_NOT_COMPLETED",
          runNumber,
          fieldPath: `runs[${runNumber}].execution.status`,
          message: "Strategy execution did not complete successfully."
        });
      }
      if (evaluation.status !== "completed") {
        issues.push({
          code: "EVALUATION_NOT_COMPLETED",
          runNumber,
          fieldPath: `runs[${runNumber}].evaluation.status`,
          message: "Stage-context evaluation did not complete successfully."
        });
      }
      if (config.targetImmutability !== undefined && targetImmutability.availability === "unavailable") {
        issues.push({
          code: "TARGET_SNAPSHOT_UNAVAILABLE",
          runNumber,
          fieldPath: `runs[${runNumber}].targetImmutability`,
          message: "Target immutability assurance is unavailable for this run."
        });
      }
      if (targetImmutability.availability === "available" && targetImmutability.comparison.status === "mutated") {
        for (const mutation of targetImmutability.comparison.mutations) {
          issues.push({
            code: "TARGET_MUTATION_DETECTED",
            runNumber,
            fieldPath: `runs[${runNumber}].targetImmutability.${mutation.fieldPath}`,
            message: `Target mutation detected at "${mutation.fieldPath}".`
          });
        }
      }
    }

    const determinism = calculateStageContextDeterminism(determinismCandidates);

    if (config.repeatCount > 1 && determinism.availability === "unavailable") {
      issues.push({
        code: "DETERMINISM_UNAVAILABLE",
        runNumber: null,
        fieldPath: "determinism",
        message: "Repeated-run determinism could not be evaluated."
      });
    }
    if (determinism.availability === "available" && determinism.deterministic === false) {
      for (const mismatchRunNumber of determinism.mismatchRunNumbers) {
        issues.push({
          code: "NONDETERMINISTIC_RESULT",
          runNumber: mismatchRunNumber,
          fieldPath: `determinism.runs[${mismatchRunNumber}]`,
          message: `Run ${mismatchRunNumber} differs from the baseline run.`
        });
      }
    }

    return {
      strategyId: input.strategyId,
      status: computeStatus(issues, config),
      repeatCount: config.repeatCount,
      primaryExecution: primaryExecution as V043StageContextStrategyExecutionResult,
      primaryEvaluation: primaryEvaluation as V043StageContextEvaluationResultV1,
      runRecords,
      determinism,
      issues
    };
  } catch {
    const fallbackExecution: V043StageContextStrategyExecutionResult =
      primaryExecution ?? { status: "failed", strategyId: null, input, issues: [] };
    const fallbackEvaluation: V043StageContextEvaluationResultV1 =
      primaryEvaluation ?? {
        status: "failed",
        strategyId: null,
        executionStatus: "failed",
        reason: "Unexpected v0.4.3 stage-context run-assurance failure."
      };
    const fallbackDeterminism: StageContextDeterminismResultV1 = {
      availability: "unavailable",
      repeatCount: config.repeatCount,
      deterministic: null,
      baselineSha256: null,
      runDigests: [],
      mismatchRunNumbers: [],
      reason: "Unexpected v0.4.3 stage-context run-assurance failure prevented determinism evaluation."
    };
    return {
      strategyId: input.strategyId,
      status: "failed",
      repeatCount: config.repeatCount,
      primaryExecution: fallbackExecution,
      primaryEvaluation: fallbackEvaluation,
      runRecords,
      determinism: fallbackDeterminism,
      issues: [
        {
          code: "UNEXPECTED_ASSURANCE_ERROR",
          runNumber: null,
          fieldPath: "assurance",
          message: "Unexpected v0.4.3 stage-context run-assurance failure."
        }
      ]
    };
  }
}
