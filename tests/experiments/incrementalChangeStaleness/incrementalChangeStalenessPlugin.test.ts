import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { rm } from "node:fs/promises";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  contextStrategyComparisonPlugin,
  createDefaultExperimentPluginRegistry,
  runExperiment,
  warmIndexReusePlugin
} from "../../../src/experiments/index.js";
import {
  INCREMENTAL_CHANGE_STALENESS_DEFAULT_KIT_COMMAND,
  defaultIncrementalChangeStalenessConfig,
  validateIncrementalChangeStalenessConfig
} from "../../../src/experiments/plugins/incrementalChangeStaleness/config.js";
import { DEFAULT_INCREMENTAL_CHANGE_STALENESS_RUNTIME_ROOT_RELATIVE } from "../../../src/experiments/plugins/incrementalChangeStaleness/disposableTarget.js";
import {
  INCREMENTAL_CHANGE_STALENESS_RUN_OWNER_MARKER,
  cleanupIncrementalChangeStalenessRun,
  incrementalChangeStalenessPlugin,
  resolveIncrementalChangeStalenessRunOwnedRoot
} from "../../../src/experiments/plugins/incrementalChangeStaleness/plugin.js";
import {
  resolveIncrementalChangeStalenessScenarios,
  selectIncrementalChangeStalenessScenarios
} from "../../../src/experiments/plugins/incrementalChangeStaleness/scenarioSelection.js";
import { readProductionIncrementalChangeStalenessScenarioCatalog } from "../../../src/experiments/plugins/incrementalChangeStaleness/scenarioCatalog.js";
import { writeFakeKitVariant } from "../warmIndexReuse/warmIndexTestHelpers.js";
import {
  expectCanonicalFilesUnchanged,
  expectNoIndexOutputInCanonicalProjects,
  makeKitDir,
  makeRunOwnedRoot,
  readKitLog,
  readIndexArgsLog,
  repoRoot,
  writeIncrementalLifecycleFakeKit,
  writeLifecycleFakeKit
} from "./lifecycleTestHelpers.js";

const tracked: string[] = [];
const trackedRunIds: string[] = [];
afterEach(async () => {
  await Promise.all(tracked.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
  for (const runId of trackedRunIds.splice(0)) {
    await rm(resolveIncrementalChangeStalenessRunOwnedRoot(repoRoot, runId), { recursive: true, force: true });
  }
  expectCanonicalFilesUnchanged();
  expectNoIndexOutputInCanonicalProjects();
});

let runCounter = 0;
function uniqueRunId(label: string): string {
  runCounter += 1;
  const runId = `ics-batch3-test-${label}-${process.pid}-${Date.now()}-${runCounter}`;
  trackedRunIds.push(runId);
  return runId;
}

function outDir(): string {
  return makeRunOwnedRoot(tracked, "ics-batch3-out-");
}

describe("incremental-change-staleness registration (TST-B3-001..003, 052)", () => {
  it("registers exactly once in the default registry after the unchanged existing plugins", () => {
    const registry = createDefaultExperimentPluginRegistry();
    const ids = registry.list().map((metadata) => metadata.id);
    expect(ids).toEqual(["context-strategy-comparison", "warm-index-reuse", "incremental-change-staleness"]);
    expect(ids.filter((id) => id === "incremental-change-staleness")).toHaveLength(1);
    expect(registry.get("incremental-change-staleness")).toBe(incrementalChangeStalenessPlugin);
    expect(registry.get("context-strategy-comparison")).toBe(contextStrategyComparisonPlugin);
    expect(registry.get("warm-index-reuse")).toBe(warmIndexReusePlugin);
    expect(warmIndexReusePlugin.supportedVariants).toEqual(["raw-full-file", "warm-index-reuse"]);
  });

  it("declares deterministic experimental metadata and exactly the four v0.6.3 treatments in fixed order", () => {
    expect(incrementalChangeStalenessPlugin.metadata).toEqual({
      id: "incremental-change-staleness",
      name: "Incremental Change Staleness",
      description:
        "Compares no refresh, my-dev-kit changed-files incremental refresh, my-dev-kit affected-neighborhood incremental refresh, and full refresh after the same deterministic controlled source change. Comparisons are scoped to the observed evidence (correctness and required-file presence); full refresh is a reference treatment, not an asserted winner, and a partial treatment may truthfully fall back to a full rebuild.",
      schemaVersion: "1.0.0",
      status: "experimental",
      supportedTargets: ["self"],
      supportedOutputs: ["json", "html"]
    });
    expect(incrementalChangeStalenessPlugin.supportedVariants).toEqual(["stale-index", "changed-files-refresh", "affected-neighborhood-refresh", "full-refresh"]);
    expect(defaultIncrementalChangeStalenessConfig).toEqual({
      outDir: "lab-output/incremental-change-staleness",
      kitCommand: "npx @dailephd/my-dev-kit@1.12.5"
    });
    expect(INCREMENTAL_CHANGE_STALENESS_DEFAULT_KIT_COMMAND).toBe("npx @dailephd/my-dev-kit@1.12.5");
    expect(incrementalChangeStalenessPlugin.configDefinition?.fields.map((field) => field.name)).toEqual(["outDir", "kitCommand", "caseIds"]);
    const caseIdsDescription = incrementalChangeStalenessPlugin.configDefinition?.fields.find((field) => field.name === "caseIds")?.description ?? "";
    for (const treatment of ["stale-index", "changed-files-refresh", "affected-neighborhood-refresh", "full-refresh"]) {
      expect(caseIdsDescription).toContain(treatment);
    }
    expect(caseIdsDescription).toContain("All four treatments run for each selected scenario");
    expect(caseIdsDescription).not.toContain("Both stale-index and full-refresh");
  });
});

describe("config and scenario selection (TST-B3-004, 005, 029)", () => {
  it("accepts the default config and a frozen subset", () => {
    expect(validateIncrementalChangeStalenessConfig({}).valid).toBe(true);
    expect(validateIncrementalChangeStalenessConfig({ caseIds: ["L2", "T1"] }).config?.caseIds).toEqual(["L2", "T1"]);
  });

  it.each([
    [{ caseIds: ["X9"] }, "unknown scenario id"],
    [{ caseIds: ["L2", "L2"] }, "duplicate scenario id"],
    [{ caseIds: [] }, "non-empty array"],
    [{ caseIds: "L2" }, "non-empty array"],
    [{ strategies: ["stale-index"] }, "Unsupported"],
    [{ variants: ["stale-index"] }, "Unsupported"],
    [{ scenarioCatalogPath: "x.json" }, "Unsupported"],
    [{ mutation: { files: [] } }, "Unsupported"],
    [{ kitCommand: "  " }, "kitCommand must be a non-empty string"]
  ])("rejects %j", (config, message) => {
    const validation = validateIncrementalChangeStalenessConfig(config);
    expect(validation.valid).toBe(false);
    expect(validation.errors.join(" ")).toContain(message);
  });

  it("resolves the canonical catalog in catalog order with canonical base-case identity", async () => {
    const all = await resolveIncrementalChangeStalenessScenarios({ repoRoot });
    expect(all.map((entry) => entry.scenario.id)).toEqual(["U1", "L2", "E1", "P1", "I1", "T1"]);
    const l2 = all.find((entry) => entry.scenario.id === "L2")!;
    expect(l2.baseCase).toEqual({
      caseId: "warm-medium-complete-idempotent",
      benchmarkProjectId: "task-workflow-medium-ts",
      canonicalProjectRootRelative: "benchmarks/projects/task-workflow-medium-ts",
      canonicalProjectRoot: path.resolve(repoRoot, "benchmarks/projects/task-workflow-medium-ts"),
      sourceRoots: ["src", "tests"]
    });
    const subset = await resolveIncrementalChangeStalenessScenarios({ repoRoot, scenarioIds: ["T1", "U1"] });
    expect(subset.map((entry) => entry.scenario.id)).toEqual(["U1", "T1"]);
  });

  it("selection policy rejects empty, duplicate, and unknown ids", async () => {
    const catalog = await readProductionIncrementalChangeStalenessScenarioCatalog(repoRoot);
    expect(() => selectIncrementalChangeStalenessScenarios(catalog, [])).toThrow("at least one");
    expect(() => selectIncrementalChangeStalenessScenarios(catalog, ["L2", "L2"])).toThrow("duplicate");
    expect(() => selectIncrementalChangeStalenessScenarios(catalog, ["Z1"])).toThrow("Unknown");
  });

  it("fails invalid scenario ids before any target or index work", async () => {
    const kit = writeLifecycleFakeKit(makeKitDir(tracked));
    const runId = uniqueRunId("invalid");
    await expect(
      runExperiment({
        pluginId: "incremental-change-staleness",
        outputRoot: outDir(),
        config: { caseIds: ["L2", "Q7"], kitCommand: kit.command },
        toolRoot: repoRoot,
        runId
      })
    ).rejects.toThrow("unknown scenario id");
    expect(readKitLog(kit.logPath)).toEqual([]);
    expect(existsSync(resolveIncrementalChangeStalenessRunOwnedRoot(repoRoot, runId))).toBe(false);
  });
});

describe("plugin run behavior (TST-B3-006, 048..051; v0.6.2 Batch 4)", () => {
  it("runs matched V2 lifecycles and four-treatment execution in catalog order, writes the V2 execution artifact, then cleans up", async () => {
    const kit = writeIncrementalLifecycleFakeKit(makeKitDir(tracked));
    const runId = uniqueRunId("run");
    const runtimeParent = path.resolve(repoRoot, DEFAULT_INCREMENTAL_CHANGE_STALENESS_RUNTIME_ROOT_RELATIVE);
    const sibling = path.join(runtimeParent, `${runId}-sibling`);
    mkdirSync(sibling, { recursive: true });
    writeFileSync(path.join(sibling, "keep.txt"), "not owned by the run");
    tracked.push(sibling);
    const runOutputRoot = outDir();

    const run = await runExperiment({
      pluginId: "incremental-change-staleness",
      outputRoot: runOutputRoot,
      config: { caseIds: ["L2", "U1"], kitCommand: kit.command },
      toolRoot: repoRoot,
      runId
    });

    // TST-B3-049 / Batch 4 section 37: scenario catalog order, then stale-index, then full-refresh.
    expect(run.cases.map((experimentCase) => experimentCase.id)).toEqual(["U1", "L2"]);
    expect(run.cases.flatMap((experimentCase) => experimentCase.outcomes.map((outcome) => outcome.id))).toEqual([
      "U1:stale-index",
      "U1:changed-files-refresh",
      "U1:affected-neighborhood-refresh",
      "U1:full-refresh",
      "L2:stale-index",
      "L2:changed-files-refresh",
      "L2:affected-neighborhood-refresh",
      "L2:full-refresh"
    ]);
    expect(run.variants.map((variant) => variant.id)).toEqual(["stale-index", "changed-files-refresh", "affected-neighborhood-refresh", "full-refresh"]);

    // This deterministic fake kit produces complete, non-empty retrieval/fake-agent evidence for
    // both treatments of both scenarios, so the run is a real `completed` result, never fabricated.
    expect(run.status).toBe("completed");
    expect(run.summary?.completedCases).toBe(2);
    expect(run.metrics.map((entry) => entry.id)).toEqual([
      "incremental-change-staleness-scenario-count",
      "incremental-change-staleness-observed-regression-count",
      "incremental-change-staleness-changed-files-applied-partial-count",
      "incremental-change-staleness-changed-files-fallback-full-count",
      "incremental-change-staleness-affected-neighborhood-applied-partial-count",
      "incremental-change-staleness-affected-neighborhood-fallback-full-count"
    ]);
    expect(run.metrics.find((entry) => entry.id === "incremental-change-staleness-scenario-count")?.value).toBe(2);
    expect(run.metadata).toEqual(expect.objectContaining({ kitCommand: kit.command, scenarioIds: ["U1", "L2"] }));
    expect(run.artifacts[0].id).toBe("incremental-change-staleness-execution");
    expect(existsSync(run.artifacts[0].path!)).toBe(true);

    for (const experimentCase of run.cases) {
      expect(experimentCase.metadata?.scenarioStatus).toBe("ready");
      for (const outcome of experimentCase.outcomes) {
        expect(outcome.status).toBe("completed");
        expect(outcome.failures).toEqual([]);
        // Real evidence is emitted now, not a placeholder empty array.
        expect(outcome.metrics.length).toBeGreaterThan(0);
        expect(outcome.metadata).toEqual(
          expect.objectContaining({ retrievalStatus: "completed", fakeAgentStatus: "completed" })
        );
      }
      const [stale, changed, affected, full] = experimentCase.outcomes;
      expect(stale.metadata).toEqual(expect.objectContaining({ activeIndexPhase: "baseline", refreshKind: "no-refresh", refreshRealization: "NO_REFRESH" }));
      expect(changed.metadata).toEqual(
        expect.objectContaining({ activeIndexPhase: "refreshed", refreshKind: "incremental", refreshRealization: "APPLIED_PARTIAL", requestedScope: "changed-files", appliedScope: "changed-files", selectionStatus: "applied", fallbackReason: null })
      );
      expect(affected.metadata).toEqual(
        expect.objectContaining({ refreshRealization: "APPLIED_PARTIAL", requestedScope: "affected-neighborhood", appliedScope: "affected-neighborhood", selectionStatus: "applied" })
      );
      expect(full.metadata).toEqual(expect.objectContaining({ activeIndexPhase: "refreshed", refreshKind: "full", refreshRealization: "FULL_REFRESH" }));
      expect(stale.metadata).not.toHaveProperty("requestedScope");
      expect(full.metadata).not.toHaveProperty("appliedScope");
    }
    // Seven index invocations per scenario (four incremental bootstraps, two partial refreshes, one full build).
    expect(readIndexArgsLog(kit.argsLogPath)).toHaveLength(14);

    // The normal run persisted the V2 execution artifact under the canonical filename.
    const persisted = JSON.parse(readFileSync(run.artifacts[0].path!, "utf8")) as { schemaVersion: string; scenarios: Array<{ treatments: unknown[]; referenceComparisons: unknown[] }> };
    expect(path.basename(run.artifacts[0].path!)).toBe("incremental-change-staleness-execution.json");
    expect(persisted.schemaVersion).toBe("my-dev-kit-lab-incremental-change-staleness-execution-v2");
    expect(persisted.scenarios.map((scenario) => [scenario.treatments.length, scenario.referenceComparisons.length])).toEqual([[4, 3], [4, 3]]);

    // TST-B3-050: the run-owned root is removed; the sibling directory is untouched.
    expect(existsSync(resolveIncrementalChangeStalenessRunOwnedRoot(repoRoot, runId))).toBe(false);
    expect(existsSync(path.join(sibling, "keep.txt"))).toBe(true);
    await rm(runOutputRoot, { recursive: true, force: true });
  }, 120_000);

  it("maps a failed lifecycle to four failed outcomes without fabricated evidence", async () => {
    const command = writeFakeKitVariant(makeKitDir(tracked), { failOn: "index" });
    const runId = uniqueRunId("fail");
    const run = await runExperiment({
      pluginId: "incremental-change-staleness",
      outputRoot: outDir(),
      config: { caseIds: ["L2"], kitCommand: command },
      toolRoot: repoRoot,
      runId
    });
    expect(run.status).toBe("failed");
    const [experimentCase] = run.cases;
    expect(experimentCase.outcomes.map((outcome) => [outcome.variantId, outcome.status])).toEqual([
      ["stale-index", "failed"],
      ["changed-files-refresh", "failed"],
      ["affected-neighborhood-refresh", "failed"],
      ["full-refresh", "failed"]
    ]);
    for (const outcome of experimentCase.outcomes) {
      expect(outcome.metrics).toEqual([]);
      expect(outcome.failures.map((failure) => failure.code)).toEqual(["incremental-change-staleness-scenario-failed"]);
      expect(outcome.metadata).toEqual(expect.objectContaining({ scenarioStatus: "failed" }));
    }
    expect(existsSync(resolveIncrementalChangeStalenessRunOwnedRoot(repoRoot, runId))).toBe(false);
  }, 60_000);

  it("rejects an external target explicitly", async () => {
    const external = makeRunOwnedRoot(tracked, "ics-batch3-external-");
    const run = await runExperiment({
      pluginId: "incremental-change-staleness",
      targetPath: external,
      outputRoot: outDir(),
      config: { caseIds: ["L2"] },
      toolRoot: repoRoot,
      runId: uniqueRunId("external")
    });
    expect(run.status).toBe("failed");
    expect(run.failures[0].message).toContain("external --target is not supported");
  });

  it("never deletes a pre-existing directory it does not own", async () => {
    const runId = uniqueRunId("preexisting");
    const root = resolveIncrementalChangeStalenessRunOwnedRoot(repoRoot, runId);
    mkdirSync(root, { recursive: true });
    writeFileSync(path.join(root, "foreign.txt"), "foreign");
    const run = await runExperiment({
      pluginId: "incremental-change-staleness",
      outputRoot: outDir(),
      config: { caseIds: ["L2"] },
      toolRoot: repoRoot,
      runId
    });
    expect(run.status).toBe("failed");
    expect(run.failures[0].message).toContain("refusing to reuse");
    expect(existsSync(path.join(root, "foreign.txt"))).toBe(true);
    expect(await cleanupIncrementalChangeStalenessRun(repoRoot, runId)).toBe(false);
    expect(existsSync(path.join(root, "foreign.txt"))).toBe(true);
  });

  it("cleanup removes only a root carrying this run's ownership marker", async () => {
    const runId = uniqueRunId("marker");
    const root = resolveIncrementalChangeStalenessRunOwnedRoot(repoRoot, runId);
    mkdirSync(path.join(root, "indexes"), { recursive: true });
    writeFileSync(path.join(root, INCREMENTAL_CHANGE_STALENESS_RUN_OWNER_MARKER), JSON.stringify({ pluginId: "incremental-change-staleness", runId: "someone-else" }));
    expect(await cleanupIncrementalChangeStalenessRun(repoRoot, runId)).toBe(false);
    expect(existsSync(root)).toBe(true);
    writeFileSync(path.join(root, INCREMENTAL_CHANGE_STALENESS_RUN_OWNER_MARKER), JSON.stringify({ pluginId: "incremental-change-staleness", runId }));
    expect(await cleanupIncrementalChangeStalenessRun(repoRoot, runId)).toBe(true);
    expect(existsSync(root)).toBe(false);
    // The shared runtime parent (and benchmarks) remain.
    expect(existsSync(path.dirname(root))).toBe(true);
    expect(readdirSync(path.resolve(repoRoot, "benchmarks/projects")).length).toBeGreaterThan(0);
  });
});
