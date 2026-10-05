import type { ExperimentPluginMetadata, ExperimentVariant } from "../../types.js";

export const RETRIEVAL_PRECISION_RECALL_PLUGIN_ID = "retrieval-precision-recall";
export const RETRIEVAL_PRECISION_RECALL_VARIANT_ID = "my-dev-kit-retrieval";

/** The frozen bundled corpus; the public plugin offers no way to substitute another. */
export const RETRIEVAL_PRECISION_RECALL_CASES_RESOURCE = "benchmarks/contracts/warm-index-benchmark-cases.json";
export const RETRIEVAL_PRECISION_RECALL_PROJECT_PROFILES_RESOURCE = "benchmarks/contracts/benchmark-project-profiles.json";

export const retrievalPrecisionRecallMetadata: ExperimentPluginMetadata = {
  id: RETRIEVAL_PRECISION_RECALL_PLUGIN_ID,
  name: "Retrieval Precision/Recall",
  description:
    "Measure deterministic file, symbol, fact and irrelevant-context retrieval quality for the existing my-dev-kit retrieval lifecycle without agents.",
  schemaVersion: "1.0.0",
  status: "experimental",
  supportedTargets: ["self", "external-local"],
  supportedOutputs: ["json", "html", "text", "artifact"]
};

export const RETRIEVAL_PRECISION_RECALL_VARIANTS: readonly ExperimentVariant[] = [
  {
    id: RETRIEVAL_PRECISION_RECALL_VARIANT_ID,
    name: "my-dev-kit retrieval",
    description: "search, then lookup, slice and source for the top candidate, from one index prepared per benchmark project."
  }
];
