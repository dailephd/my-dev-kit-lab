import { existsSync, readdirSync } from "node:fs";
import { rm } from "node:fs/promises";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { readBenchmarkProjectProfiles } from "../../../src/evaluation/benchmarkMetadata.js";
import { INCREMENTAL_CHANGE_STALENESS_DEFAULT_KIT_COMMAND } from "../../../src/experiments/plugins/incrementalChangeStaleness/config.js";
import { executeIncrementalChangeStalenessScenario } from "../../../src/experiments/plugins/incrementalChangeStaleness/execution.js";
import { prepareIncrementalChangeStalenessScenarioLifecycle } from "../../../src/experiments/plugins/incrementalChangeStaleness/lifecycle.js";
import { BENCHMARK_PROJECT_PROFILES_PATH } from "../../../src/experiments/plugins/incrementalChangeStaleness/scenarioCatalog.js";
import {
  EXPECTED_READY_LIFECYCLE_EVENTS,
  expectCanonicalFilesUnchanged,
  expectNoIndexOutputInCanonicalProjects,
  makeRunOwnedRoot,
  repoRoot,
  resolveScenario
} from "./lifecycleTestHelpers.js";

/**
 * Focused Batch 3 compatibility smoke against the REAL published
 * `@dailephd/my-dev-kit@1.12.4` (network/npx required), for scenario L2 only.
 * Opt-in so ordinary test runs stay deterministic and offline:
 *   MY_DEV_KIT_LAB_REAL_UPSTREAM_SMOKE=1 npx vitest run <this file>
 * This is not packed-package acceptance (Batch 6).
 */
const enabled = process.env.MY_DEV_KIT_LAB_REAL_UPSTREAM_SMOKE === "1";

const tracked: string[] = [];
afterEach(async () => {
  await Promise.all(tracked.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
  expectCanonicalFilesUnchanged();
  expectNoIndexOutputInCanonicalProjects();
});

function commandIds(commandsDir: string): string[] {
  return existsSync(commandsDir) ? readdirSync(commandsDir).map((name) => name.split(".")[0]).sort() : [];
}

describe.runIf(enabled)("L2 lifecycle against the real published my-dev-kit (TST-B3-054, 055)", () => {
  it(
    "baseline indexes -> snapshots/graphs -> mutation -> stale baseline freshness -> refreshed index -> fresh refreshed state, with no retrieval",
    async () => {
      const resolved = await resolveScenario("L2");
      const runOwnedRoot = makeRunOwnedRoot(tracked, "ics-batch3-real-");
      const result = await prepareIncrementalChangeStalenessScenarioLifecycle({
        repoRoot,
        runOwnedRoot,
        scenario: resolved.scenario,
        baseCase: resolved.baseCase,
        kitCommand: INCREMENTAL_CHANGE_STALENESS_DEFAULT_KIT_COMMAND
      });
      if (result.status !== "ready") {
        throw new Error(`Real upstream lifecycle failed: ${result.failure.code}: ${result.failure.message}`);
      }
      const session = result.session;
      const stale = session.treatments["stale-index"];
      const full = session.treatments["full-refresh"];
      const controlled = resolved.scenario.mutation.files[0];

      expect(session.lifecycleEvents).toEqual(EXPECTED_READY_LIFECYCLE_EVENTS);
      expect(session.toolIdentity.availability).toBe("available");
      expect(session.toolIdentity.version).toBe("1.12.4");

      for (const baseline of [stale.changeAuthority.baselineIndex, full.changeAuthority.baselineIndex]) {
        expect(baseline.buildCommand.ok).toBe(true);
        expect(baseline.snapshot.status).toBe("complete");
        expect(baseline.graph.codeGraph).not.toBeNull();
        expect(baseline.snapshot.files.find((file) => file.path === controlled.path)?.sha256).toBe(controlled.expectedPreSha256);
      }
      for (const treatment of [stale, full]) {
        expect(treatment.mutationReceipt.status).toBe("applied");
        expect(treatment.changeAuthority.postMutationBaselineFreshness.status).toBe("stale");
        expect(treatment.changeAuthority.postMutationBaselineFreshness.changes.map((change) => change.path)).toEqual([controlled.path]);
      }
      expect(stale.activeRetrieval.index).toBe(stale.changeAuthority.baselineIndex);
      expect(stale.refreshedIndex).toBeNull();
      expect(full.refreshedIndex.buildCommand.ok).toBe(true);
      expect(full.refreshedIndex.snapshot.status).toBe("complete");
      expect(full.refreshedIndex.graph.codeGraph).not.toBeNull();
      expect(full.refreshedIndex.snapshot.files.find((file) => file.path === controlled.path)?.sha256).toBe(controlled.expectedPostSha256);
      expect(full.refreshedFreshness.status).toBe("fresh");
      expect(full.refreshedFreshness.changedFileCount).toBe(0);

      // TST-B3-055: only `index` and `--version` ran; no search/lookup/slice/source/context.
      for (const index of [stale.changeAuthority.baselineIndex, full.changeAuthority.baselineIndex, full.refreshedIndex]) {
        expect(commandIds(index.commandsDir)).toEqual(["index", "index", "index", "version", "version", "version"]);
      }
      expect(readdirSync(path.join(runOwnedRoot, "commands", "L2", "stale-index"))).toEqual(["baseline"]);
      expect(readdirSync(path.join(runOwnedRoot, "commands", "L2", "full-refresh")).sort()).toEqual(["baseline", "refreshed"]);
    },
    600_000
  );
});

describe.runIf(enabled)("L2 Batch 4 treatment execution against the real published my-dev-kit (TST-B4-085)", () => {
  it(
    "runs stale/full-refresh retrieval, fake-agent evaluation, correctness, required-file evidence, and a comparison classification with no retry/fallback and an unchanged canonical benchmark",
    async () => {
      const resolved = await resolveScenario("L2");
      const runOwnedRoot = makeRunOwnedRoot(tracked, "ics-batch4-real-");
      const lifecycle = await prepareIncrementalChangeStalenessScenarioLifecycle({
        repoRoot,
        runOwnedRoot,
        scenario: resolved.scenario,
        baseCase: resolved.baseCase,
        kitCommand: INCREMENTAL_CHANGE_STALENESS_DEFAULT_KIT_COMMAND
      });
      expect(lifecycle.status).toBe("ready");
      const projectProfiles = await readBenchmarkProjectProfiles(path.resolve(repoRoot, BENCHMARK_PROJECT_PROFILES_PATH), repoRoot);

      const execution = await executeIncrementalChangeStalenessScenario({
        repoRoot,
        scenario: resolved.scenario,
        lifecycle,
        baseCase: resolved.baseCase,
        projectProfiles,
        runOwnedRoot,
        cwd: repoRoot
      });

      expect(execution.status).toBe("ready");
      const stale = execution.stale!;
      const full = execution.fullRefresh!;

      // Faithfully recorded, real evidence for both treatments.
      expect(stale.retrieval).not.toBeNull();
      expect(full.retrieval).not.toBeNull();
      expect(stale.retrieval!.commands.filter((command) => command.commandId === "search")).toHaveLength(1);
      expect(full.retrieval!.commands.filter((command) => command.commandId === "search")).toHaveLength(1);
      expect(stale.fakeAgent).not.toBeNull();
      expect(full.fakeAgent).not.toBeNull();
      expect(stale.requiredFileEvidence.status).not.toBe("");
      expect(full.requiredFileEvidence.status).not.toBe("");

      // Retrieval authority: stale against the pre-mutation baseline index, full-refresh against the
      // post-mutation refreshed index.
      expect(lifecycle.status === "ready" && lifecycle.session.treatments["stale-index"].activeRetrieval.index.indexDir).toContain(
        path.join("stale-index", "baseline")
      );
      expect(lifecycle.status === "ready" && lifecycle.session.treatments["full-refresh"].activeRetrieval.index.indexDir).toContain(
        path.join("full-refresh", "refreshed")
      );

      // Classification follows the frozen algorithm; the observed result is empirical (not asserted).
      expect(["observed-stale-regression", "no-observed-stale-regression", "inconclusive"]).toContain(execution.comparison.staleRiskClassification);
      // Rule precedence is internally consistent with the two frozen comparison dimensions.
      if (execution.comparison.correctnessRelation === "stale-worse" || execution.comparison.requiredFileEvidenceRelation === "stale-worse") {
        expect(execution.comparison.staleRiskClassification).toBe("observed-stale-regression");
      }
    },
    600_000
  );
});
