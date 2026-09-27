import path from "node:path";
import { readBenchmarkProjectProfiles } from "../../../evaluation/benchmarkMetadata.js";
import { readEvaluationCases } from "../../../evaluation/readEvaluationCases.js";
import type { BenchmarkProjectProfile, EvaluationCase } from "../../../evaluation/types.js";
import { normalizeRootForComparison } from "./lifecyclePolicy.js";
import {
  BENCHMARK_PROJECT_PROFILES_PATH,
  INCREMENTAL_CHANGE_STALENESS_SCENARIO_CATALOG_PATH,
  WARM_INDEX_BENCHMARK_CASES_PATH,
  readIncrementalChangeStalenessScenarioCatalog
} from "./scenarioCatalog.js";
import type { IncrementalChangeStalenessScenario, IncrementalChangeStalenessScenarioCatalog } from "./scenarioTypes.js";
import type { IncrementalChangeStalenessBaseCaseIdentityV1 } from "./treatmentSession.js";

export type IncrementalChangeStalenessResolvedScenarioV1 = {
  readonly scenario: IncrementalChangeStalenessScenario;
  readonly baseCase: IncrementalChangeStalenessBaseCaseIdentityV1;
};

/**
 * Policy: selects scenarios from the validated catalog. No selection means
 * every catalog scenario. An explicit selection must be non-empty, contain no
 * duplicates, and name only catalog scenarios. The result always follows
 * catalog order, never request order, so run ordering is deterministic.
 */
export function selectIncrementalChangeStalenessScenarios(
  catalog: IncrementalChangeStalenessScenarioCatalog,
  scenarioIds?: readonly string[]
): IncrementalChangeStalenessScenario[] {
  if (scenarioIds === undefined) {
    return [...catalog.scenarios];
  }
  if (scenarioIds.length === 0) {
    throw new Error("Scenario selection must name at least one scenario when provided.");
  }
  const duplicates = scenarioIds.filter((id, index) => scenarioIds.indexOf(id) !== index);
  if (duplicates.length > 0) {
    throw new Error(`Scenario selection contains duplicate scenario id(s): ${[...new Set(duplicates)].join(", ")}.`);
  }
  const known = new Set(catalog.scenarios.map((scenario) => scenario.id));
  const unknown = scenarioIds.filter((id) => !known.has(id));
  if (unknown.length > 0) {
    throw new Error(`Unknown incremental-change-staleness scenario id(s): ${unknown.join(", ")}. Known: ${[...known].join(", ")}.`);
  }
  const requested = new Set(scenarioIds);
  return catalog.scenarios.filter((scenario) => requested.has(scenario.id));
}

/**
 * Policy: resolves a scenario's canonical base case identity from the existing
 * benchmark case and project-profile contracts. Source roots always come from
 * the base case; the canonical project root always comes from the project
 * profile, and the two must agree.
 */
export function resolveIncrementalChangeStalenessBaseCase(
  scenario: IncrementalChangeStalenessScenario,
  cases: readonly EvaluationCase[],
  profiles: readonly BenchmarkProjectProfile[],
  repoRoot: string
): IncrementalChangeStalenessBaseCaseIdentityV1 {
  const baseCase = cases.find((candidate) => candidate.id === scenario.baseCaseId);
  if (!baseCase) {
    throw new Error(`Scenario ${scenario.id}: base case ${scenario.baseCaseId} was not found.`);
  }
  const profile = profiles.find((candidate) => candidate.projectId === scenario.benchmarkProjectId);
  if (!profile) {
    throw new Error(`Scenario ${scenario.id}: benchmark project ${scenario.benchmarkProjectId} was not found.`);
  }
  if (baseCase.benchmarkProject !== scenario.benchmarkProjectId) {
    throw new Error(`Scenario ${scenario.id}: base case ${baseCase.id} belongs to ${baseCase.benchmarkProject}, not ${scenario.benchmarkProjectId}.`);
  }
  const canonicalProjectRoot = path.resolve(repoRoot, profile.rootPath);
  if (normalizeRootForComparison(canonicalProjectRoot) !== normalizeRootForComparison(baseCase.absoluteTargetRoot)) {
    throw new Error(
      `Scenario ${scenario.id}: base case target root ${baseCase.absoluteTargetRoot} does not match project profile root ${canonicalProjectRoot}.`
    );
  }
  if (!Array.isArray(baseCase.sourceRoots) || baseCase.sourceRoots.length === 0) {
    throw new Error(`Scenario ${scenario.id}: base case ${baseCase.id} declares no source roots.`);
  }
  return Object.freeze({
    caseId: baseCase.id,
    benchmarkProjectId: scenario.benchmarkProjectId,
    canonicalProjectRootRelative: profile.rootPath,
    canonicalProjectRoot,
    sourceRoots: Object.freeze([...baseCase.sourceRoots])
  });
}

/**
 * Loads the canonical production scenario catalog (the only mutation
 * authority) and its benchmark case/profile dependencies, then resolves the
 * selected scenarios with their base-case identities in catalog order.
 * Read-only.
 */
export async function resolveIncrementalChangeStalenessScenarios(options: {
  repoRoot: string;
  scenarioIds?: readonly string[];
}): Promise<IncrementalChangeStalenessResolvedScenarioV1[]> {
  const { repoRoot } = options;
  const profiles = await readBenchmarkProjectProfiles(path.resolve(repoRoot, BENCHMARK_PROJECT_PROFILES_PATH), repoRoot);
  const cases = await readEvaluationCases(path.resolve(repoRoot, WARM_INDEX_BENCHMARK_CASES_PATH), repoRoot);
  const catalog = await readIncrementalChangeStalenessScenarioCatalog(
    path.resolve(repoRoot, INCREMENTAL_CHANGE_STALENESS_SCENARIO_CATALOG_PATH),
    profiles,
    cases,
    repoRoot,
    { requireFrozenProductionScenarios: true }
  );
  return selectIncrementalChangeStalenessScenarios(catalog, options.scenarioIds).map((scenario) => ({
    scenario,
    baseCase: resolveIncrementalChangeStalenessBaseCase(scenario, cases, profiles, repoRoot)
  }));
}
