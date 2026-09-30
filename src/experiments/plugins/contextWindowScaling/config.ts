import { invalidExperimentConfig, isPlainObject, validExperimentConfig } from "../../config.js";
import type { ExperimentConfigDefinition, ExperimentConfigValidationResult } from "../../types.js";
import { isValidContextBudgetTokens, STANDARD_CONTEXT_BUDGETS } from "./contextBudget.js";
import type { ContextWindowScalingConfig } from "./types.js";

const MAX_REPORTED_INVALID_BUDGETS = 5;

export const defaultContextWindowScalingConfig: ContextWindowScalingConfig = {
  contextBudgets: [...STANDARD_CONTEXT_BUDGETS],
  kitCommand: "npx @dailephd/my-dev-kit@latest",
};

export const contextWindowScalingConfigDefinition: ExperimentConfigDefinition = {
  fields: [
    {
      name: "contextBudgets",
      type: "array",
      description:
        "Estimated-context-token budgets (positive safe integers, no duplicates). Defaults to 8192, 16384, 32768, 65536.",
      defaultValue: [...STANDARD_CONTEXT_BUDGETS],
    },
    { name: "kitCommand", type: "string", description: "my-dev-kit command used for my-dev-kit-guided retrieval." },
  ],
};

/** Returns ascending budgets; invalid input is rejected, never repaired or deduplicated. */
export function validateContextBudgets(value: unknown): { budgets: number[]; errors: string[] } {
  if (!Array.isArray(value)) {
    return { budgets: [], errors: ["contextBudgets must be an array of positive safe integers."] };
  }
  if (value.length === 0) {
    return { budgets: [], errors: ["contextBudgets must not be empty."] };
  }
  const errors: string[] = [];
  const invalid = value
    .map((entry, index) => ({ entry, index }))
    .filter(({ entry }) => !isValidContextBudgetTokens(entry));
  for (const { entry, index } of invalid.slice(0, MAX_REPORTED_INVALID_BUDGETS)) {
    errors.push(`contextBudgets[${index}] must be a positive safe integer (received ${describe(entry)}).`);
  }
  if (invalid.length > MAX_REPORTED_INVALID_BUDGETS) {
    errors.push(`${invalid.length - MAX_REPORTED_INVALID_BUDGETS} additional invalid contextBudgets entries omitted.`);
  }
  if (errors.length > 0) {
    return { budgets: [], errors };
  }
  const numbers = value as number[];
  const duplicates = [...new Set(numbers.filter((entry, index) => numbers.indexOf(entry) !== index))].sort(
    (a, b) => a - b
  );
  if (duplicates.length > 0) {
    return {
      budgets: [],
      errors: [`contextBudgets contains duplicate value(s): ${duplicates.slice(0, MAX_REPORTED_INVALID_BUDGETS).join(", ")}.`],
    };
  }
  return { budgets: [...numbers].sort((a, b) => a - b), errors: [] };
}

function describe(entry: unknown): string {
  if (typeof entry === "number") {
    return String(entry);
  }
  if (typeof entry === "string") {
    return JSON.stringify(entry.length > 20 ? `${entry.slice(0, 20)}...` : entry);
  }
  return typeof entry;
}

export function validateContextWindowScalingConfig(
  config: unknown
): ExperimentConfigValidationResult<ContextWindowScalingConfig> {
  if (config !== undefined && !isPlainObject(config)) {
    return invalidExperimentConfig(["context window scaling config must be an object."]);
  }
  const supported = Object.keys(defaultContextWindowScalingConfig);
  const unsupported = Object.keys(config ?? {}).filter((key) => !supported.includes(key));
  if (unsupported.length > 0) {
    return invalidExperimentConfig([
      `Unsupported context-window-scaling config field(s): ${unsupported.sort().join(", ")}.`,
    ]);
  }
  const errors: string[] = [];
  const kitCommand = config?.kitCommand ?? defaultContextWindowScalingConfig.kitCommand;
  if (typeof kitCommand !== "string" || !kitCommand.trim()) {
    errors.push("kitCommand must be a non-empty string.");
  }
  let contextBudgets = [...STANDARD_CONTEXT_BUDGETS];
  if (config?.contextBudgets !== undefined) {
    const validated = validateContextBudgets(config.contextBudgets);
    errors.push(...validated.errors);
    contextBudgets = validated.budgets;
  }
  return errors.length > 0
    ? invalidExperimentConfig(errors)
    : validExperimentConfig({ contextBudgets, kitCommand: kitCommand as string });
}
