export const EXISTING_CONTEXT_STRATEGY_IDS = ["raw-full-file", "my-dev-kit-guided"] as const;

export type ExistingContextStrategyId = (typeof EXISTING_CONTEXT_STRATEGY_IDS)[number];

export const V043_STAGE_CONTEXT_STRATEGY_IDS = [
  "architecture-context-only",
  "architecture-plus-implementation-refresh",
  "architecture-plus-implementation-and-test-refresh",
  "full-workflow-library",
  "bounded-workflow-instruction-packet",
  "combined-bounded-stage-context"
] as const;

export type V043StageContextStrategyId = (typeof V043_STAGE_CONTEXT_STRATEGY_IDS)[number];

export const CONTEXT_STRATEGY_IDS_WITH_V043 = [
  ...EXISTING_CONTEXT_STRATEGY_IDS,
  ...V043_STAGE_CONTEXT_STRATEGY_IDS
] as const;

export type ContextStrategyIdWithV043 = (typeof CONTEXT_STRATEGY_IDS_WITH_V043)[number];
