import type { ExperimentPluginMetadata } from "../../types.js";

export const CONTEXT_WINDOW_SCALING_PLUGIN_ID = "context-window-scaling";

/** Stable strategy IDs shared with existing plugins; budget is never part of variant identity. */
export const CONTEXT_WINDOW_SCALING_TREATMENT_IDS = ["raw-full-file", "my-dev-kit-guided"] as const;

export type ContextWindowScalingTreatmentId = (typeof CONTEXT_WINDOW_SCALING_TREATMENT_IDS)[number];

export const contextWindowScalingMetadata: ExperimentPluginMetadata = {
  id: CONTEXT_WINDOW_SCALING_PLUGIN_ID,
  name: "Context Window Scaling",
  description:
    "Measure raw-full-file and my-dev-kit-guided strategies under increasing deterministic estimated-context-token budgets.",
  schemaVersion: "1.0.0",
  status: "experimental",
  supportedTargets: ["self"],
  supportedOutputs: ["json", "text", "html", "plot"],
};
