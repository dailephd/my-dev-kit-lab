import type { ExperimentPluginMetadata, ExperimentVariant } from "../../types.js";

export const CONTEXT_PACK_GENERATION_PLUGIN_ID = "context-pack-generation";

export const CONTEXT_PACK_GENERATION_TREATMENT_IDS = ["raw-full-file", "context-pack"] as const;

export type ContextPackGenerationTreatmentId = (typeof CONTEXT_PACK_GENERATION_TREATMENT_IDS)[number];

export const contextPackGenerationMetadata: ExperimentPluginMetadata = {
  id: CONTEXT_PACK_GENERATION_PLUGIN_ID,
  name: "Context Pack Generation",
  description:
    "Compare a deterministic Lab-owned experimental context pack against raw full-file context on matched bundled benchmark cases without coding agents.",
  schemaVersion: "1.0.0",
  status: "experimental",
  supportedTargets: ["self", "external-local"],
  supportedOutputs: ["json", "html", "text", "artifact"]
};

/** Exactly two mandatory treatments, in fixed order. There is no treatment selector. */
export const CONTEXT_PACK_GENERATION_VARIANTS: readonly ExperimentVariant[] = [
  {
    id: "raw-full-file",
    name: "Raw full-file context",
    description: "Include every eligible file matched by the case raw include globs as raw text."
  },
  {
    id: "context-pack",
    name: "Context pack",
    description:
      "Compose a bounded, deterministic pack of task, relevant files and symbols, source slices, call relationships, tests, and evidence notes from my-dev-kit evidence."
  }
];
