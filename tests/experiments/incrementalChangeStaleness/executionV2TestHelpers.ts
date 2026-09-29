import { rm } from "node:fs/promises";
import path from "node:path";
import { readBenchmarkProjectProfiles } from "../../../src/evaluation/benchmarkMetadata.js";
import { BENCHMARK_PROJECT_PROFILES_PATH } from "../../../src/experiments/plugins/incrementalChangeStaleness/scenarioCatalog.js";
import {
  executeIncrementalChangeStalenessScenarioV2,
  type IncrementalChangeStalenessScenarioExecutionV2
} from "../../../src/experiments/plugins/incrementalChangeStaleness/executionV2.js";
import type { IncrementalChangeStalenessExecutionDeps } from "../../../src/experiments/plugins/incrementalChangeStaleness/execution.js";
import { resolveIncrementalChangeStalenessQueryAndAnswer } from "../../../src/experiments/plugins/incrementalChangeStaleness/execution.js";
import { prepareIncrementalChangeStalenessScenarioLifecycleV2 } from "../../../src/experiments/plugins/incrementalChangeStaleness/lifecycleV2.js";
import type { IncrementalChangeStalenessLifecycleResultV2 } from "../../../src/experiments/plugins/incrementalChangeStaleness/treatmentSessionV2.js";
import {
  makeKitDir,
  makeRunOwnedRoot,
  repoRoot,
  resolveScenario,
  writeIncrementalLifecycleFakeKit,
  type IncrementalFakeKitOptions
} from "./lifecycleTestHelpers.js";

export async function loadProjectProfiles() {
  return readBenchmarkProjectProfiles(path.resolve(repoRoot, BENCHMARK_PROJECT_PROFILES_PATH), repoRoot);
}

export async function requiredFilesOf(scenarioId: string): Promise<string[]> {
  const resolved = await resolveScenario(scenarioId);
  return (await resolveIncrementalChangeStalenessQueryAndAnswer({ scenario: resolved.scenario, repoRoot })).expectedFiles;
}

/**
 * Prepares a real Batch 2 V2 lifecycle (against the test-local incremental fake kit) and executes it once.
 * `mapFor` builds the per-index search map from the scenario's required files so tests can force
 * required-file present/missing per treatment index directory.
 */
export async function prepareAndExecuteV2(
  tracked: string[],
  scenarioId: string,
  options: {
    kit?: IncrementalFakeKitOptions;
    searchByTreatment?: Partial<Record<string, "present" | "missing">>;
    execDeps?: Partial<IncrementalChangeStalenessExecutionDeps>;
    transformLifecycle?: (lifecycle: IncrementalChangeStalenessLifecycleResultV2) => IncrementalChangeStalenessLifecycleResultV2;
  } = {}
): Promise<{
  execution: IncrementalChangeStalenessScenarioExecutionV2;
  lifecycle: IncrementalChangeStalenessLifecycleResultV2;
  runOwnedRoot: string;
}> {
  const resolved = await resolveScenario(scenarioId);
  const required = await requiredFilesOf(scenarioId);
  const runOwnedRoot = makeRunOwnedRoot(tracked, "ics-v2-exec-");
  const searchMap = Object.entries(options.searchByTreatment ?? {}).map(([treatment, mode]) => ({
    whenIndexDirContains: `/${treatment}/${treatment === "stale-index" ? "baseline" : "refreshed"}`,
    file: mode === "present" ? required[0] : "src/unrelated/other.ts",
    symbol: "someSymbol"
  }));
  const kit = writeIncrementalLifecycleFakeKit(makeKitDir(tracked), { ...options.kit, ...(searchMap.length > 0 ? { searchMap } : {}) });
  const lifecycleRaw = await prepareIncrementalChangeStalenessScenarioLifecycleV2({
    repoRoot,
    runOwnedRoot,
    scenario: resolved.scenario,
    baseCase: resolved.baseCase,
    kitCommand: kit.command
  });
  const lifecycle = options.transformLifecycle ? options.transformLifecycle(lifecycleRaw) : lifecycleRaw;
  const execution = await executeIncrementalChangeStalenessScenarioV2({
    repoRoot,
    scenario: resolved.scenario,
    lifecycle,
    baseCase: resolved.baseCase,
    projectProfiles: await loadProjectProfiles(),
    runOwnedRoot,
    cwd: repoRoot,
    deps: options.execDeps
  });
  return { execution, lifecycle, runOwnedRoot };
}

export async function cleanup(tracked: string[]): Promise<void> {
  await Promise.all(tracked.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
}
