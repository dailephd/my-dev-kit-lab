import { existsSync, readFileSync } from "node:fs";
import { rm } from "node:fs/promises";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { assessIndexFreshness } from "../../../src/evaluation/indexFreshness.js";
import { executeIncrementalChangeStalenessMutation } from "../../../src/experiments/plugins/incrementalChangeStaleness/mutationExecution.js";
import {
  defaultIncrementalChangeStalenessLifecycleDeps,
  prepareIncrementalChangeStalenessScenarioLifecycle,
  type IncrementalChangeStalenessLifecycleDeps
} from "../../../src/experiments/plugins/incrementalChangeStaleness/lifecycle.js";
import { captureIncrementalChangeStalenessSourceState } from "../../../src/experiments/plugins/incrementalChangeStaleness/sourceState.js";
import type { IncrementalChangeStalenessLifecycleResultV1 } from "../../../src/experiments/plugins/incrementalChangeStaleness/treatmentSession.js";
import { FROZEN_INCREMENTAL_CHANGE_STALENESS_SCENARIO_IDS } from "../../../src/experiments/plugins/incrementalChangeStaleness/scenarioTypes.js";
import { prepareWarmIndexSession } from "../../../src/experiments/plugins/warmIndexReuse/warmIndexSession.js";
import {
  EXPECTED_READY_LIFECYCLE_EVENTS,
  expectCanonicalFilesUnchanged,
  expectNoIndexOutputInCanonicalProjects,
  makeKitDir,
  makeRunOwnedRoot,
  readKitLog,
  repoRoot,
  resolveScenario,
  writeLifecycleFakeKit
} from "./lifecycleTestHelpers.js";

const tracked: string[] = [];
afterEach(async () => {
  await Promise.all(tracked.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
  expectCanonicalFilesUnchanged();
  expectNoIndexOutputInCanonicalProjects();
});

async function runLifecycle(
  scenarioId: string,
  options: { kit?: ReturnType<typeof writeLifecycleFakeKit>; deps?: Partial<IncrementalChangeStalenessLifecycleDeps> } = {}
): Promise<{ result: IncrementalChangeStalenessLifecycleResultV1; runOwnedRoot: string; log: () => string[] }> {
  const resolved = await resolveScenario(scenarioId);
  const runOwnedRoot = makeRunOwnedRoot(tracked);
  const kit = options.kit ?? writeLifecycleFakeKit(makeKitDir(tracked));
  const result = await prepareIncrementalChangeStalenessScenarioLifecycle({
    repoRoot,
    runOwnedRoot,
    scenario: resolved.scenario,
    baseCase: resolved.baseCase,
    kitCommand: kit.command,
    deps: options.deps
  });
  return { result, runOwnedRoot, log: () => readKitLog(kit.logPath) };
}

function expectFailed(result: IncrementalChangeStalenessLifecycleResultV1) {
  if (result.status !== "failed") {
    throw new Error(`Expected a failed lifecycle, got ${result.status}.`);
  }
  return result;
}

function expectReady(result: IncrementalChangeStalenessLifecycleResultV1) {
  if (result.status !== "ready") {
    throw new Error(`Expected a ready lifecycle, got failure ${result.failure.code}: ${result.failure.message}`);
  }
  return result.session;
}

function indexCount(log: string[]): number {
  return log.filter((line) => line === "index").length;
}

describe("incremental-change-staleness matched lifecycle for all six frozen scenarios (TST-B3-007..034, 047, 049)", () => {
  it.each([...FROZEN_INCREMENTAL_CHANGE_STALENESS_SCENARIO_IDS])(
    "%s traverses the complete stale/full-refresh lifecycle",
    async (scenarioId) => {
      const { result, runOwnedRoot, log } = await runLifecycle(scenarioId);
      const session = expectReady(result);
      const resolved = await resolveScenario(scenarioId);
      const stale = session.treatments["stale-index"];
      const full = session.treatments["full-refresh"];
      const declared = resolved.scenario.mutation.files.map((file) => file.path).sort();

      // Identity and deterministic stage ordering.
      expect(session.scenarioId).toBe(scenarioId);
      expect(session.status).toBe("ready");
      expect(session.baseCase.caseId).toBe(resolved.scenario.baseCaseId);
      expect(session.controlledChangedPaths).toEqual(declared);
      expect(session.lifecycleEvents).toEqual(EXPECTED_READY_LIFECYCLE_EVENTS);
      expect(Object.keys(session.treatments)).toEqual(["stale-index", "full-refresh"]);

      // TST-B3-007: two independent Batch 2 copies under the run-owned root.
      expect(stale.target.treatmentId).toBe("stale-index");
      expect(full.target.treatmentId).toBe("full-refresh");
      expect(stale.target.targetRoot).not.toBe(full.target.targetRoot);
      for (const target of [stale.target, full.target]) {
        expect(path.relative(runOwnedRoot, target.targetRoot).startsWith("..")).toBe(false);
        expect(target.canonicalProjectRoot).toBe(session.baseCase.canonicalProjectRoot);
      }

      // TST-B3-008/018: equivalence gates.
      expect(session.preMutationEquivalence.result).toBe("equivalent");
      expect(session.postMutationEquivalence.result).toBe("equivalent");

      // TST-B3-009..013: baseline index evidence per treatment.
      const staleBaseline = stale.changeAuthority.baselineIndex;
      const fullBaseline = full.changeAuthority.baselineIndex;
      for (const [baseline, target] of [
        [staleBaseline, stale.target],
        [fullBaseline, full.target]
      ] as const) {
        expect(baseline.role).toBe("baseline");
        expect(baseline.builtRelativeToMutation).toBe("pre-mutation");
        expect(path.resolve(baseline.targetRoot)).toBe(path.resolve(target.targetRoot));
        expect(baseline.sourceRoots).toEqual(resolved.baseCase.sourceRoots);
        expect(baseline.snapshot.status).toBe("complete");
        expect(baseline.graph.status).not.toBe("unavailable");
        expect(baseline.graph.codeGraph).not.toBeNull();
        expect(path.resolve(baseline.graph.indexRoot)).toBe(path.resolve(baseline.indexDir));
        // The index command pointed at the treatment copy, never the canonical project.
        const args = baseline.snapshot.indexCommand.args;
        expect(args[args.indexOf("--root") + 1]).toBe(target.targetRoot);
        expect(args).not.toContain(session.baseCase.canonicalProjectRoot);
        expect(args).not.toContain("--incremental");
      }
      // TST-B3-011: distinct baseline output directories.
      expect(staleBaseline.indexDir).not.toBe(fullBaseline.indexDir);

      // Baseline snapshots represent PRE-mutation content of the controlled files.
      for (const file of resolved.scenario.mutation.files) {
        for (const baseline of [staleBaseline, fullBaseline]) {
          expect(baseline.snapshot.files.find((entry) => entry.path === file.path)?.sha256).toBe(file.expectedPreSha256);
        }
      }

      // TST-B3-017: both mutations applied independently from the same scenario.
      expect(stale.mutationReceipt.status).toBe("applied");
      expect(full.mutationReceipt.status).toBe("applied");
      expect(stale.mutationReceipt.scenarioId).toBe(scenarioId);
      expect(full.mutationReceipt.scenarioId).toBe(scenarioId);
      expect(stale.mutationReceipt.treatmentId).toBe("stale-index");
      expect(full.mutationReceipt.treatmentId).toBe("full-refresh");

      // TST-B3-019..021: complete stale baseline freshness on exactly the controlled paths.
      for (const treatment of [stale, full]) {
        const freshness = treatment.changeAuthority.postMutationBaselineFreshness;
        expect(freshness.status).toBe("stale");
        expect(freshness.baselineSnapshotStatus).toBe("complete");
        expect(freshness.unresolvedFileCount).toBe(0);
        expect(freshness.changes.map((change) => change.path).sort()).toEqual(declared);
      }

      // TST-B3-023..025: stale treatment keeps its baseline index; no refresh evidence.
      expect(stale.indexBuildCount).toBe(1);
      expect(stale.freshnessAssessmentCount).toBe(1);
      expect(stale.postMutationIndexBuilt).toBe(false);
      expect(stale.activeRetrieval.role).toBe("baseline");
      expect(stale.activeRetrieval.index).toBe(staleBaseline);
      expect(stale.refreshedIndex).toBeNull();
      expect(stale.refreshedFreshness).toBeNull();

      // TST-B3-026..034: full-refresh rebuilds into a new directory after mutation.
      expect(full.indexBuildCount).toBe(2);
      expect(full.freshnessAssessmentCount).toBe(2);
      expect(full.postMutationIndexBuilt).toBe(true);
      const refreshed = full.refreshedIndex;
      expect(refreshed.role).toBe("refreshed");
      expect(refreshed.builtRelativeToMutation).toBe("post-mutation");
      expect(refreshed.indexDir).not.toBe(fullBaseline.indexDir);
      expect(refreshed.indexDir).not.toBe(staleBaseline.indexDir);
      expect(refreshed.sourceRoots).toEqual(resolved.baseCase.sourceRoots);
      expect(path.resolve(refreshed.targetRoot)).toBe(path.resolve(full.target.targetRoot));
      expect(refreshed.snapshot.status).toBe("complete");
      expect(path.resolve(refreshed.graph.indexRoot)).toBe(path.resolve(refreshed.indexDir));
      expect(refreshed.graph.codeGraph).not.toBeNull();
      for (const file of resolved.scenario.mutation.files) {
        expect(refreshed.snapshot.files.find((entry) => entry.path === file.path)?.sha256).toBe(file.expectedPostSha256);
      }
      expect(full.refreshedFreshness.status).toBe("fresh");
      expect(full.refreshedFreshness.baselineSnapshotStatus).toBe("complete");
      expect(full.refreshedFreshness.changedFileCount).toBe(0);
      expect(full.refreshedFreshness.missingFileCount).toBe(0);
      expect(full.refreshedFreshness.unresolvedFileCount).toBe(0);
      expect(full.activeRetrieval.role).toBe("refreshed");
      expect(full.activeRetrieval.index).toBe(refreshed);
      expect(full.changeAuthority.baselineIndex).toBe(fullBaseline);
      expect(full.changeAuthority.baselineIndex.role).toBe("baseline");
      // The baseline index directory was not overwritten by the refreshed build.
      expect(existsSync(path.join(fullBaseline.indexDir, "manifest.json"))).toBe(true);
      expect(existsSync(path.join(refreshed.indexDir, "manifest.json"))).toBe(true);

      // TST-B3-035: exactly three full index builds for the scenario; one tool identity.
      expect(indexCount(log())).toBe(3);
      expect(session.toolIdentity.version).toBe("fake-my-dev-kit 1.2.3-test");
    },
    60_000
  );
});

describe("lifecycle-integrity failures (TST-B3-008, 018, 022, 035..042)", () => {
  it("requires pre-mutation equivalence before any index build or mutation (TST-B3-008)", async () => {
    let mutations = 0;
    const { result, log } = await runLifecycle("L2", {
      deps: {
        captureSourceState: async (...args) => {
          const state = await captureIncrementalChangeStalenessSourceState(...args);
          return args[2] === "full-refresh" ? { ...state, files: state.files.slice(1), fileCount: state.fileCount - 1 } : state;
        },
        executeMutation: async (...args) => {
          mutations += 1;
          return executeIncrementalChangeStalenessMutation(...args);
        }
      }
    });
    const failed = expectFailed(result);
    expect(failed.failure.code).toBe("pre-mutation-not-equivalent");
    expect(indexCount(log())).toBe(0);
    expect(mutations).toBe(0);
    expect(failed.lifecycleEvents).not.toContain("baseline-barrier-ready");
  }, 60_000);

  it("requires post-mutation equivalence (TST-B3-018)", async () => {
    let fullCaptures = 0;
    const { result } = await runLifecycle("L2", {
      deps: {
        captureSourceState: async (...args) => {
          const state = await captureIncrementalChangeStalenessSourceState(...args);
          if (args[2] !== "full-refresh") return state;
          fullCaptures += 1;
          return fullCaptures === 2 ? { ...state, files: state.files.map((file, index) => (index === 0 ? { ...file, sha256: "0".repeat(64) } : file)) } : state;
        }
      }
    });
    const failed = expectFailed(result);
    expect(failed.failure.code).toBe("post-mutation-not-equivalent");
    expect(failed.lifecycleEvents).not.toContain("full-refresh:refreshed-index-built");
  }, 60_000);

  it("fails when an index manifest does not belong to the treatment target (TST-B3-035)", async () => {
    const kit = writeLifecycleFakeKit(makeKitDir(tracked), { tamper: "projectRoot", tamperWhenOutContains: "/full-refresh/baseline" });
    let mutations = 0;
    const { result } = await runLifecycle("L2", {
      kit,
      deps: {
        executeMutation: async (...args) => {
          mutations += 1;
          return executeIncrementalChangeStalenessMutation(...args);
        }
      }
    });
    const failed = expectFailed(result);
    expect(failed.failure.code).toBe("index-target-mismatch");
    expect(failed.failure.treatmentId).toBe("full-refresh");
    expect(mutations).toBe(0);
  }, 60_000);

  it("fails when a prepared index session reports a different target root (TST-B3-035)", async () => {
    const { result } = await runLifecycle("L2", {
      deps: {
        prepareIndexSession: async (options) => {
          const prepared = await prepareWarmIndexSession(options);
          return prepared.ok ? { ...prepared, session: { ...prepared.session, targetRoot: `${prepared.session.targetRoot}-other` } } : prepared;
        }
      }
    });
    const failed = expectFailed(result);
    expect(failed.failure.code).toBe("index-target-mismatch");
    expect(failed.failure.treatmentId).toBe("stale-index");
  }, 60_000);

  it("fails on source-root mismatch (TST-B3-036)", async () => {
    const { result } = await runLifecycle("L2", {
      deps: {
        prepareIndexSession: async (options) => {
          const prepared = await prepareWarmIndexSession(options);
          return prepared.ok ? { ...prepared, session: { ...prepared.session, sourceRoots: ["src"] } } : prepared;
        }
      }
    });
    const failed = expectFailed(result);
    expect(failed.failure.code).toBe("source-root-mismatch");
  }, 60_000);

  it("fails on my-dev-kit version mismatch within the matched scenario (TST-B3-037)", async () => {
    let calls = 0;
    const { result } = await runLifecycle("L2", {
      deps: {
        prepareIndexSession: async (options) => {
          const prepared = await prepareWarmIndexSession(options);
          calls += 1;
          if (!prepared.ok || calls !== 2) return prepared;
          const indexSnapshot = { ...prepared.session.indexSnapshot, tool: { ...prepared.session.indexSnapshot.tool, version: "other 9.9.9" } };
          return { ...prepared, session: { ...prepared.session, indexSnapshot } };
        }
      }
    });
    const failed = expectFailed(result);
    expect(failed.failure.code).toBe("tool-identity-mismatch");
    expect(failed.lifecycleEvents).not.toContain("baseline-barrier-ready");
  }, 60_000);

  it("fails when the my-dev-kit version cannot be established rather than guessing (TST-B3-037)", async () => {
    const { result } = await runLifecycle("L2", {
      deps: {
        prepareIndexSession: async (options) => {
          const prepared = await prepareWarmIndexSession(options);
          if (!prepared.ok) return prepared;
          const tool = { name: "my-dev-kit" as const, version: null, availability: "unavailable" as const, reason: "probe failed" };
          return { ...prepared, session: { ...prepared.session, indexSnapshot: { ...prepared.session.indexSnapshot, tool } } };
        }
      }
    });
    expect(expectFailed(result).failure.code).toBe("tool-identity-unavailable");
  }, 60_000);

  it("requires usable baseline graph evidence before any mutation (TST-B3-038)", async () => {
    const kit = writeLifecycleFakeKit(makeKitDir(tracked), { tamper: "noCodeGraph", tamperWhenOutContains: "/stale-index/baseline" });
    let mutations = 0;
    const { result } = await runLifecycle("L2", {
      kit,
      deps: {
        executeMutation: async (...args) => {
          mutations += 1;
          return executeIncrementalChangeStalenessMutation(...args);
        }
      }
    });
    const failed = expectFailed(result);
    expect(failed.failure.code).toBe("baseline-graph-unavailable");
    expect(failed.failure.treatmentId).toBe("stale-index");
    expect(mutations).toBe(0);
  }, 60_000);

  it("requires usable refreshed graph evidence for full-refresh readiness (TST-B3-039)", async () => {
    const kit = writeLifecycleFakeKit(makeKitDir(tracked), { tamper: "noCodeGraph", tamperWhenOutContains: "/full-refresh/refreshed" });
    const { result } = await runLifecycle("L2", { kit });
    const failed = expectFailed(result);
    expect(failed.failure.code).toBe("refreshed-graph-unavailable");
    expect(failed.failure.treatmentId).toBe("full-refresh");
  }, 60_000);

  it("fails when baseline freshness is unexpectedly fresh after the lifecycle mutation step (TST-B3-040)", async () => {
    // A mutation step that claims success without changing bytes leaves both targets unchanged.
    const { result } = await runLifecycle("L2", {
      deps: {
        executeMutation: async (scenario, target) => ({
          schemaVersion: "1.0.0",
          scenarioId: scenario.id,
          treatmentId: target.treatmentId,
          benchmarkProjectId: target.benchmarkProjectId,
          status: "applied",
          files: [],
          errors: []
        })
      }
    });
    const failed = expectFailed(result);
    expect(failed.failure.code).toBe("baseline-freshness-not-stale");
    expect(failed.failure.message).toContain("fresh");
    expect(failed.indexBuildCounts["full-refresh"]).toBe(1);
  }, 60_000);

  it("fails explicitly when a treatment mutation is rejected", async () => {
    const { result } = await runLifecycle("L2", {
      deps: {
        executeMutation: async (scenario, target, ...rest) =>
          target.treatmentId === "full-refresh"
            ? { schemaVersion: "1.0.0", scenarioId: scenario.id, treatmentId: target.treatmentId, benchmarkProjectId: target.benchmarkProjectId, status: "rejected", files: [], errors: ["forced rejection"] }
            : executeIncrementalChangeStalenessMutation(scenario, target, ...rest)
      }
    });
    const failed = expectFailed(result);
    expect(failed.failure.code).toBe("mutation-failed");
    expect(failed.failure.treatmentId).toBe("full-refresh");
    expect(failed.indexBuildCounts).toEqual({ "stale-index": 1, "full-refresh": 1 });
  }, 60_000);

  it.each(["unknown", "partially-stale"] as const)("fails when baseline freshness is %s (TST-B3-041)", async (status) => {
    const { result } = await runLifecycle("L2", {
      deps: {
        assessIndexFreshness: async (options) => ({ ...(await assessIndexFreshness(options)), status })
      }
    });
    const failed = expectFailed(result);
    expect(failed.failure.code).toBe("baseline-freshness-not-stale");
    expect(failed.lifecycleEvents).not.toContain("full-refresh:refreshed-index-built");
  }, 60_000);

  it("fails when baseline freshness is stale but the comparison was incomplete (TST-B3-041)", async () => {
    const { result } = await runLifecycle("L2", {
      deps: {
        assessIndexFreshness: async (options) => ({ ...(await assessIndexFreshness(options)), unresolvedFileCount: 1 })
      }
    });
    expect(expectFailed(result).failure.code).toBe("baseline-freshness-not-stale");
  }, 60_000);

  it("blocks readiness when treatments disagree about the controlled change (TST-B3-022)", async () => {
    let calls = 0;
    const { result } = await runLifecycle("L2", {
      deps: {
        assessIndexFreshness: async (options) => {
          const assessment = await assessIndexFreshness(options);
          calls += 1;
          if (calls !== 2) return assessment;
          return { ...assessment, changes: assessment.changes.map((change) => ({ ...change, currentSha256: "f".repeat(64) })) };
        }
      }
    });
    const failed = expectFailed(result);
    expect(failed.failure.code).toBe("treatment-changed-paths-conflict");
    expect(failed.lifecycleEvents).not.toContain("full-refresh:refreshed-index-built");
  }, 60_000);

  it("fails when the baseline changed paths are not the scenario-controlled paths (TST-B3-021)", async () => {
    const { result } = await runLifecycle("L2", {
      deps: {
        assessIndexFreshness: async (options) => {
          const assessment = await assessIndexFreshness(options);
          return { ...assessment, changes: assessment.changes.map((change) => ({ ...change, path: "src/other.ts" })) };
        }
      }
    });
    expect(expectFailed(result).failure.code).toBe("baseline-changed-paths-mismatch");
  }, 60_000);

  it.each(["stale", "unknown", "partially-stale"] as const)("fails when refreshed freshness is %s (TST-B3-042)", async (status) => {
    let calls = 0;
    const { result } = await runLifecycle("L2", {
      deps: {
        assessIndexFreshness: async (options) => {
          const assessment = await assessIndexFreshness(options);
          calls += 1;
          return calls === 3 ? { ...assessment, status } : assessment;
        }
      }
    });
    const failed = expectFailed(result);
    expect(failed.failure.code).toBe("refreshed-freshness-not-fresh");
    expect(failed.failure.treatmentId).toBe("full-refresh");
    // No retry/reindex loop: exactly the three planned builds were attempted.
    expect(failed.indexBuildCounts).toEqual({ "stale-index": 1, "full-refresh": 2 });
  }, 60_000);

  it("fails explicitly when a baseline index build fails, without mutating", async () => {
    const kitDir = makeKitDir(tracked);
    const { writeFakeKitVariant } = await import("../warmIndexReuse/warmIndexTestHelpers.js");
    const command = writeFakeKitVariant(kitDir, { failOn: "index" });
    const resolved = await resolveScenario("L2");
    let mutations = 0;
    const result = await prepareIncrementalChangeStalenessScenarioLifecycle({
      repoRoot,
      runOwnedRoot: makeRunOwnedRoot(tracked),
      scenario: resolved.scenario,
      baseCase: resolved.baseCase,
      kitCommand: command,
      deps: {
        executeMutation: async (...args) => {
          mutations += 1;
          return executeIncrementalChangeStalenessMutation(...args);
        }
      }
    });
    const failed = expectFailed(result);
    expect(failed.failure.code).toBe("baseline-index-build-failed");
    expect(failed.indexBuildCounts).toEqual({ "stale-index": 1, "full-refresh": 0 });
    expect(mutations).toBe(0);
  }, 60_000);

  it("refuses to overwrite an existing index directory", async () => {
    const resolved = await resolveScenario("L2");
    const runOwnedRoot = makeRunOwnedRoot(tracked);
    const { mkdirSync } = await import("node:fs");
    mkdirSync(path.join(runOwnedRoot, "indexes", "L2", "stale-index", "baseline"), { recursive: true });
    const kit = writeLifecycleFakeKit(makeKitDir(tracked));
    const result = await prepareIncrementalChangeStalenessScenarioLifecycle({
      repoRoot,
      runOwnedRoot,
      scenario: resolved.scenario,
      baseCase: resolved.baseCase,
      kitCommand: kit.command
    });
    expect(expectFailed(result).failure.code).toBe("index-directory-collision");
    expect(indexCount(readKitLog(kit.logPath))).toBe(0);
  }, 60_000);
});

describe("lifecycle boundaries (TST-B3-043..047, 053)", () => {
  // v0.6.3 Batch 4: plugin.ts is intentionally excluded -- the public plugin now wires the four-treatment
  // (changed-files / affected-neighborhood) lifecycle. The V1 runtime files stay guarded; config.ts carries
  // the current public treatment description and is covered by the config/describe contract tests.
  const batch3Files = ["lifecycle.ts", "lifecyclePolicy.ts", "treatmentSession.ts", "scenarioSelection.ts"].map((file) =>
    path.join(repoRoot, "src/experiments/plugins/incrementalChangeStaleness", file)
  );
  // v0.6.2 Batch 4 legitimately moves retrieval/correctness/comparison orchestration into
  // plugin.ts (frozen batch prompt section 54); the pure lifecycle-preparation boundary (no
  // retrieval, no neighborhood traversal, no agent evaluation, no correctness, no
  // recommendation-driven action) is still frozen for these lifecycle-only files.
  const pureLifecycleFiles = ["lifecycle.ts", "lifecyclePolicy.ts", "config.ts", "treatmentSession.ts", "scenarioSelection.ts"].map((file) =>
    path.join(repoRoot, "src/experiments/plugins/incrementalChangeStaleness", file)
  );

  it("lifecycle-only files never reference retrieval, neighborhood traversal/metrics, agent evaluation, correctness, or recommendation-driven action", () => {
    const forbidden = [
      "runMyDevKitRetrievalFromIndex",
      "runMyDevKitRetrieval(",
      "mapAffectedNeighborhoodSeeds",
      "mapAffectedNeighborhoodTask",
      "assessAffectedNeighborhood",
      "traverseAffectedNeighborhood",
      "reindexRecommendation",
      "evaluateWarmIndexFakeAgents",
      "evaluateWarmIndexRealAgentCampaign",
      "scoreCorrectness",
      "fakeAgent",
      "runAgent"
    ];
    for (const file of pureLifecycleFiles) {
      const text = readFileSync(file, "utf8");
      for (const token of forbidden) {
        expect(text.includes(token), `${path.basename(file)} must not reference ${token}`).toBe(false);
      }
    }
  });

  it("has no partial-refresh, incremental-index, or graph-diff lifecycle path (TST-B3-053)", () => {
    for (const file of batch3Files) {
      const text = readFileSync(file, "utf8");
      for (const token of ["partial-refresh", "partialRefresh", "changed-files-refresh", "affected-neighborhood-refresh", "graph-diff", "graphDiff", "--incremental"]) {
        expect(text.includes(token), `${path.basename(file)} must not reference ${token}`).toBe(false);
      }
    }
  });

  it("default lifecycle dependencies are the established owners", () => {
    expect(defaultIncrementalChangeStalenessLifecycleDeps.prepareIndexSession).toBe(prepareWarmIndexSession);
    expect(defaultIncrementalChangeStalenessLifecycleDeps.assessIndexFreshness).toBe(assessIndexFreshness);
    expect(defaultIncrementalChangeStalenessLifecycleDeps.executeMutation).toBe(executeIncrementalChangeStalenessMutation);
    expect(defaultIncrementalChangeStalenessLifecycleDeps.captureSourceState).toBe(captureIncrementalChangeStalenessSourceState);
  });
});
