import { existsSync, readdirSync } from "node:fs";
import { rm } from "node:fs/promises";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { INCREMENTAL_CHANGE_STALENESS_DEFAULT_KIT_COMMAND } from "../../../src/experiments/plugins/incrementalChangeStaleness/config.js";
import { prepareIncrementalChangeStalenessScenarioLifecycle } from "../../../src/experiments/plugins/incrementalChangeStaleness/lifecycle.js";
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
