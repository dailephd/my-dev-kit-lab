/** Maximum deterministic estimated-context-token count permitted for a treatment cell. */
export type ContextBudgetTokens = number;

export type ContextFitStatus = "fits" | "context-too-large";

export type ContextWindowScalingConfig = {
  contextBudgets: ContextBudgetTokens[];
};

/** Compact per-(treatment, budget) evidence; the persisted artifact schema belongs to a later batch. */
export type ContextBudgetEvidence = {
  contextBudgetTokens: ContextBudgetTokens;
  contextEstimatedTokens: number;
  contextFitStatus: ContextFitStatus;
  contextBudgetUtilizationPercent: number;
};
