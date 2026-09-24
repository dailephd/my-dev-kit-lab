import { invalidExperimentConfig, isPlainObject, mergeConfig, validExperimentConfig } from "../../config.js";
import type { ExperimentConfigDefinition, ExperimentConfigValidationResult } from "../../types.js";
import { WARM_INDEX_CAMPAIGN_PRESET_IDS, type WarmIndexCampaignPresetId } from "./campaignPresets.js";

export type WarmIndexReuseConfig = {
  casesPath: string;
  projectProfilesPath: string;
  outDir: string;
  kitCommand: string;
  caseIds?: string[];
  benchmarkProjects?: string[];
  /** Selects a frozen real-agent campaign preset. Absent = legacy fake-agent behavior. */
  campaignPreset?: WarmIndexCampaignPresetId;
  /** Required (must be exactly true) whenever campaignPreset is set; rejected otherwise. */
  includeRealAgents?: boolean;
  /** Optional per-agent timeout override for a campaign; rejected without campaignPreset. */
  timeoutMs?: number;
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
  "campaignPreset",
  "includeRealAgents",
  "timeoutMs",
] as const;

export const warmIndexReuseConfigDefinition: ExperimentConfigDefinition = {
  fields: [
    { name: "casesPath", type: "string", required: true, description: "Evaluation cases file." },
    { name: "outDir", type: "string", required: true, description: "Experiment output root." },
    { name: "projectProfilesPath", type: "string", description: "Benchmark project profiles file." },
    { name: "kitCommand", type: "string", description: "my-dev-kit command used for index and retrieval." },
    { name: "caseIds", type: "array", description: "Evaluation case IDs to include." },
    { name: "benchmarkProjects", type: "array", description: "Benchmark project IDs to include." },
    {
      name: "campaignPreset",
      type: "string",
      description: `Real-agent campaign preset id: ${WARM_INDEX_CAMPAIGN_PRESET_IDS.join(", ")}. Absent selects the legacy deterministic fake-agent path.`,
    },
    {
      name: "includeRealAgents",
      type: "boolean",
      description: "Required (must be true) together with campaignPreset; rejected without it.",
    },
    {
      name: "timeoutMs",
      type: "number",
      description: "Optional per-agent timeout override (ms) for a campaign; defaults to the preset's 240000 ms. Rejected without campaignPreset.",
    },
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

  // Campaign fields are validated against the RAW supplied object, not the merged/normalized one,
  // so legacy defaults (casesPath/projectProfilesPath) never look like an explicit override.
  const raw = isPlainObject(config) ? config : {};
  const rawCampaignPreset = raw.campaignPreset;
  if (rawCampaignPreset !== undefined) {
    if (typeof rawCampaignPreset !== "string" || !(WARM_INDEX_CAMPAIGN_PRESET_IDS as readonly string[]).includes(rawCampaignPreset)) {
      errors.push(
        `campaignPreset must be one of: ${WARM_INDEX_CAMPAIGN_PRESET_IDS.join(", ")}.`
      );
    }
    if (raw.casesPath !== undefined) {
      errors.push("campaignPreset cannot be combined with an explicit casesPath; the preset owns the production corpus.");
    }
    if (raw.projectProfilesPath !== undefined) {
      errors.push(
        "campaignPreset cannot be combined with an explicit projectProfilesPath; the preset owns the project profiles."
      );
    }
    if (raw.includeRealAgents !== true) {
      errors.push("campaignPreset requires includeRealAgents to be exactly true.");
    }
    if (raw.timeoutMs !== undefined) {
      const timeoutMs = raw.timeoutMs;
      if (typeof timeoutMs !== "number" || !Number.isFinite(timeoutMs) || !Number.isInteger(timeoutMs) || timeoutMs <= 0) {
        errors.push("timeoutMs must be a finite positive integer when campaignPreset is set.");
      }
    }
  } else {
    if (raw.includeRealAgents !== undefined) {
      errors.push("includeRealAgents is only supported together with campaignPreset.");
    }
    if (raw.timeoutMs !== undefined) {
      errors.push("timeoutMs is only supported together with campaignPreset.");
    }
  }

  if (errors.length > 0) {
    return invalidExperimentConfig(errors);
  }
  return validExperimentConfig(normalized);
}
