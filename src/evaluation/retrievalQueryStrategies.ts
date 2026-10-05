export const RETRIEVAL_QUERY_STRATEGY_IDS = [
  "keyword-search",
  "symbol-lookup",
  "graph-neighborhood",
  "source-slice",
  "data-model-graph",
  "model-view-lineage",
  "combined-graph-guided"
] as const;

export type RetrievalQueryStrategyId = (typeof RETRIEVAL_QUERY_STRATEGY_IDS)[number];

export const CORE_GRAPH_RETRIEVAL_QUERY_STRATEGY_IDS = [
  "keyword-search",
  "symbol-lookup",
  "graph-neighborhood",
  "source-slice",
  "combined-graph-guided"
] as const satisfies readonly RetrievalQueryStrategyId[];

export type CoreGraphRetrievalQueryStrategyId = (typeof CORE_GRAPH_RETRIEVAL_QUERY_STRATEGY_IDS)[number];

export function isCoreGraphRetrievalQueryStrategyId(
  value: RetrievalQueryStrategyId
): value is CoreGraphRetrievalQueryStrategyId {
  return (CORE_GRAPH_RETRIEVAL_QUERY_STRATEGY_IDS as readonly string[]).includes(value);
}

export const SEMANTIC_RETRIEVAL_QUERY_STRATEGY_IDS = [
  "data-model-graph",
  "model-view-lineage"
] as const satisfies readonly RetrievalQueryStrategyId[];

export type SemanticRetrievalQueryStrategyId = (typeof SEMANTIC_RETRIEVAL_QUERY_STRATEGY_IDS)[number];

export function isSemanticRetrievalQueryStrategyId(
  value: RetrievalQueryStrategyId
): value is SemanticRetrievalQueryStrategyId {
  return (SEMANTIC_RETRIEVAL_QUERY_STRATEGY_IDS as readonly string[]).includes(value);
}
