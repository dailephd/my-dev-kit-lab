import { loadV043StrategyArtifacts } from "./loadV043StrategyArtifacts.js";
import { V043_STAGE_CONTEXT_STRATEGY_IDS, type V043StageContextStrategyId } from "./v043StrategyIds.js";
import type { V043StageContextStrategyExecutionIssue, V043StageContextStrategyExecutionResult } from "./v043StrategyExecutionTypes.js";
import { validateV043StrategyInput } from "./validateV043StrategyInput.js";

function extractValidStrategyId(value: unknown): V043StageContextStrategyId | null {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return null;
  const strategyId = (value as Record<string, unknown>).strategyId;
  if (typeof strategyId === "string" && (V043_STAGE_CONTEXT_STRATEGY_IDS as readonly string[]).includes(strategyId)) {
    return strategyId as V043StageContextStrategyId;
  }
  return null;
}

export async function executeV043StageContextStrategy(value: unknown): Promise<V043StageContextStrategyExecutionResult> {
  const validation = validateV043StrategyInput(value);

  if (!validation.ok) {
    const issues: V043StageContextStrategyExecutionIssue[] = validation.issues.map((issue) => ({
      code: "INVALID_STRATEGY_INPUT",
      fieldPath: issue.fieldPath,
      message: issue.message,
      details: issue
    }));
    return {
      status: "invalid-input",
      strategyId: extractValidStrategyId(value),
      input: value,
      issues
    };
  }

  try {
    return await loadV043StrategyArtifacts(validation.input);
  } catch {
    return {
      status: "failed",
      strategyId: extractValidStrategyId(value),
      input: value,
      issues: [
        {
          code: "UNEXPECTED_EXECUTION_ERROR",
          fieldPath: "execution",
          message: "Unexpected v0.4.3 stage-context strategy execution failure."
        }
      ]
    };
  }
}
