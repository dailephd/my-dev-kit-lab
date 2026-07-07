import type { ExperimentConfigValidationResult } from "./types.js";

export function validExperimentConfig<TConfig>(
  config: TConfig,
  warnings: string[] = []
): ExperimentConfigValidationResult<TConfig> {
  return {
    valid: true,
    config,
    errors: [],
    warnings,
  };
}

export function invalidExperimentConfig<TConfig = never>(
  errors: string[],
  warnings: string[] = []
): ExperimentConfigValidationResult<TConfig> {
  return {
    valid: false,
    errors,
    warnings,
  };
}

export function mergeConfig<TConfig extends Record<string, unknown>>(
  defaults: TConfig,
  config: unknown
): TConfig {
  if (!isPlainObject(config)) {
    return { ...defaults };
  }
  return { ...defaults, ...config };
}

export function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
