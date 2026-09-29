import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { rm } from "node:fs/promises";
import { createHash } from "node:crypto";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  INCREMENTAL_CHANGE_STALENESS_TREATMENT_IDS,
  INCREMENTAL_CHANGE_STALENESS_V2_TREATMENT_IDS,
  INCREMENTAL_CHANGE_STALENESS_V2_TREATMENT_INTENTS
} from "../../../src/experiments/plugins/incrementalChangeStaleness/disposableTarget.js";
import { cloneIncrementalChangeStalenessIndexDirectory } from "../../../src/experiments/plugins/incrementalChangeStaleness/indexClone.js";
import { incrementalChangeStalenessIndexDir } from "../../../src/experiments/plugins/incrementalChangeStaleness/lifecycle.js";
import {
  prepareIncrementalChangeStalenessScenarioLifecycleV2,
  type IncrementalChangeStalenessLifecycleDepsV2
} from "../../../src/experiments/plugins/incrementalChangeStaleness/lifecycleV2.js";
import { incrementalChangeStalenessPlugin } from "../../../src/experiments/plugins/incrementalChangeStaleness/plugin.js";
import { FROZEN_INCREMENTAL_CHANGE_STALENESS_SCENARIO_IDS } from "../../../src/experiments/plugins/incrementalChangeStaleness/scenarioTypes.js";
import type { IncrementalChangeStalenessLifecycleResultV2 } from "../../../src/experiments/plugins/incrementalChangeStaleness/treatmentSessionV2.js";
import {
  expectCanonicalFilesUnchanged,
  expectNoIndexOutputInCanonicalProjects,
  makeKitDir,
  makeRunOwnedRoot,
  readIndexArgsLog,
  repoRoot,
  resolveScenario,
  writeIncrementalLifecycleFakeKit,
  type IncrementalFakeKitOptions
} from "./lifecycleTestHelpers.js";

const tracked: string[] = [];
afterEach(async () => {
  await Promise.all(tracked.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
  expectCanonicalFilesUnchanged();
  expectNoIndexOutputInCanonicalProjects();
});

async function runV2(scenarioId: string, kitOptions: IncrementalFakeKitOptions = {}, deps: Partial<IncrementalChangeStalenessLifecycleDepsV2> = {}) {
  const resolved = await resolveScenario(scenarioId);
  const runOwnedRoot = makeRunOwnedRoot(tracked, "ics-v2-");
  const kit = writeIncrementalLifecycleFakeKit(makeKitDir(tracked), kitOptions);
  const result = await prepareIncrementalChangeStalenessScenarioLifecycleV2({
    repoRoot,
    runOwnedRoot,
    scenario: resolved.scenario,
    baseCase: resolved.baseCase,
    kitCommand: kit.command,
    deps
  });
  return { result, runOwnedRoot, indexArgs: () => readIndexArgsLog(kit.argsLogPath) };
}

function ready(result: IncrementalChangeStalenessLifecycleResultV2) {
  if (result.status !== "ready") throw new Error(`Expected ready, got ${result.failure.code}: ${result.failure.message}`);
  return result.session;
}

function failed(result: IncrementalChangeStalenessLifecycleResultV2) {
  if (result.status !== "failed") throw new Error("Expected a failed lifecycle.");
  return result;
}

function hashTree(root: string): Record<string, string> {
  const out: Record<string, string> = {};
  const walk = (dir: string) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else out[path.relative(root, full).replace(/\\/g, "/")] = createHash("sha256").update(readFileSync(full)).digest("hex");
    }
  };
  walk(root);
  return out;
}

const ALL_IDS = [...INCREMENTAL_CHANGE_STALENESS_V2_TREATMENT_IDS];

describe("v0.6.3 four-treatment lifecycle: identities and v0.6.2 compatibility", () => {
  it("defines four treatments in fixed order with separate treatment intents", () => {
    expect(ALL_IDS).toEqual(["stale-index", "changed-files-refresh", "affected-neighborhood-refresh", "full-refresh"]);
    expect(INCREMENTAL_CHANGE_STALENESS_V2_TREATMENT_INTENTS).toEqual({
      "stale-index": "my-dev-kit-no-refresh",
      "changed-files-refresh": "my-dev-kit-changed-files-refresh",
      "affected-neighborhood-refresh": "my-dev-kit-affected-neighborhood-refresh",
      "full-refresh": "my-dev-kit-full-refresh"
    });
  });

  it("keeps the released V1 treatment constant at two treatments while the public plugin now exposes the four (Batch 4)", () => {
    expect([...INCREMENTAL_CHANGE_STALENESS_TREATMENT_IDS]).toEqual(["stale-index", "full-refresh"]);
    expect([...(incrementalChangeStalenessPlugin.supportedVariants ?? [])]).toEqual([...ALL_IDS]);
  });
});

describe("v0.6.3 four-treatment lifecycle: happy path", () => {
  it.each([...FROZEN_INCREMENTAL_CHANGE_STALENESS_SCENARIO_IDS])("%s completes with 7 index invocations and 7 freshness assessments", async (scenarioId) => {
    const { result, indexArgs } = await runV2(scenarioId);
    const session = ready(result);
    expect(session.totalIndexInvocationCount).toBe(7);
    expect(session.totalFreshnessAssessmentCount).toBe(7);
    expect(indexArgs()).toHaveLength(7);
    for (const id of ALL_IDS) {
      expect(session.treatments[id].treatmentId).toBe(id);
      expect(session.treatments[id].treatmentIntent).toBe(INCREMENTAL_CHANGE_STALENESS_V2_TREATMENT_INTENTS[id]);
    }
  });

  it("proves targets, bootstrap, mutation barrier, clones, isolation, counts, and realization for U1", async () => {
    let baselineHashesAtClone: Record<string, Record<string, string>> = {};
    const { result, runOwnedRoot, indexArgs } = await runV2(
      "U1",
      {},
      {
        cloneIndexDirectory: async (root, source, destination) => {
          baselineHashesAtClone[source] = hashTree(source);
          await cloneIncrementalChangeStalenessIndexDirectory(root, source, destination);
        }
      }
    );
    const session = ready(result);
    const resolved = await resolveScenario("U1");

    // Four independent contained targets derived from one canonical benchmark.
    const roots = ALL_IDS.map((id) => session.treatments[id].target.targetRoot);
    expect(new Set(roots.map((root) => root.toLowerCase())).size).toBe(4);
    for (const id of ALL_IDS) {
      const target = session.treatments[id].target;
      expect(target.canonicalProjectRoot).toBe(resolved.baseCase.canonicalProjectRoot);
      expect(path.relative(runOwnedRoot, target.targetRoot).startsWith("..")).toBe(false);
      expect(path.relative(target.canonicalProjectRoot, target.targetRoot).startsWith("..")).toBe(true);
      expect(path.basename(target.targetRoot)).toBe(id);
    }

    // Pairwise equivalence against the stale-index reference is preserved, not collapsed.
    expect(Object.keys(session.preMutationEquivalence)).toEqual(["changed-files-refresh", "affected-neighborhood-refresh", "full-refresh"]);
    for (const comparison of [...Object.values(session.preMutationEquivalence), ...Object.values(session.postMutationEquivalence)]) {
      expect(comparison.result).toBe("equivalent");
    }

    // Invocation shapes: four incremental changed-files bootstraps, then two partial refreshes, then one full build.
    const args = indexArgs();
    const scopeOf = (a: string[]) => (a.includes("--incremental") ? a[a.indexOf("--refresh-scope") + 1] : "full");
    expect(args.map(scopeOf)).toEqual(["changed-files", "changed-files", "changed-files", "changed-files", "changed-files", "affected-neighborhood", "full"]);
    expect(args[6]).not.toContain("--incremental");
    expect(args[6]).not.toContain("--refresh-scope");
    const outs = args.map((a) => a[a.indexOf("--out") + 1].replace(/\\/g, "/"));
    expect(outs[0]).toContain("/stale-index/baseline");
    expect(outs[3]).toContain("/full-refresh/baseline");
    expect(outs[4]).toContain("/changed-files-refresh/refreshed");
    expect(outs[5]).toContain("/affected-neighborhood-refresh/refreshed");
    expect(outs[6]).toContain("/full-refresh/refreshed");

    // Every baseline bootstrap is the expected cache-missing full fallback.
    for (const id of ALL_IDS) {
      const bootstrap = session.treatments[id].changeAuthority.baselineBootstrap;
      expect(bootstrap).toMatchObject({ requestedScope: "changed-files", appliedScope: "full", selectionStatus: "fallback-full", fallbackReason: "cache-missing" });
      expect(session.treatments[id].changeAuthority.baselineIndex.buildMode).toEqual({ kind: "incremental", refreshScope: "changed-files" });
    }

    // Events: all baselines + clones before the first mutation; mutations before any refresh.
    const events = [...session.lifecycleEvents];
    const at = (event: string) => events.indexOf(event);
    expect(at("treatment-targets-created")).toBeLessThan(at("pre-mutation-equivalence-proven"));
    for (const id of ALL_IDS) {
      expect(at(`${id}:baseline-bootstrap-verified`)).toBeGreaterThan(at("pre-mutation-equivalence-proven"));
      expect(at(`${id}:baseline-bootstrap-verified`)).toBeLessThan(at("baseline-barrier-ready"));
      expect(at(`${id}:mutation-applied`)).toBeGreaterThan(at("baseline-barrier-ready"));
      expect(at(`${id}:mutation-applied`)).toBeLessThan(at("post-mutation-source-state-captured"));
    }
    expect(at("changed-files-refresh:baseline-index-cloned")).toBeLessThan(at("baseline-barrier-ready"));
    expect(at("affected-neighborhood-refresh:baseline-index-cloned")).toBeLessThan(at("baseline-barrier-ready"));
    expect(at("changed-files-refresh:refreshed-index-built")).toBeGreaterThan(at("full-refresh:mutation-applied"));
    expect(events.at(-1)).toBe("lifecycle-ready");

    // Baselines stay untouched; partial refreshes work on separate clones; stale/full have no clone semantics.
    const baselineDir = (id: (typeof ALL_IDS)[number]) => incrementalChangeStalenessIndexDir(runOwnedRoot, "U1", id, "baseline");
    const refreshedDir = (id: (typeof ALL_IDS)[number]) => incrementalChangeStalenessIndexDir(runOwnedRoot, "U1", id, "refreshed");
    for (const id of ["changed-files-refresh", "affected-neighborhood-refresh"] as const) {
      expect(hashTree(baselineDir(id))).toEqual(baselineHashesAtClone[baselineDir(id)]);
      expect(existsSync(path.join(refreshedDir(id), "cache-metadata.json"))).toBe(true);
    }
    expect(existsSync(refreshedDir("stale-index"))).toBe(false);
    expect(Object.keys(baselineHashesAtClone).sort()).toEqual([baselineDir("changed-files-refresh"), baselineDir("affected-neighborhood-refresh")].sort());

    // Per-treatment counts and index/target isolation.
    expect(ALL_IDS.map((id) => session.treatments[id].indexInvocationCount)).toEqual([1, 2, 2, 2]);
    expect(ALL_IDS.map((id) => session.treatments[id].freshnessAssessmentCount)).toEqual([1, 2, 2, 2]);
    const allIndexes = ALL_IDS.flatMap((id) => {
      const t = session.treatments[id];
      return [t.changeAuthority.baselineIndex, ...(t.refreshedIndex ? [t.refreshedIndex] : [])].map((index) => ({ id, index }));
    });
    expect(new Set(allIndexes.map(({ index }) => index.indexDir.toLowerCase())).size).toBe(7);
    for (const { id, index } of allIndexes) {
      expect(index.treatmentId).toBe(id);
      expect(index.targetRoot).toBe(session.treatments[id].target.targetRoot);
    }

    // Stale keeps baseline; others use refreshed.
    const stale = session.treatments["stale-index"];
    expect(stale.postMutationIndexBuilt).toBe(false);
    expect(stale.activeRetrieval.role).toBe("baseline");
    expect(stale.refreshedIndex).toBeNull();
    expect(stale.refreshRealization).toBeNull();
    expect(stale.changeAuthority.postMutationBaselineFreshness.status).toBe("stale");
    for (const id of ["changed-files-refresh", "affected-neighborhood-refresh", "full-refresh"] as const) {
      expect(session.treatments[id].activeRetrieval.role).toBe("refreshed");
      expect(session.treatments[id].refreshedFreshness?.status).toBe("fresh");
      expect(session.treatments[id].changeAuthority.postMutationBaselineFreshness.status).toBe("stale");
    }

    // Applied partial evidence is preserved with its refresh counts.
    const changed = session.treatments["changed-files-refresh"];
    expect(changed.refreshRealization).toBe("APPLIED_PARTIAL");
    expect(changed.refreshedIndex.buildMode).toEqual({ kind: "incremental", refreshScope: "changed-files" });
    expect(changed.refreshedIndex.incrementalRefresh).toMatchObject({ requestedScope: "changed-files", appliedScope: "changed-files", selectionStatus: "applied" });
    const neighborhood = session.treatments["affected-neighborhood-refresh"];
    expect(neighborhood.refreshRealization).toBe("APPLIED_PARTIAL");
    expect(neighborhood.refreshedIndex.incrementalRefresh).toMatchObject({
      appliedScope: "affected-neighborhood",
      seedFileCount: 1,
      seedSymbolCount: 2,
      affectedNodeCount: 5,
      affectedEdgeCount: 4,
      freshExtractionFileCount: 1,
      reusedFileCount: 9
    });
    const full = session.treatments["full-refresh"];
    expect(full.refreshedIndex.buildMode).toEqual({ kind: "full" });
    expect(full.refreshedIndex.incrementalRefresh).toBeNull();
    expect(full.refreshRealization).toBeNull();
  });
});

describe("v0.6.3 four-treatment lifecycle: partial-refresh realization", () => {
  it.each(["changed-files", "affected-neighborhood"] as const)("records a truthful %s fallback-full as FALLBACK_FULL without failing", async (scope) => {
    const { result } = await runV2("U1", { refresh: { [scope]: "fallback" } });
    const session = ready(result);
    const id = scope === "changed-files" ? "changed-files-refresh" : "affected-neighborhood-refresh";
    const other = scope === "changed-files" ? "affected-neighborhood-refresh" : "changed-files-refresh";
    expect(session.treatments[id].refreshRealization).toBe("FALLBACK_FULL");
    expect(session.treatments[id].refreshedIndex.incrementalRefresh).toMatchObject({ requestedScope: scope, appliedScope: "full", selectionStatus: "fallback-full", fallbackReason: "seed-selection-unavailable" });
    expect(session.treatments[id].refreshedFreshness?.status).toBe("fresh");
    expect(session.treatments[other].refreshRealization).toBe("APPLIED_PARTIAL");
  });

  it.each(["changed-files", "affected-neighborhood"] as const)("fails the lifecycle when %s refresh reports not-needed after a controlled mutation", async (scope) => {
    const { result } = await runV2("U1", { refresh: { [scope]: "not-needed" } });
    const outcome = failed(result);
    expect(outcome.failure.code).toBe("refresh-not-needed-after-mutation");
    expect(outcome.failure.treatmentId).toBe(scope === "changed-files" ? "changed-files-refresh" : "affected-neighborhood-refresh");
  });

  it("fails on a refresh process failure and on invalid refresh evidence", async () => {
    const processFailure = failed((await runV2("U1", { refresh: { "changed-files": "fail" } })).result);
    expect(processFailure.failure.code).toBe("refresh-index-build-failed");
    const invalid = failed((await runV2("U1", { refresh: { "affected-neighborhood": "invalid" } })).result);
    expect(invalid.failure.code).toBe("refresh-index-build-failed");
    expect(invalid.failure.treatmentId).toBe("affected-neighborhood-refresh");
  });

  it("fails when full-refresh indexing fails", async () => {
    const outcome = failed((await runV2("U1", { failFullWhenOutContains: "full-refresh/refreshed" })).result);
    expect(outcome.failure.code).toBe("refresh-index-build-failed");
    expect(outcome.failure.treatmentId).toBe("full-refresh");
  });

  it("fails when a refreshed index is not complete fresh", async () => {
    const seen: Record<string, number> = {};
    const { result } = await runV2("U1", {}, {
      assessIndexFreshness: async (input) => {
        const real = await (await import("../../../src/evaluation/indexFreshness.js")).assessIndexFreshness(input);
        const name = path.basename(input.targetRoot);
        seen[name] = (seen[name] ?? 0) + 1;
        return name === "changed-files-refresh" && seen[name] === 2 ? { ...real, status: "stale" as const, changedFileCount: 1 } : real;
      }
    });
    const outcome = failed(result);
    expect(outcome.failure.code).toBe("refreshed-freshness-not-fresh");
    expect(outcome.failure.treatmentId).toBe("changed-files-refresh");
  });
});

describe("v0.6.3 four-treatment lifecycle: baseline bootstrap and barriers", () => {
  it("fails a bootstrap that does not report the cache-missing full fallback, before any mutation", async () => {
    for (const bootstrap of ["wrong-reason", "applied"] as const) {
      const { result } = await runV2("U1", { bootstrap });
      const outcome = failed(result);
      expect(outcome.failure.code).toBe("baseline-bootstrap-contract-mismatch");
      expect(outcome.failure.treatmentId).toBe("stale-index");
      expect(outcome.lifecycleEvents.some((event) => event.endsWith("mutation-applied"))).toBe(false);
    }
  });

  it("fails a bootstrap process failure or missing evidence as a baseline build failure", async () => {
    for (const bootstrap of ["fail", "no-evidence"] as const) {
      const outcome = failed((await runV2("U1", { bootstrap })).result);
      expect(outcome.failure.code).toBe("baseline-index-build-failed");
      expect(outcome.lifecycleEvents.some((event) => event.endsWith("mutation-applied"))).toBe(false);
    }
  });

  it("does not mutate anything when cloning a baseline index fails", async () => {
    const { result, indexArgs } = await runV2("U1", {}, {
      cloneIndexDirectory: async () => {
        throw new Error("forced clone failure");
      }
    });
    const outcome = failed(result);
    expect(outcome.failure.code).toBe("index-clone-failed");
    expect(outcome.failure.treatmentId).toBe("changed-files-refresh");
    expect(outcome.lifecycleEvents.some((event) => event.endsWith("mutation-applied"))).toBe(false);
    expect(indexArgs()).toHaveLength(4);
  });

  it("blocks before any indexing or mutation when a treatment copy differs before mutation", async () => {
    const seen: Record<string, number> = {};
    const { result, indexArgs } = await runV2("U1", {}, {
      captureSourceState: async (root, sourceRoots, treatmentId, project) => {
        const real = await (await import("../../../src/experiments/plugins/incrementalChangeStaleness/sourceState.js")).captureIncrementalChangeStalenessSourceState(root, sourceRoots, treatmentId, project);
        seen[treatmentId] = (seen[treatmentId] ?? 0) + 1;
        return treatmentId === "affected-neighborhood-refresh" && seen[treatmentId] === 1 ? { ...real, files: real.files.map((file, index) => (index === 0 ? { ...file, sha256: "0".repeat(64) } : file)) } : real;
      }
    });
    const outcome = failed(result);
    expect(outcome.failure.code).toBe("pre-mutation-not-equivalent");
    expect(outcome.failure.treatmentId).toBe("affected-neighborhood-refresh");
    expect(indexArgs()).toHaveLength(0);
  });

  it("fails before refresh when mutated copies differ, and when a mutation is rejected", async () => {
    const seen: Record<string, number> = {};
    const post = failed(
      (
        await runV2("U1", {}, {
          captureSourceState: async (root, sourceRoots, treatmentId, project) => {
            const real = await (await import("../../../src/experiments/plugins/incrementalChangeStaleness/sourceState.js")).captureIncrementalChangeStalenessSourceState(root, sourceRoots, treatmentId, project);
            seen[treatmentId] = (seen[treatmentId] ?? 0) + 1;
            return treatmentId === "full-refresh" && seen[treatmentId] === 2 ? { ...real, files: real.files.map((file, index) => (index === 0 ? { ...file, sha256: "1".repeat(64) } : file)) } : real;
          }
        })
      ).result
    );
    expect(post.failure.code).toBe("post-mutation-not-equivalent");
    expect(post.lifecycleEvents.some((event) => event.includes("refreshed-index-built"))).toBe(false);

    const rejected = failed(
      (
        await runV2("U1", {}, {
          executeMutation: async (scenario, target) => ({
            schemaVersion: "1.0.0",
            scenarioId: scenario.id,
            treatmentId: target.treatmentId,
            benchmarkProjectId: target.benchmarkProjectId,
            status: "rejected" as const,
            files: [],
            errors: ["forced rejection"]
          })
        })
      ).result
    );
    expect(rejected.failure.code).toBe("mutation-failed");
  });
});

describe("index directory clone owner", () => {
  function makeIndex(root: string): string {
    const dir = path.join(root, "indexes", "base");
    mkdirSync(path.join(dir, "nested"), { recursive: true });
    writeFileSync(path.join(dir, "manifest.json"), '{"a":1}');
    writeFileSync(path.join(dir, "nested", "cache-metadata.json"), '{"b":2}');
    return dir;
  }

  it("copies a complete index byte-for-byte inside the run-owned root and leaves the source untouched", async () => {
    const root = makeRunOwnedRoot(tracked, "ics-clone-");
    const source = makeIndex(root);
    const before = hashTree(source);
    const destination = path.join(root, "indexes", "copy");
    await cloneIncrementalChangeStalenessIndexDirectory(root, source, destination);
    expect(hashTree(destination)).toEqual(before);
    expect(hashTree(source)).toEqual(before);
  });

  it("refuses an existing destination, an escaping path, and a destination inside the source", async () => {
    const root = makeRunOwnedRoot(tracked, "ics-clone-");
    const source = makeIndex(root);
    const existing = path.join(root, "indexes", "exists");
    mkdirSync(existing);
    await expect(cloneIncrementalChangeStalenessIndexDirectory(root, source, existing)).rejects.toThrow("already exists");
    expect(statSync(existing).isDirectory()).toBe(true);
    await expect(cloneIncrementalChangeStalenessIndexDirectory(root, source, path.join(root, "..", "escaped-copy"))).rejects.toThrow();
    await expect(cloneIncrementalChangeStalenessIndexDirectory(root, source, path.join(source, "inner"))).rejects.toThrow("inside the source");
    await expect(cloneIncrementalChangeStalenessIndexDirectory(root, path.join(root, "missing"), path.join(root, "indexes", "x"))).rejects.toThrow("does not exist");
  });
});
