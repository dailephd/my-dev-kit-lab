import { V043_STAGE_CONTEXT_STRATEGY_IDS, type ContextStrategyIdWithV043, type V043StageContextStrategyId } from "./v043StrategyIds.js";
import type { V043StageContextStrategyInputV1 } from "./v043StrategyInputContracts.js";

export type V043StrategyInputResolutionIssueCode =
  | "MISSING_STRATEGY_INPUT"
  | "DUPLICATE_STRATEGY_INPUT"
  | "INPUT_STRATEGY_NOT_SELECTED";

export interface V043StrategyInputResolutionIssue {
  code: V043StrategyInputResolutionIssueCode;
  strategyId: V043StageContextStrategyId;
  message: string;
}

export type V043StrategyInputResolutionResult =
  | {
      ok: true;
      inputByStrategyId: Partial<Record<V043StageContextStrategyId, V043StageContextStrategyInputV1>>;
    }
  | {
      ok: false;
      issues: V043StrategyInputResolutionIssue[];
    };

function isV043StrategyId(value: string): value is V043StageContextStrategyId {
  return (V043_STAGE_CONTEXT_STRATEGY_IDS as readonly string[]).includes(value);
}

export function resolveV043StrategyInputs(
  selectedStrategyIds: readonly ContextStrategyIdWithV043[],
  providedInputs: readonly V043StageContextStrategyInputV1[]
): V043StrategyInputResolutionResult {
  const issues: V043StrategyInputResolutionIssue[] = [];
  const inputByStrategyId: Partial<Record<V043StageContextStrategyId, V043StageContextStrategyInputV1>> = {};

  const selectedV043Ids = selectedStrategyIds.filter(isV043StrategyId);

  for (const strategyId of selectedV043Ids) {
    const matches = providedInputs.filter((input) => input.strategyId === strategyId);
    if (matches.length === 0) {
      issues.push({
        code: "MISSING_STRATEGY_INPUT",
        strategyId,
        message: `No strategy input was supplied for selected strategy "${strategyId}".`
      });
    } else if (matches.length > 1) {
      issues.push({
        code: "DUPLICATE_STRATEGY_INPUT",
        strategyId,
        message: `More than one strategy input was supplied for selected strategy "${strategyId}".`
      });
    } else {
      inputByStrategyId[strategyId] = matches[0];
    }
  }

  const selectedV043IdSet = new Set<V043StageContextStrategyId>(selectedV043Ids);
  for (const input of providedInputs) {
    if (!selectedV043IdSet.has(input.strategyId)) {
      issues.push({
        code: "INPUT_STRATEGY_NOT_SELECTED",
        strategyId: input.strategyId,
        message: `A strategy input was supplied for "${input.strategyId}", which was not selected.`
      });
    }
  }

  if (issues.length > 0) {
    return { ok: false, issues };
  }

  return { ok: true, inputByStrategyId };
}
