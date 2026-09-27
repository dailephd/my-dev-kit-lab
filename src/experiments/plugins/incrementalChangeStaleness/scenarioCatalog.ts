import { readFile } from "node:fs/promises";
import path from "node:path";
import { readBenchmarkProjectProfiles } from "../../../evaluation/benchmarkMetadata.js";
import { readEvaluationCases } from "../../../evaluation/readEvaluationCases.js";
import type { BenchmarkProjectProfile, EvaluationCase } from "../../../evaluation/types.js";
import { validateIncrementalChangeStalenessCatalog } from "./scenarioValidation.js";
import type { IncrementalChangeStalenessScenarioCatalog } from "./scenarioTypes.js";

/** Canonical repository-relative locations reused by the production catalog. */
export const INCREMENTAL_CHANGE_STALENESS_SCENARIO_CATALOG_PATH = "benchmarks/contracts/incremental-change-staleness-scenarios.json";
export const BENCHMARK_PROJECT_PROFILES_PATH = "benchmarks/contracts/benchmark-project-profiles.json";
export const WARM_INDEX_BENCHMARK_CASES_PATH = "benchmarks/contracts/warm-index-benchmark-cases.json";

export type ReadIncrementalChangeStalenessScenarioCatalogOptions = {
  /** When true (the default), requires exactly the six frozen production scenarios. */
  requireFrozenProductionScenarios?: boolean;
};

/**
 * Parses and strictly validates an incremental-change-staleness scenario
 * catalog JSON file. Never mutates the referenced benchmark project/case
 * files or the catalog file itself; mutation validation runs entirely
 * in-memory.
 */
export async function readIncrementalChangeStalenessScenarioCatalog(
  catalogPath: string,
  profiles: BenchmarkProjectProfile[],
  cases: EvaluationCase[],
  repoRoot: string = process.cwd(),
  options: ReadIncrementalChangeStalenessScenarioCatalogOptions = { requireFrozenProductionScenarios: true }
): Promise<IncrementalChangeStalenessScenarioCatalog> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(await readFile(catalogPath, "utf8"));
  } catch (error) {
    throw new Error(`Failed to parse incremental-change-staleness scenario catalog: ${(error as Error).message}`);
  }

  const errors = await validateIncrementalChangeStalenessCatalog(parsed, profiles, cases, repoRoot, {
    requireFrozenProductionScenarios: options.requireFrozenProductionScenarios ?? true
  });
  if (errors.length > 0) {
    throw new Error(`Invalid incremental-change-staleness scenario catalog:\n${errors.join("\n")}`);
  }

  return parsed as IncrementalChangeStalenessScenarioCatalog;
}

/**
 * Convenience loader for the canonical production catalog and its two
 * existing benchmark-contract dependencies, resolved relative to `repoRoot`.
 * This is the loader later batches (and this batch's tests) should use to
 * obtain the validated, immutable production scenario set.
 */
export async function readProductionIncrementalChangeStalenessScenarioCatalog(
  repoRoot: string = process.cwd()
): Promise<IncrementalChangeStalenessScenarioCatalog> {
  const profiles = await readBenchmarkProjectProfiles(path.resolve(repoRoot, BENCHMARK_PROJECT_PROFILES_PATH), repoRoot);
  const cases = await readEvaluationCases(path.resolve(repoRoot, WARM_INDEX_BENCHMARK_CASES_PATH), repoRoot);
  return readIncrementalChangeStalenessScenarioCatalog(
    path.resolve(repoRoot, INCREMENTAL_CHANGE_STALENESS_SCENARIO_CATALOG_PATH),
    profiles,
    cases,
    repoRoot,
    { requireFrozenProductionScenarios: true }
  );
}
