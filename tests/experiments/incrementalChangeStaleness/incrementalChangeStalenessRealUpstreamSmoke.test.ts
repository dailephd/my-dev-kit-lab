import path from "node:path";
import { rm } from "node:fs/promises";
import { afterEach, describe, expect, it } from "vitest";
import { readBenchmarkProjectProfiles } from "../../../src/evaluation/benchmarkMetadata.js";
import { INCREMENTAL_CHANGE_STALENESS_DEFAULT_KIT_COMMAND } from "../../../src/experiments/plugins/incrementalChangeStaleness/config.js";
import { buildIncrementalChangeStalenessExecutionArtifactV2 } from "../../../src/experiments/plugins/incrementalChangeStaleness/executionArtifactV2.js";
import { executeIncrementalChangeStalenessScenarioV2 } from "../../../src/experiments/plugins/incrementalChangeStaleness/executionV2.js";
import { prepareIncrementalChangeStalenessScenarioLifecycleV2 } from "../../../src/experiments/plugins/incrementalChangeStaleness/lifecycleV2.js";
import { BENCHMARK_PROJECT_PROFILES_PATH } from "../../../src/experiments/plugins/incrementalChangeStaleness/scenarioCatalog.js";
import {
  expectCanonicalFilesUnchanged,
  expectNoIndexOutputInCanonicalProjects,
  makeRunOwnedRoot,
  repoRoot,
  resolveScenario
} from "./lifecycleTestHelpers.js";

/**
 * v0.6.3 real-upstream smoke against the REAL published `@dailephd/my-dev-kit@1.12.5` (network/npx
 * required) for scenario L2 only, through the current four-treatment V2 lifecycle and execution owners.
 * Opt-in so ordinary test runs stay deterministic and offline:
 *   MY_DEV_KIT_LAB_REAL_UPSTREAM_SMOKE=1 npx vitest run <this file>
 * This is not packed-package acceptance: `npm run verify:packed-package` owns the six-scenario proof.
 */
const enabled = process.env.MY_DEV_KIT_LAB_REAL_UPSTREAM_SMOKE === "1";

const tracked: string[] = [];
afterEach(async () => {
  await Promise.all(tracked.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
  expectCanonicalFilesUnchanged();
  expectNoIndexOutputInCanonicalProjects();
});

describe("the default kit command", () => {
  it("pins the published upstream that provides --refresh-scope", () => {
    expect(INCREMENTAL_CHANGE_STALENESS_DEFAULT_KIT_COMMAND).toBe("npx @dailephd/my-dev-kit@1.12.5");
  });
});

describe.runIf(enabled)("L2 four-treatment lifecycle and execution against the real published my-dev-kit 1.12.5", () => {
  it(
    "realizes both partial treatments with the real upstream, keeps stale as no-refresh, and builds a valid V2 artifact",
    async () => {
      const resolved = await resolveScenario("L2");
      const runOwnedRoot = makeRunOwnedRoot(tracked, "ics-v063-real-");
      const lifecycle = await prepareIncrementalChangeStalenessScenarioLifecycleV2({
        repoRoot,
        runOwnedRoot,
        scenario: resolved.scenario,
        baseCase: resolved.baseCase,
        kitCommand: INCREMENTAL_CHANGE_STALENESS_DEFAULT_KIT_COMMAND
      });
      if (lifecycle.status !== "ready") {
        throw new Error(`Real upstream lifecycle failed: ${lifecycle.failure.code}: ${lifecycle.failure.message}`);
      }
      expect(lifecycle.session.toolIdentity.availability).toBe("available");
      expect(lifecycle.session.toolIdentity.version).toContain("1.12.5");

      const projectProfiles = await readBenchmarkProjectProfiles(path.resolve(repoRoot, BENCHMARK_PROJECT_PROFILES_PATH), repoRoot);
      const execution = await executeIncrementalChangeStalenessScenarioV2({
        repoRoot,
        scenario: resolved.scenario,
        lifecycle,
        baseCase: resolved.baseCase,
        projectProfiles,
        runOwnedRoot,
        cwd: repoRoot
      });
      expect(execution.status).toBe("ready");
      expect(execution.treatments.map((treatment) => treatment.treatmentId)).toEqual([
        "stale-index",
        "changed-files-refresh",
        "affected-neighborhood-refresh",
        "full-refresh"
      ]);
      expect(execution.referenceComparisons).toHaveLength(3);

      const byId = Object.fromEntries(execution.treatments.map((treatment) => [treatment.treatmentId, treatment]));
      expect(byId["stale-index"].refreshExecution).toMatchObject({ kind: "no-refresh", realization: "NO_REFRESH" });
      expect(byId["stale-index"].activeIndexPhase).toBe("baseline");
      expect(byId["full-refresh"].refreshExecution).toMatchObject({ kind: "full", realization: "FULL_REFRESH" });
      for (const [id, scope] of [
        ["changed-files-refresh", "changed-files"],
        ["affected-neighborhood-refresh", "affected-neighborhood"]
      ] as const) {
        const refresh = byId[id].refreshExecution;
        expect(refresh.kind).toBe("incremental");
        if (refresh.kind !== "incremental") continue;
        // A real cloned baseline must be accepted as trusted: a full fallback is not partial-refresh evidence.
        expect(refresh.realization, `${id} fallbackReason=${refresh.incrementalRefresh.fallbackReason}`).toBe("APPLIED_PARTIAL");
        expect(refresh.incrementalRefresh).toMatchObject({ requestedScope: scope, appliedScope: scope, selectionStatus: "applied", fallbackReason: null });
        expect(byId[id].refreshedFreshness?.status).toBe("fresh");
      }

      // The artifact builder runs the production contradiction validator and never serializes an inconsistency.
      const artifact = buildIncrementalChangeStalenessExecutionArtifactV2({ runId: "real-upstream-smoke", pluginId: "incremental-change-staleness", executions: [execution] });
      expect(artifact.scenarios[0].treatments).toHaveLength(4);
      expect(artifact.scenarios[0].referenceComparisons).toHaveLength(3);
    },
    900_000
  );
});
