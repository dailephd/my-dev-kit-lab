import type { ExperimentPluginMetadata, ExperimentVariant } from "../../types.js";

export const RETRIEVAL_QUERY_STRATEGY_COMPARISON_PLUGIN_ID = "retrieval-query-strategy-comparison";

/** The v0.8.1 comparison reuses the frozen v0.8.0 corpus lineage; there is no second benchmark corpus. */
export const RETRIEVAL_QUERY_STRATEGY_COMPARISON_CASES_RESOURCE = "benchmarks/contracts/warm-index-benchmark-cases.json";
export const RETRIEVAL_QUERY_STRATEGY_COMPARISON_PROJECT_PROFILES_RESOURCE = "benchmarks/contracts/benchmark-project-profiles.json";

export const retrievalQueryStrategyComparisonMetadata: ExperimentPluginMetadata = {
  id: RETRIEVAL_QUERY_STRATEGY_COMPARISON_PLUGIN_ID,
  name: "Retrieval Query Strategy Comparison",
  description:
    "Compare seven deterministic my-dev-kit retrieval query strategies on matched bundled benchmark cases without coding agents.",
  schemaVersion: "1.0.0",
  status: "experimental",
  supportedTargets: ["self", "external-local"],
  supportedOutputs: ["json", "html", "text", "artifact"]
};

/** Exactly the seven treatment levels, in the frozen strategy order. */
export const RETRIEVAL_QUERY_STRATEGY_COMPARISON_VARIANTS: readonly ExperimentVariant[] = [
  {
    id: "keyword-search",
    name: "Keyword search",
    description: "Use the task query with my-dev-kit search and expose only the search result context."
  },
  {
    id: "symbol-lookup",
    name: "Symbol lookup",
    description: "Search for the task query, select the top candidate, and inspect that exact graph node with lookup."
  },
  {
    id: "graph-neighborhood",
    name: "Graph neighborhood",
    description: "Search for the task query, select the top candidate, and retrieve its bounded graph neighborhood with slice."
  },
  {
    id: "source-slice",
    name: "Source slice",
    description: "Search for the task query, select the top candidate, and retrieve bounded numbered source for that node."
  },
  {
    id: "data-model-graph",
    name: "Data-model graph",
    description: "Match task-query tokens against data-model graph labels and inspect the best deterministic entity or field."
  },
  {
    id: "model-view-lineage",
    name: "Model-view lineage",
    description: "Match the task query to a data-model entity or field and retrieve its conservative static model-to-view lineage."
  },
  {
    id: "combined-graph-guided",
    name: "Combined graph-guided",
    description: "Use the v0.8.0 compatibility workflow: search, lookup, slice, then bounded source for the top candidate."
  }
];
