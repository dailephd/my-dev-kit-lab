import { RETRIEVAL_QUERY_STRATEGY_IDS, type RetrievalQueryStrategyId } from "../../../evaluation/retrievalQueryStrategies.js";
import type { RetrievalQueryStrategyComparisonCaseEvidenceV1 } from "./types.js";

export const RETRIEVAL_QUERY_STRATEGY_COMPARISON_EXECUTION_ARTIFACT_FILE = "retrieval-query-strategy-comparison-execution.json";
export const RETRIEVAL_QUERY_STRATEGY_COMPARISON_EXECUTION_SCHEMA_VERSION =
  "my-dev-kit-lab-retrieval-query-strategy-comparison-execution-v1";

/**
 * Execution evidence only. Scientific analysis (quality metrics, aggregation, interpretation) is a separate
 * later owner and deliberately has no placeholder here. It holds no contextText, raw output, or paths.
 */
export type RetrievalQueryStrategyComparisonExecutionArtifactV1 = {
  schemaVersion: typeof RETRIEVAL_QUERY_STRATEGY_COMPARISON_EXECUTION_SCHEMA_VERSION;
  runId: string;
  pluginId: string;
  pluginSchemaVersion: string;
  startedAt: string;
  completedAt: string;
  strategyOrder: RetrievalQueryStrategyId[];
  cases: RetrievalQueryStrategyComparisonCaseEvidenceV1[];
};

export function buildRetrievalQueryStrategyComparisonExecutionArtifact(args: {
  runId: string;
  pluginId: string;
  pluginSchemaVersion: string;
  startedAt: string;
  completedAt: string;
  cases: readonly RetrievalQueryStrategyComparisonCaseEvidenceV1[];
}): RetrievalQueryStrategyComparisonExecutionArtifactV1 {
  return {
    schemaVersion: RETRIEVAL_QUERY_STRATEGY_COMPARISON_EXECUTION_SCHEMA_VERSION,
    runId: args.runId,
    pluginId: args.pluginId,
    pluginSchemaVersion: args.pluginSchemaVersion,
    startedAt: args.startedAt,
    completedAt: args.completedAt,
    strategyOrder: [...RETRIEVAL_QUERY_STRATEGY_IDS],
    cases: structuredClone(args.cases) as RetrievalQueryStrategyComparisonCaseEvidenceV1[]
  };
}
