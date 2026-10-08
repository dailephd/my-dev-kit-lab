import type { ExperimentPluginMetadata, ExperimentVariant } from "../../types.js";

export const AGENT_SUCCESS_RATE_PLUGIN_ID = "agent-success-rate";

export const AGENT_SUCCESS_RATE_TREATMENT_IDS = ["raw-full-file", "context-pack"] as const;

export type AgentSuccessRateTreatmentId = (typeof AGENT_SUCCESS_RATE_TREATMENT_IDS)[number];

/** Batch 2 executes deterministic fixture patches only; no coding agent runs. */
export const AGENT_SUCCESS_RATE_EXECUTION_MODE = "deterministic-fixture" as const;

export const agentSuccessRateMetadata: ExperimentPluginMetadata = {
  id: AGENT_SUCCESS_RATE_PLUGIN_ID,
  name: "Agent Success Rate",
  description:
    "Evaluate implementation tasks on disposable benchmark copies with trusted verification checks. Deterministic-fixture mode validates the evaluation pipeline and does not measure agent or context performance.",
  schemaVersion: "1.0.0",
  status: "experimental",
  supportedTargets: ["self"],
  supportedOutputs: ["json", "artifact"]
};

/** Exactly two mandatory treatments, in fixed order. There is no treatment selector. */
export const AGENT_SUCCESS_RATE_VARIANTS: readonly ExperimentVariant[] = [
  {
    id: "raw-full-file",
    name: "Raw full-file context",
    description: "Treatment identity for raw full-file context. In deterministic-fixture mode no context is supplied to any agent."
  },
  {
    id: "context-pack",
    name: "Context pack",
    description: "Treatment identity for a bounded context pack. In deterministic-fixture mode no context is supplied to any agent."
  }
];
