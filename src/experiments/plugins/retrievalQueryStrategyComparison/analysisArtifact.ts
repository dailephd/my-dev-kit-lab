import type { RetrievalQueryStrategyComparisonAnalysisV1 } from "./analysisTypes.js";

export const RETRIEVAL_QUERY_STRATEGY_COMPARISON_ANALYSIS_ARTIFACT_FILE = "retrieval-query-strategy-comparison-analysis.json";
export const RETRIEVAL_QUERY_STRATEGY_COMPARISON_ANALYSIS_SCHEMA_VERSION =
  "my-dev-kit-lab-retrieval-query-strategy-comparison-analysis-v1";

export type RetrievalQueryStrategyComparisonMethodologyV1 = {
  fileF1: "balanced-f1";
  symbolF1: "balanced-f1";
  aggregation: "matched-complete-case-macro-mean";
  multiObjectiveComparison: "pareto-dominance";
  uniqueBestRule: "single-member-pareto-front";
  objectiveDirections: {
    meanFileF1: "maximize";
    meanSymbolF1: "maximize";
    meanFactCoverage: "maximize";
    meanRetrievedTokenCount: "minimize";
  };
};

/** Single owner of the frozen methodology; the artifact and the report both use it. */
export const RETRIEVAL_QUERY_STRATEGY_COMPARISON_METHODOLOGY: RetrievalQueryStrategyComparisonMethodologyV1 = {
  fileF1: "balanced-f1",
  symbolF1: "balanced-f1",
  aggregation: "matched-complete-case-macro-mean",
  multiObjectiveComparison: "pareto-dominance",
  uniqueBestRule: "single-member-pareto-front",
  objectiveDirections: {
    meanFileF1: "maximize",
    meanSymbolF1: "maximize",
    meanFactCoverage: "maximize",
    meanRetrievedTokenCount: "minimize"
  }
};

/** Scientific truth owner. Holds no contextText, raw output, command data, or machine-local paths. */
export type RetrievalQueryStrategyComparisonAnalysisArtifactV1 = {
  schemaVersion: typeof RETRIEVAL_QUERY_STRATEGY_COMPARISON_ANALYSIS_SCHEMA_VERSION;
  runId: string;
  pluginId: string;
  pluginSchemaVersion: string;
  startedAt: string;
  completedAt: string;
  methodology: RetrievalQueryStrategyComparisonMethodologyV1;
  analysis: RetrievalQueryStrategyComparisonAnalysisV1;
};

export function buildRetrievalQueryStrategyComparisonAnalysisArtifact(args: {
  runId: string;
  pluginId: string;
  pluginSchemaVersion: string;
  startedAt: string;
  completedAt: string;
  analysis: RetrievalQueryStrategyComparisonAnalysisV1;
}): RetrievalQueryStrategyComparisonAnalysisArtifactV1 {
  return {
    schemaVersion: RETRIEVAL_QUERY_STRATEGY_COMPARISON_ANALYSIS_SCHEMA_VERSION,
    runId: args.runId,
    pluginId: args.pluginId,
    pluginSchemaVersion: args.pluginSchemaVersion,
    startedAt: args.startedAt,
    completedAt: args.completedAt,
    methodology: structuredClone(RETRIEVAL_QUERY_STRATEGY_COMPARISON_METHODOLOGY),
    analysis: structuredClone(args.analysis)
  };
}
