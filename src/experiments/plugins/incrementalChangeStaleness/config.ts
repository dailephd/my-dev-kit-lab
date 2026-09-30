import { invalidExperimentConfig, isPlainObject, mergeConfig, validExperimentConfig } from "../../config.js";
import type { ExperimentConfigDefinition, ExperimentConfigValidationResult } from "../../types.js";
import { FROZEN_INCREMENTAL_CHANGE_STALENESS_SCENARIO_IDS } from "./scenarioTypes.js";

/**
 * The upstream tool version the four-treatment experiment expects: 1.12.5 is the first published
 * my-dev-kit that exposes the incremental refresh-scope options. Every index of one matched scenario
 * must come from this one configured command.
 */
export const INCREMENTAL_CHANGE_STALENESS_DEFAULT_KIT_COMMAND = "npx @dailephd/my-dev-kit@1.12.5";

export type IncrementalChangeStalenessConfig = {
  outDir: string;
  kitCommand: string;
  /**
   * Optional subset of frozen scenario ids (the generic `--case` selection).
   * Absent selects every production scenario. Mutation instructions are never
   * configurable: the canonical scenario catalog is the only mutation authority.
   */
  caseIds?: string[];
};

export const defaultIncrementalChangeStalenessConfig: IncrementalChangeStalenessConfig = {
  outDir: "lab-output/incremental-change-staleness",
  kitCommand: INCREMENTAL_CHANGE_STALENESS_DEFAULT_KIT_COMMAND
};

const SUPPORTED_FIELDS = ["outDir", "kitCommand", "caseIds"] as const;

export const incrementalChangeStalenessConfigDefinition: ExperimentConfigDefinition = {
  fields: [
    { name: "outDir", type: "string", required: true, description: "Experiment output root." },
    { name: "kitCommand", type: "string", description: "my-dev-kit command used for every treatment index build." },
    {
      name: "caseIds",
      type: "array",
      description: `Frozen scenario ids to include (${FROZEN_INCREMENTAL_CHANGE_STALENESS_SCENARIO_IDS.join(", ")}); defaults to all. All four treatments run for each selected scenario: stale-index, changed-files-refresh, affected-neighborhood-refresh, and full-refresh.`
    }
  ]
};

/**
 * Closed validation: unknown fields (including any attempt to supply variant
 * filters, catalog paths, or mutation text) are rejected. Scenario ids must be
 * frozen production ids, non-empty, and free of duplicates, so invalid
 * selections fail before any target or index work.
 */
export function validateIncrementalChangeStalenessConfig(config: unknown): ExperimentConfigValidationResult<IncrementalChangeStalenessConfig> {
  if (config !== undefined && !isPlainObject(config)) {
    return invalidExperimentConfig(["incremental-change-staleness config must be an object."]);
  }
  const errors: string[] = [];
  const unsupported = Object.keys(config ?? {}).filter((key) => !(SUPPORTED_FIELDS as readonly string[]).includes(key));
  if (unsupported.length > 0) {
    errors.push(`Unsupported incremental-change-staleness config field(s): ${unsupported.sort().join(", ")}.`);
  }

  const normalized = mergeConfig(defaultIncrementalChangeStalenessConfig, config);
  for (const field of ["outDir", "kitCommand"] as const) {
    const value: unknown = normalized[field];
    if (typeof value !== "string" || !value.trim()) {
      errors.push(`${field} must be a non-empty string.`);
    }
  }

  const caseIds: unknown = normalized.caseIds;
  if (caseIds !== undefined) {
    if (!Array.isArray(caseIds) || caseIds.length === 0 || !caseIds.every((item) => typeof item === "string" && item.trim())) {
      errors.push("caseIds must be a non-empty array of non-empty scenario id strings when provided.");
    } else {
      const duplicates = caseIds.filter((id, index) => caseIds.indexOf(id) !== index);
      if (duplicates.length > 0) {
        errors.push(`caseIds contains duplicate scenario id(s): ${[...new Set(duplicates)].join(", ")}.`);
      }
      const unknown = caseIds.filter((id) => !(FROZEN_INCREMENTAL_CHANGE_STALENESS_SCENARIO_IDS as readonly string[]).includes(id));
      if (unknown.length > 0) {
        errors.push(
          `caseIds contains unknown scenario id(s): ${unknown.join(", ")}. Expected one of ${FROZEN_INCREMENTAL_CHANGE_STALENESS_SCENARIO_IDS.join(", ")}.`
        );
      }
    }
  }

  if (errors.length > 0) {
    return invalidExperimentConfig(errors);
  }
  return validExperimentConfig(normalized);
}
