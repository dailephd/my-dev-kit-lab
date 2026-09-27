import { rm } from "node:fs/promises";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { prepareIncrementalChangeStalenessScenarioLifecycle } from "../../../src/experiments/plugins/incrementalChangeStaleness/lifecycle.js";
import {
  expectCanonicalFilesUnchanged,
  makeKitDir,
  makeRunOwnedRoot,
  repoRoot,
  resolveScenario,
  sha256OfFile,
  writeLifecycleFakeKit
} from "./lifecycleTestHelpers.js";

/**
 * Deterministic call-sequence evidence for the Batch 3 mutation barrier. The
 * real upstream owners run unchanged (against a fake my-dev-kit CLI); these
 * module wrappers only record when each real call starts/ends, so the test
 * observes the actual index -> snapshot -> graph -> mutation ordering inside
 * the shared session owner. Retrieval and neighborhood-analysis entry points
 * are wrapped too, to prove the lifecycle never reaches them.
 */
const recorder = vi.hoisted(() => ({
  events: [] as string[],
  graphGate: null as null | { role: string; wait: Promise<void> }
}));

function phaseFromIndexDir(indexDir: string): string {
  const parts = path.resolve(indexDir).split(path.sep);
  return `${parts[parts.length - 2]}/${parts[parts.length - 1]}`;
}

function treatmentFromTargetRoot(targetRoot: string): string {
  return path.basename(path.resolve(targetRoot));
}

vi.mock("../../../src/evaluation/runMyDevKitRetrieval.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../../src/evaluation/runMyDevKitRetrieval.js")>();
  return {
    ...actual,
    buildMyDevKitIndex: async (options: Parameters<typeof actual.buildMyDevKitIndex>[0]) => {
      recorder.events.push(`index:start:${phaseFromIndexDir(options.indexDir)}`);
      const result = await actual.buildMyDevKitIndex(options);
      recorder.events.push(`index:end:${phaseFromIndexDir(options.indexDir)}`);
      return result;
    },
    runMyDevKitRetrievalFromIndex: async (...args: Parameters<typeof actual.runMyDevKitRetrievalFromIndex>) => {
      recorder.events.push("retrieval");
      return actual.runMyDevKitRetrievalFromIndex(...args);
    },
    runMyDevKitRetrieval: async (...args: Parameters<typeof actual.runMyDevKitRetrieval>) => {
      recorder.events.push("retrieval");
      return actual.runMyDevKitRetrieval(...args);
    }
  };
});

vi.mock("../../../src/evaluation/indexSnapshot.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../../src/evaluation/indexSnapshot.js")>();
  return {
    ...actual,
    captureIndexSnapshot: async (options: Parameters<typeof actual.captureIndexSnapshot>[0]) => {
      recorder.events.push(`snapshot:start:${phaseFromIndexDir(options.indexDir)}`);
      const result = await actual.captureIndexSnapshot(options);
      recorder.events.push(`snapshot:end:${phaseFromIndexDir(options.indexDir)}`);
      return result;
    }
  };
});

vi.mock("../../../src/evaluation/affectedNeighborhood.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../../src/evaluation/affectedNeighborhood.js")>();
  const forbidden = (name: string) => (...args: unknown[]) => {
    recorder.events.push(`neighborhood:${name}`);
    return (actual as unknown as Record<string, (...inner: unknown[]) => unknown>)[name](...args);
  };
  return {
    ...actual,
    loadAffectedNeighborhoodGraphEvidence: async (options: Parameters<typeof actual.loadAffectedNeighborhoodGraphEvidence>[0]) => {
      const phase = phaseFromIndexDir(options.indexDir);
      recorder.events.push(`graph:start:${phase}`);
      if (recorder.graphGate && recorder.graphGate.role === phase) {
        await recorder.graphGate.wait;
      }
      const result = await actual.loadAffectedNeighborhoodGraphEvidence(options);
      recorder.events.push(`graph:end:${phase}`);
      return result;
    },
    mapAffectedNeighborhoodSeeds: forbidden("mapAffectedNeighborhoodSeeds"),
    mapAffectedNeighborhoodTask: forbidden("mapAffectedNeighborhoodTask"),
    traverseAffectedNeighborhood: forbidden("traverseAffectedNeighborhood"),
    assessAffectedNeighborhood: forbidden("assessAffectedNeighborhood")
  };
});

vi.mock("../../../src/evaluation/indexFreshness.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../../src/evaluation/indexFreshness.js")>();
  return {
    ...actual,
    assessIndexFreshness: async (options: Parameters<typeof actual.assessIndexFreshness>[0]) => {
      const args = options.snapshot?.indexCommand.args ?? [];
      const indexPhase = phaseFromIndexDir(args[args.indexOf("--out") + 1] ?? "unknown/unknown");
      recorder.events.push(`freshness:${treatmentFromTargetRoot(options.targetRoot)}:${indexPhase}`);
      return actual.assessIndexFreshness(options);
    }
  };
});

vi.mock("../../../src/experiments/plugins/incrementalChangeStaleness/mutationExecution.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../../src/experiments/plugins/incrementalChangeStaleness/mutationExecution.js")>();
  return {
    ...actual,
    executeIncrementalChangeStalenessMutation: async (...args: Parameters<typeof actual.executeIncrementalChangeStalenessMutation>) => {
      recorder.events.push(`mutation:start:${args[1].treatmentId}`);
      const receipt = await actual.executeIncrementalChangeStalenessMutation(...args);
      recorder.events.push(`mutation:end:${args[1].treatmentId}`);
      return receipt;
    }
  };
});

const tracked: string[] = [];
beforeEach(() => {
  recorder.events.length = 0;
  recorder.graphGate = null;
});
afterEach(async () => {
  await Promise.all(tracked.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
  expectCanonicalFilesUnchanged();
});

const EXPECTED_CALL_SEQUENCE = [
  "index:start:stale-index/baseline",
  "index:end:stale-index/baseline",
  "snapshot:start:stale-index/baseline",
  "snapshot:end:stale-index/baseline",
  "graph:start:stale-index/baseline",
  "graph:end:stale-index/baseline",
  "index:start:full-refresh/baseline",
  "index:end:full-refresh/baseline",
  "snapshot:start:full-refresh/baseline",
  "snapshot:end:full-refresh/baseline",
  "graph:start:full-refresh/baseline",
  "graph:end:full-refresh/baseline",
  "mutation:start:stale-index",
  "mutation:end:stale-index",
  "mutation:start:full-refresh",
  "mutation:end:full-refresh",
  "freshness:stale-index:stale-index/baseline",
  "freshness:full-refresh:full-refresh/baseline",
  "index:start:full-refresh/refreshed",
  "index:end:full-refresh/refreshed",
  "snapshot:start:full-refresh/refreshed",
  "snapshot:end:full-refresh/refreshed",
  "graph:start:full-refresh/refreshed",
  "graph:end:full-refresh/refreshed",
  "freshness:full-refresh:full-refresh/refreshed"
];

describe("mutation barrier and call ordering (TST-B3-014..016, 023, 026, 028, 043..046)", () => {
  it("mutates only after BOTH baselines completed index, snapshot, and graph, and never retrieves", async () => {
    const resolved = await resolveScenario("L2");
    const kit = writeLifecycleFakeKit(makeKitDir(tracked));
    const result = await prepareIncrementalChangeStalenessScenarioLifecycle({
      repoRoot,
      runOwnedRoot: makeRunOwnedRoot(tracked),
      scenario: resolved.scenario,
      baseCase: resolved.baseCase,
      kitCommand: kit.command
    });
    expect(result.status).toBe("ready");
    expect(recorder.events).toEqual(EXPECTED_CALL_SEQUENCE);

    const firstMutation = recorder.events.findIndex((event) => event.startsWith("mutation:start"));
    for (const ready of [
      "index:end:stale-index/baseline",
      "snapshot:end:stale-index/baseline",
      "graph:end:stale-index/baseline",
      "index:end:full-refresh/baseline",
      "snapshot:end:full-refresh/baseline",
      "graph:end:full-refresh/baseline"
    ]) {
      expect(recorder.events.indexOf(ready)).toBeLessThan(firstMutation);
    }
    // TST-B3-028: the refreshed index is built only after both mutations.
    expect(recorder.events.indexOf("index:start:full-refresh/refreshed")).toBeGreaterThan(recorder.events.indexOf("mutation:end:full-refresh"));
    // TST-B3-023/026: 1 stale build + 2 full-refresh builds; 3 freshness assessments.
    expect(recorder.events.filter((event) => event.startsWith("index:start:stale-index/"))).toHaveLength(1);
    expect(recorder.events.filter((event) => event.startsWith("index:start:full-refresh/"))).toHaveLength(2);
    expect(recorder.events.filter((event) => event.startsWith("freshness:"))).toHaveLength(3);
    // TST-B3-043..046: no retrieval, no neighborhood mapping/traversal/metrics/recommendation.
    expect(recorder.events.filter((event) => event === "retrieval" || event.startsWith("neighborhood:"))).toEqual([]);
  }, 60_000);

  it("does not mutate when the upstream index subprocess returns while baseline graph loading is still pending (TST-B3-016)", async () => {
    const resolved = await resolveScenario("L2");
    const controlledFile = resolved.scenario.mutation.files[0];
    let release!: () => void;
    recorder.graphGate = { role: "full-refresh/baseline", wait: new Promise<void>((resolve) => (release = resolve)) };
    const kit = writeLifecycleFakeKit(makeKitDir(tracked));
    const runOwnedRoot = makeRunOwnedRoot(tracked);
    const pending = prepareIncrementalChangeStalenessScenarioLifecycle({
      repoRoot,
      runOwnedRoot,
      scenario: resolved.scenario,
      baseCase: resolved.baseCase,
      kitCommand: kit.command
    });

    await vi.waitFor(() => expect(recorder.events).toContain("graph:start:full-refresh/baseline"), { timeout: 30_000, interval: 20 });
    // The full-refresh index subprocess has returned and its snapshot is captured, but graph
    // loading is held: no mutation may have started and neither copy may be changed yet.
    expect(recorder.events).toContain("index:end:full-refresh/baseline");
    expect(recorder.events).toContain("snapshot:end:full-refresh/baseline");
    expect(recorder.events.some((event) => event.startsWith("mutation:"))).toBe(false);
    for (const treatmentId of ["stale-index", "full-refresh"]) {
      const file = path.join(runOwnedRoot, "targets", "L2", treatmentId, controlledFile.path);
      expect(sha256OfFile(file)).toBe(controlledFile.expectedPreSha256);
    }

    release();
    const result = await pending;
    expect(result.status).toBe("ready");
    expect(recorder.events.indexOf("mutation:start:stale-index")).toBeGreaterThan(recorder.events.indexOf("graph:end:full-refresh/baseline"));
  }, 60_000);
});
