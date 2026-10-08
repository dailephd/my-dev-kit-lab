import { invalidExperimentConfig, isPlainObject, mergeConfig, validExperimentConfig } from "../../config.js";
import type { ExperimentConfigDefinition, ExperimentConfigValidationResult } from "../../types.js";

/**
 * Closed config. Real-agent, repair, preset, strategy and corpus-path options are deliberately NOT fields in this
 * version, and there is no treatment selector because both treatments are mandatory.
 */
export type AgentSuccessRateConfig = {
  outDir: string;
  caseIds?: string[];
  benchmarkProjects?: string[];
};

export const defaultAgentSuccessRateConfig: AgentSuccessRateConfig = {
  outDir: "lab-output/agent-success-rate"
};

const SUPPORTED_FIELDS = ["outDir", "caseIds", "benchmarkProjects"] as const;

export const agentSuccessRateConfigDefinition: ExperimentConfigDefinition = {
  fields: [
    { name: "outDir", type: "string", required: true, description: "Experiment output root." },
    { name: "caseIds", type: "array", description: "Task IDs to include; input order is preserved." },
    { name: "benchmarkProjects", type: "array", description: "Benchmark project IDs to include; input order is preserved." }
  ]
};

export function validateAgentSuccessRateConfig(config: unknown): ExperimentConfigValidationResult<AgentSuccessRateConfig> {
  if (config !== undefined && !isPlainObject(config)) {
    return invalidExperimentConfig(["agent success rate config must be an object."]);
  }
  const errors: string[] = [];
  const unsupported = Object.keys(config ?? {}).filter((key) => !(SUPPORTED_FIELDS as readonly string[]).includes(key));
  if (unsupported.length > 0) {
    errors.push(`Unsupported agent-success-rate config field(s): ${unsupported.sort().join(", ")}.`);
  }
  const normalized = mergeConfig(defaultAgentSuccessRateConfig, config);
  const outDir: unknown = normalized.outDir;
  if (typeof outDir !== "string" || !outDir.trim()) errors.push("outDir must be a non-empty string.");
  for (const field of ["caseIds", "benchmarkProjects"] as const) {
    const value: unknown = normalized[field];
    if (value === undefined) continue;
    if (!Array.isArray(value) || value.length === 0 || !value.every((item) => typeof item === "string" && item.trim())) {
      errors.push(`${field} must be a non-empty array of non-empty strings when provided.`);
    } else if (new Set(value).size !== value.length) {
      errors.push(`${field} must not contain duplicate entries.`);
    }
  }
  return errors.length > 0 ? invalidExperimentConfig(errors) : validExperimentConfig(normalized);
}
