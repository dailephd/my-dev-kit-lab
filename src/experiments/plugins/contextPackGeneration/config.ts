import { invalidExperimentConfig, isPlainObject, mergeConfig, validExperimentConfig } from "../../config.js";
import type { ExperimentConfigDefinition, ExperimentConfigValidationResult } from "../../types.js";

/**
 * Closed config. Selection-policy values are frozen experimental constants and deliberately NOT fields; there is also
 * no treatment or strategy selector because both treatments are mandatory.
 */
export type ContextPackGenerationConfig = {
  outDir: string;
  kitCommand: string;
  caseIds?: string[];
  benchmarkProjects?: string[];
};

export const defaultContextPackGenerationConfig: ContextPackGenerationConfig = {
  outDir: "lab-output/context-pack-generation",
  kitCommand: "npx @dailephd/my-dev-kit@latest"
};

const SUPPORTED_FIELDS = ["outDir", "kitCommand", "caseIds", "benchmarkProjects"] as const;

export const contextPackGenerationConfigDefinition: ExperimentConfigDefinition = {
  fields: [
    { name: "outDir", type: "string", required: true, description: "Experiment output root." },
    { name: "kitCommand", type: "string", description: "my-dev-kit command used for index and retrieval." },
    { name: "caseIds", type: "array", description: "Bundled evaluation case IDs to include; corpus order is preserved." },
    { name: "benchmarkProjects", type: "array", description: "Bundled benchmark project IDs to include; corpus order is preserved." }
  ]
};

export function validateContextPackGenerationConfig(config: unknown): ExperimentConfigValidationResult<ContextPackGenerationConfig> {
  if (config !== undefined && !isPlainObject(config)) {
    return invalidExperimentConfig(["context pack generation config must be an object."]);
  }
  const errors: string[] = [];
  const unsupported = Object.keys(config ?? {}).filter((key) => !(SUPPORTED_FIELDS as readonly string[]).includes(key));
  if (unsupported.length > 0) {
    errors.push(`Unsupported context-pack-generation config field(s): ${unsupported.sort().join(", ")}.`);
  }
  const normalized = mergeConfig(defaultContextPackGenerationConfig, config);
  for (const field of ["outDir", "kitCommand"] as const) {
    const value: unknown = normalized[field];
    if (typeof value !== "string" || !value.trim()) errors.push(`${field} must be a non-empty string.`);
  }
  for (const field of ["caseIds", "benchmarkProjects"] as const) {
    const value: unknown = normalized[field];
    if (value === undefined) continue;
    if (!Array.isArray(value) || value.length === 0 || !value.every((item) => typeof item === "string" && item.trim())) {
      errors.push(`${field} must be a non-empty array of non-empty strings when provided.`);
    }
  }
  return errors.length > 0 ? invalidExperimentConfig(errors) : validExperimentConfig(normalized);
}
