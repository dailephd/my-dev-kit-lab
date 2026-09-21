import { invalidExperimentConfig, isPlainObject, mergeConfig, validExperimentConfig } from "../../config.js";
import type { ExperimentConfigDefinition, ExperimentConfigValidationResult } from "../../types.js";

export type WarmIndexReuseConfig = {
  casesPath: string;
  projectProfilesPath: string;
  outDir: string;
  kitCommand: string;
  caseIds?: string[];
  benchmarkProjects?: string[];
};

export const defaultWarmIndexReuseConfig: WarmIndexReuseConfig = {
  casesPath: "examples/token-savings-cases.json",
  projectProfilesPath: "benchmarks/contracts/benchmark-project-profiles.json",
  outDir: "lab-output/warm-index-reuse",
  kitCommand: "npx @dailephd/my-dev-kit@latest",
};

const SUPPORTED_FIELDS = [
  "casesPath",
  "projectProfilesPath",
  "outDir",
  "kitCommand",
  "caseIds",
  "benchmarkProjects",
] as const;

export const warmIndexReuseConfigDefinition: ExperimentConfigDefinition = {
  fields: [
    { name: "casesPath", type: "string", required: true, description: "Evaluation cases file." },
    { name: "outDir", type: "string", required: true, description: "Experiment output root." },
    { name: "projectProfilesPath", type: "string", description: "Benchmark project profiles file." },
    { name: "kitCommand", type: "string", description: "my-dev-kit command used for index and retrieval." },
    { name: "caseIds", type: "array", description: "Evaluation case IDs to include." },
    { name: "benchmarkProjects", type: "array", description: "Benchmark project IDs to include." },
  ],
};

/**
 * Closed validation: fields outside the warm-index contract (for example agent-matrix settings)
 * are rejected instead of being silently ignored.
 */
export function validateWarmIndexReuseConfig(config: unknown): ExperimentConfigValidationResult<WarmIndexReuseConfig> {
  if (config !== undefined && !isPlainObject(config)) {
    return invalidExperimentConfig(["warm index reuse config must be an object."]);
  }

  const errors: string[] = [];
  const unsupported = Object.keys(config ?? {}).filter(
    (key) => !(SUPPORTED_FIELDS as readonly string[]).includes(key)
  );
  if (unsupported.length > 0) {
    errors.push(`Unsupported warm-index-reuse config field(s): ${unsupported.sort().join(", ")}.`);
  }

  const normalized = mergeConfig(defaultWarmIndexReuseConfig, config);
  for (const field of ["casesPath", "projectProfilesPath", "outDir", "kitCommand"] as const) {
    const value: unknown = normalized[field];
    if (typeof value !== "string" || !value.trim()) {
      errors.push(`${field} must be a non-empty string.`);
    }
  }
  for (const field of ["caseIds", "benchmarkProjects"] as const) {
    const value: unknown = normalized[field];
    if (value === undefined) continue;
    if (!Array.isArray(value) || value.length === 0 || !value.every((item) => typeof item === "string" && item.trim())) {
      errors.push(`${field} must be a non-empty array of non-empty strings when provided.`);
    }
  }

  if (errors.length > 0) {
    return invalidExperimentConfig(errors);
  }
  return validExperimentConfig(normalized);
}
