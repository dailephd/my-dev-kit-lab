import type { ExperimentMatrixConfig } from "../../../evaluation/controlledExperimentTypes.js";
import { invalidExperimentConfig, isPlainObject, mergeConfig, validExperimentConfig } from "../../config.js";
import type { ExperimentConfigValidationResult } from "../../types.js";
import type { ContextStrategyIdWithV043 } from "./v043StrategyIds.js";
import type { V043StageContextStrategyInputV1 } from "./v043StrategyInputContracts.js";

export type ContextStrategyComparisonConfig = Omit<ExperimentMatrixConfig, "strategies"> & {
  strategies?: ContextStrategyIdWithV043[];
  v043StrategyInputs?: readonly V043StageContextStrategyInputV1[];
};

export const defaultContextStrategyComparisonConfig: ContextStrategyComparisonConfig = {
  casesPath: "examples/token-savings-cases.json",
  projectProfilesPath: "benchmarks/contracts/benchmark-project-profiles.json",
  agents: ["fake-agent"],
  strategies: ["raw-full-file", "my-dev-kit-guided"],
  complexityLevels: ["short"],
  outDir: "lab-output/context-strategy-comparison",
  continueOnFailure: true,
  includeRealAgents: false,
};

export function validateContextStrategyComparisonConfig(
  config: unknown
): ExperimentConfigValidationResult<ContextStrategyComparisonConfig> {
  if (config !== undefined && !isPlainObject(config)) {
    return invalidExperimentConfig(["context strategy comparison config must be an object."]);
  }

  const normalized = mergeConfig(defaultContextStrategyComparisonConfig, config);
  const errors: string[] = [];

  if (!normalized.casesPath || typeof normalized.casesPath !== "string") {
    errors.push("casesPath is required.");
  }
  if (!normalized.outDir || typeof normalized.outDir !== "string") {
    errors.push("outDir is required.");
  }
  if (normalized.agents && !Array.isArray(normalized.agents)) {
    errors.push("agents must be an array when provided.");
  }
  if (normalized.strategies && !Array.isArray(normalized.strategies)) {
    errors.push("strategies must be an array when provided.");
  }
  if (normalized.complexityLevels && !Array.isArray(normalized.complexityLevels)) {
    errors.push("complexityLevels must be an array when provided.");
  }

  if (errors.length > 0) {
    return invalidExperimentConfig(errors);
  }

  return validExperimentConfig(normalized);
}
