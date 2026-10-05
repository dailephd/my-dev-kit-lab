import { createHash } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, symlinkSync, writeFileSync } from "node:fs";
import { rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { readEvaluationCases } from "../../../src/evaluation/readEvaluationCases.js";
import { readBenchmarkProjectProfiles } from "../../../src/evaluation/benchmarkMetadata.js";
import {
  createDisposableTreatmentTarget,
  removeDisposableTreatmentTarget,
  removeIncrementalChangeStalenessRuntimeRoot,
  resolveWithinDisposableTarget,
  type DisposableTreatmentTargetV1
} from "../../../src/experiments/plugins/incrementalChangeStaleness/disposableTarget.js";
import {
  BENCHMARK_PROJECT_PROFILES_PATH,
  WARM_INDEX_BENCHMARK_CASES_PATH,
  readProductionIncrementalChangeStalenessScenarioCatalog
} from "../../../src/experiments/plugins/incrementalChangeStaleness/scenarioCatalog.js";
import { executeIncrementalChangeStalenessMutation } from "../../../src/experiments/plugins/incrementalChangeStaleness/mutationExecution.js";
import {
  captureIncrementalChangeStalenessSourceState,
  compareIncrementalChangeStalenessSourceStates,
  type IncrementalChangeStalenessSourceStateV1
} from "../../../src/experiments/plugins/incrementalChangeStaleness/sourceState.js";
import type { BenchmarkProjectProfile, EvaluationCase } from "../../../src/evaluation/types.js";

function sha256OfFile(absolutePath: string): string {
  return createHash("sha256").update(readFileSync(absolutePath)).digest("hex");
}

const repoRoot = process.cwd();

const CANONICAL_HASHES: Record<string, string> = {
  "benchmarks/contracts/warm-index-benchmark-cases.json": "076c6bf443f0705186644bc0eaba1f31b5083538c98a84999961c1874c73f48d",
  "benchmarks/contracts/incremental-change-staleness-scenarios.json": "08e3d440a79708a1f4817017f24821cae423326d3764092866ba7ee6b31d2ae7",
  "benchmarks/projects/task-analytics-large-mixed/py/task_analytics/quality.py": "5faab1bf018de6e647a11a2edffd641a51c0c05b399cb6f58a2c22b0ff035554",
  "benchmarks/projects/task-analytics-large-mixed/py/task_analytics/metrics.py": "da2bfce46ec51016f87b3456a201e69a9d71721002e1781b44fdc59a96650e91",
  "benchmarks/projects/task-analytics-large-mixed/ts/src/services/buildAnalyticsSnapshot.ts": "928af15041715ffa19ae3674e8d4f82e1c5f694cfa2bad1fea03db31bce6cedd",
  "benchmarks/projects/task-analytics-large-mixed/py/tests/test_quality.py": "b5610a2720012532baf6d18e114f375424008e0daadbc27291bfca2ce6316875",
  "benchmarks/projects/task-workflow-medium-ts/src/services/completeTask.ts": "27f6833abb1c5f8fa7226ec8a4857ba267dd48272d7cf094c7a3462e425ca64c"
};

function expectCanonicalFilesUnchanged() {
  for (const [relativePath, expectedSha] of Object.entries(CANONICAL_HASHES)) {
    expect(sha256OfFile(path.resolve(repoRoot, relativePath))).toBe(expectedSha);
  }
}

const tempRunRoots: string[] = [];
afterEach(async () => {
  await Promise.all(tempRunRoots.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
  expectCanonicalFilesUnchanged();
});

// Disposable runtime roots must stay inside the my-dev-kit-lab worktree
// (Section 6 of the spec), so test run roots live under the gitignored
// .my-dev-kit-context/ directory rather than the OS temp directory.
const testRuntimeParent = path.join(repoRoot, ".my-dev-kit-context", "test-runtime");
mkdirSync(testRuntimeParent, { recursive: true });

function makeRunRoot(): string {
  const dir = mkdtempSync(path.join(testRuntimeParent, "ics-batch2-"));
  tempRunRoots.push(dir);
  return dir;
}

async function loadFixtures(): Promise<{ profiles: BenchmarkProjectProfile[]; cases: EvaluationCase[] }> {
  const profiles = await readBenchmarkProjectProfiles(path.resolve(repoRoot, BENCHMARK_PROJECT_PROFILES_PATH), repoRoot);
  const cases = await readEvaluationCases(path.resolve(repoRoot, WARM_INDEX_BENCHMARK_CASES_PATH), repoRoot);
  return { profiles, cases };
}

describe("createDisposableTreatmentTarget", () => {
  it("creates two independent disposable copies with distinct roots (TST-B2-001, TST-B2-002)", async () => {
    const runRoot = makeRunRoot();
    const stale = await createDisposableTreatmentTarget({
      repoRoot,
      runRoot,
      scenarioId: "TEST-A",
      treatmentId: "stale-index",
      benchmarkProjectId: "task-workflow-medium-ts",
      canonicalProjectRootRelative: "benchmarks/projects/task-workflow-medium-ts"
    });
    const fullRefresh = await createDisposableTreatmentTarget({
      repoRoot,
      runRoot,
      scenarioId: "TEST-A",
      treatmentId: "full-refresh",
      benchmarkProjectId: "task-workflow-medium-ts",
      canonicalProjectRootRelative: "benchmarks/projects/task-workflow-medium-ts"
    });
    expect(stale.targetRoot).not.toBe(fullRefresh.targetRoot);
    expect(existsSync(stale.targetRoot)).toBe(true);
    expect(existsSync(fullRefresh.targetRoot)).toBe(true);
    expect(existsSync(path.join(stale.targetRoot, "src", "services", "completeTask.ts"))).toBe(true);
  });

  it("copies the whole benchmark project, not merely the changed file", async () => {
    const runRoot = makeRunRoot();
    const target = await createDisposableTreatmentTarget({
      repoRoot,
      runRoot,
      scenarioId: "TEST-B",
      treatmentId: "stale-index",
      benchmarkProjectId: "task-workflow-medium-ts",
      canonicalProjectRootRelative: "benchmarks/projects/task-workflow-medium-ts"
    });
    expect(existsSync(path.join(target.targetRoot, "README.md"))).toBe(true);
    expect(existsSync(path.join(target.targetRoot, "tests"))).toBe(true);
  });

  it("rejects an existing nonempty destination rather than overwriting it (TST-B2-005)", async () => {
    const runRoot = makeRunRoot();
    const options = {
      repoRoot,
      runRoot,
      scenarioId: "TEST-C",
      treatmentId: "stale-index" as const,
      benchmarkProjectId: "task-workflow-medium-ts",
      canonicalProjectRootRelative: "benchmarks/projects/task-workflow-medium-ts"
    };
    await createDisposableTreatmentTarget(options);
    await expect(createDisposableTreatmentTarget(options)).rejects.toThrow(/already exists/);
  });

  it("rejects a destination that unsafely overlaps the canonical benchmark tree (TST-B2-006)", async () => {
    const canonicalRoot = path.resolve(repoRoot, "benchmarks/projects/task-workflow-medium-ts");
    await expect(
      createDisposableTreatmentTarget({
        repoRoot,
        runRoot: canonicalRoot,
        scenarioId: "TEST-D",
        treatmentId: "stale-index",
        benchmarkProjectId: "task-workflow-medium-ts",
        canonicalProjectRootRelative: "benchmarks/projects/task-workflow-medium-ts"
      })
    ).rejects.toThrow(/unsafely overlaps/);
  });

  it("rejects a runRoot outside the repository", async () => {
    const outsideRoot = mkdtempSync(path.join(os.tmpdir(), "ics-outside-"));
    try {
      await expect(
        createDisposableTreatmentTarget({
          repoRoot,
          runRoot: outsideRoot,
          scenarioId: "TEST-E",
          treatmentId: "stale-index",
          benchmarkProjectId: "task-workflow-medium-ts",
          canonicalProjectRootRelative: "benchmarks/projects/task-workflow-medium-ts"
        })
      ).rejects.toThrow(/escapes/);
    } finally {
      await rm(outsideRoot, { recursive: true, force: true });
    }
  });
});

describe("resolveWithinDisposableTarget", () => {
  it("rejects target-relative path escape (TST-B2-007)", async () => {
    const runRoot = makeRunRoot();
    const target = await createDisposableTreatmentTarget({
      repoRoot,
      runRoot,
      scenarioId: "TEST-F",
      treatmentId: "stale-index",
      benchmarkProjectId: "task-workflow-medium-ts",
      canonicalProjectRootRelative: "benchmarks/projects/task-workflow-medium-ts"
    });
    await expect(resolveWithinDisposableTarget(target, "../outside.ts")).rejects.toThrow();
  });

  it("rejects a symlink that escapes the disposable treatment root (TST-B2-008)", async () => {
    const runRoot = makeRunRoot();
    const target = await createDisposableTreatmentTarget({
      repoRoot,
      runRoot,
      scenarioId: "TEST-G",
      treatmentId: "stale-index",
      benchmarkProjectId: "task-workflow-medium-ts",
      canonicalProjectRootRelative: "benchmarks/projects/task-workflow-medium-ts"
    });
    const outsideFile = path.join(runRoot, "outside-secret.txt");
    writeFileSync(outsideFile, "secret", "utf8");
    const linkPath = path.join(target.targetRoot, "escape-link.ts");
    try {
      symlinkSync(outsideFile, linkPath);
    } catch (error) {
      // Creating filesystem symlinks can require elevated privileges/Developer Mode on
      // Windows; when the platform refuses to create one, this guard cannot be exercised
      // and the test is skipped rather than reported as a false failure.
      expect((error as NodeJS.ErrnoException).code === "EPERM" || (error as NodeJS.ErrnoException).code === "EACCES").toBe(true);
      return;
    }
    await expect(resolveWithinDisposableTarget(target, "escape-link.ts")).rejects.toThrow(/symbolic link/);
  });
});

describe("removeDisposableTreatmentTarget / removeIncrementalChangeStalenessRuntimeRoot", () => {
  it("deletes only the owned disposable target and leaves siblings untouched (TST-B2-032)", async () => {
    const runRoot = makeRunRoot();
    const target = await createDisposableTreatmentTarget({
      repoRoot,
      runRoot,
      scenarioId: "TEST-H",
      treatmentId: "stale-index",
      benchmarkProjectId: "task-workflow-medium-ts",
      canonicalProjectRootRelative: "benchmarks/projects/task-workflow-medium-ts"
    });
    const sibling = path.join(runRoot, "unrelated-sibling.txt");
    writeFileSync(sibling, "keep me", "utf8");

    await removeDisposableTreatmentTarget(target, repoRoot, runRoot);

    expect(existsSync(target.targetRoot)).toBe(false);
    expect(existsSync(sibling)).toBe(true);
  });

  it("refuses to remove a target outside the caller-owned runRoot", async () => {
    const runRoot = makeRunRoot();
    const outsideDir = mkdtempSync(path.join(os.tmpdir(), "ics-outside-target-"));
    try {
      await expect(removeDisposableTreatmentTarget({ targetRoot: outsideDir }, repoRoot, runRoot)).rejects.toThrow(/escapes/);
      expect(existsSync(outsideDir)).toBe(true);
    } finally {
      await rm(outsideDir, { recursive: true, force: true });
    }
  });

  it("is idempotent when called repeatedly (TST-B2-033)", async () => {
    const runRoot = makeRunRoot();
    await createDisposableTreatmentTarget({
      repoRoot,
      runRoot,
      scenarioId: "TEST-I",
      treatmentId: "stale-index",
      benchmarkProjectId: "task-workflow-medium-ts",
      canonicalProjectRootRelative: "benchmarks/projects/task-workflow-medium-ts"
    });
    await removeIncrementalChangeStalenessRuntimeRoot(repoRoot, runRoot);
    await removeIncrementalChangeStalenessRuntimeRoot(repoRoot, runRoot);
    expect(existsSync(runRoot)).toBe(false);
  });
});

describe("captureIncrementalChangeStalenessSourceState / compareIncrementalChangeStalenessSourceStates", () => {
  it("both fresh treatment copies initially match canonical controlled source state (TST-B2-003, TST-B2-004)", async () => {
    const { cases } = await loadFixtures();
    const baseCase = cases.find((c) => c.id === "warm-medium-complete-idempotent")!;
    const runRoot = makeRunRoot();
    const stale = await createDisposableTreatmentTarget({
      repoRoot,
      runRoot,
      scenarioId: "TEST-J",
      treatmentId: "stale-index",
      benchmarkProjectId: "task-workflow-medium-ts",
      canonicalProjectRootRelative: "benchmarks/projects/task-workflow-medium-ts"
    });
    const fullRefresh = await createDisposableTreatmentTarget({
      repoRoot,
      runRoot,
      scenarioId: "TEST-J",
      treatmentId: "full-refresh",
      benchmarkProjectId: "task-workflow-medium-ts",
      canonicalProjectRootRelative: "benchmarks/projects/task-workflow-medium-ts"
    });
    const canonicalState = await captureIncrementalChangeStalenessSourceState(
      path.resolve(repoRoot, "benchmarks/projects/task-workflow-medium-ts"),
      baseCase.sourceRoots,
      "stale-index",
      "task-workflow-medium-ts"
    );
    const staleState = await captureIncrementalChangeStalenessSourceState(stale.targetRoot, baseCase.sourceRoots, "stale-index", "task-workflow-medium-ts");
    const fullRefreshState = await captureIncrementalChangeStalenessSourceState(fullRefresh.targetRoot, baseCase.sourceRoots, "full-refresh", "task-workflow-medium-ts");

    expect(canonicalState.status).toBe("complete");
    expect(compareIncrementalChangeStalenessSourceStates(canonicalState, staleState).result).toBe("equivalent");
    expect(compareIncrementalChangeStalenessSourceStates(canonicalState, fullRefreshState).result).toBe("equivalent");
    expect(compareIncrementalChangeStalenessSourceStates(staleState, fullRefreshState).result).toBe("equivalent");
  });

  it("detects an artificially changed treatment copy as different (TST-B2-026)", async () => {
    const { cases } = await loadFixtures();
    const baseCase = cases.find((c) => c.id === "warm-medium-complete-idempotent")!;
    const runRoot = makeRunRoot();
    const stale = await createDisposableTreatmentTarget({
      repoRoot,
      runRoot,
      scenarioId: "TEST-K",
      treatmentId: "stale-index",
      benchmarkProjectId: "task-workflow-medium-ts",
      canonicalProjectRootRelative: "benchmarks/projects/task-workflow-medium-ts"
    });
    const fullRefresh = await createDisposableTreatmentTarget({
      repoRoot,
      runRoot,
      scenarioId: "TEST-K",
      treatmentId: "full-refresh",
      benchmarkProjectId: "task-workflow-medium-ts",
      canonicalProjectRootRelative: "benchmarks/projects/task-workflow-medium-ts"
    });
    writeFileSync(path.join(fullRefresh.targetRoot, "src", "services", "completeTask.ts"), "// tampered\n", "utf8");

    const staleState = await captureIncrementalChangeStalenessSourceState(stale.targetRoot, baseCase.sourceRoots, "stale-index", "task-workflow-medium-ts");
    const fullRefreshState = await captureIncrementalChangeStalenessSourceState(fullRefresh.targetRoot, baseCase.sourceRoots, "full-refresh", "task-workflow-medium-ts");
    const comparison = compareIncrementalChangeStalenessSourceStates(staleState, fullRefreshState);
    expect(comparison.result).toBe("different");
    expect(comparison.reasons.some((reason) => reason.includes("completeTask.ts"))).toBe(true);
  });

  it("never reports equivalent when evidence is unavailable/incomplete (TST-B2-027)", async () => {
    const runRoot = makeRunRoot();
    const stale = await createDisposableTreatmentTarget({
      repoRoot,
      runRoot,
      scenarioId: "TEST-L",
      treatmentId: "stale-index",
      benchmarkProjectId: "task-workflow-medium-ts",
      canonicalProjectRootRelative: "benchmarks/projects/task-workflow-medium-ts"
    });
    const okState = await captureIncrementalChangeStalenessSourceState(stale.targetRoot, ["src", "tests"], "stale-index", "task-workflow-medium-ts");
    const unavailableState = await captureIncrementalChangeStalenessSourceState(
      stale.targetRoot,
      ["src", "does-not-exist"],
      "full-refresh",
      "task-workflow-medium-ts"
    );
    expect(unavailableState.status).toBe("unavailable");
    expect(unavailableState.reason).toBeDefined();
    const comparison = compareIncrementalChangeStalenessSourceStates(okState, unavailableState);
    expect(comparison.result).toBe("unknown");
    const selfComparison = compareIncrementalChangeStalenessSourceStates(unavailableState, unavailableState);
    expect(selfComparison.result).toBe("unknown");
  });

  it("is not affected by input file order (TST-B2-028)", () => {
    const makeState = (files: { relativePath: string; sha256: string }[]): IncrementalChangeStalenessSourceStateV1 => ({
      schemaVersion: "1.0.0",
      treatmentId: "stale-index",
      benchmarkProjectId: "proj",
      sourceRoots: ["src"],
      status: "complete",
      files,
      fileCount: files.length,
      digest: null
    });
    const a = makeState([
      { relativePath: "src/a.ts", sha256: "1".repeat(64) },
      { relativePath: "src/b.ts", sha256: "2".repeat(64) }
    ]);
    const b = makeState([
      { relativePath: "src/b.ts", sha256: "2".repeat(64) },
      { relativePath: "src/a.ts", sha256: "1".repeat(64) }
    ]);
    expect(compareIncrementalChangeStalenessSourceStates(a, b).result).toBe("equivalent");
  });

  it("normalizes source-root separators deterministically (TST-B2-029)", async () => {
    const runRoot = makeRunRoot();
    const target = await createDisposableTreatmentTarget({
      repoRoot,
      runRoot,
      scenarioId: "TEST-M",
      treatmentId: "stale-index",
      benchmarkProjectId: "task-workflow-medium-ts",
      canonicalProjectRootRelative: "benchmarks/projects/task-workflow-medium-ts"
    });
    const forward = await captureIncrementalChangeStalenessSourceState(target.targetRoot, ["src"], "stale-index", "task-workflow-medium-ts");
    const backslash = await captureIncrementalChangeStalenessSourceState(target.targetRoot, ["src\\"], "stale-index", "task-workflow-medium-ts");
    expect(forward.sourceRoots).toEqual(backslash.sourceRoots);
    expect(forward.digest).toBe(backslash.digest);
    expect(forward.files).toEqual(backslash.files);
  });

  it("detects a one-sided added/missing file (TST-B2-030)", () => {
    const base: IncrementalChangeStalenessSourceStateV1 = {
      schemaVersion: "1.0.0",
      treatmentId: "stale-index",
      benchmarkProjectId: "proj",
      sourceRoots: ["src"],
      status: "complete",
      files: [{ relativePath: "src/a.ts", sha256: "1".repeat(64) }],
      fileCount: 1,
      digest: null
    };
    const withExtra: IncrementalChangeStalenessSourceStateV1 = {
      ...base,
      treatmentId: "full-refresh",
      files: [...base.files, { relativePath: "src/b.ts", sha256: "2".repeat(64) }],
      fileCount: 2
    };
    const comparison = compareIncrementalChangeStalenessSourceStates(base, withExtra);
    expect(comparison.result).toBe("different");
    expect(comparison.reasons.some((reason) => reason.includes("src/b.ts"))).toBe(true);
  });

  it("detects a same-path different-hash file (TST-B2-031)", () => {
    const left: IncrementalChangeStalenessSourceStateV1 = {
      schemaVersion: "1.0.0",
      treatmentId: "stale-index",
      benchmarkProjectId: "proj",
      sourceRoots: ["src"],
      status: "complete",
      files: [{ relativePath: "src/a.ts", sha256: "1".repeat(64) }],
      fileCount: 1,
      digest: null
    };
    const right: IncrementalChangeStalenessSourceStateV1 = { ...left, treatmentId: "full-refresh", files: [{ relativePath: "src/a.ts", sha256: "2".repeat(64) }] };
    const comparison = compareIncrementalChangeStalenessSourceStates(left, right);
    expect(comparison.result).toBe("different");
    expect(comparison.reasons.some((reason) => reason.includes("content differs"))).toBe(true);
  });
});

describe("executeIncrementalChangeStalenessMutation: execution-time guards", () => {
  it("refuses to mutate a canonical benchmark target directly (TST-B2-009)", async () => {
    const { profiles, cases } = await loadFixtures();
    const catalog = await readProductionIncrementalChangeStalenessScenarioCatalog(repoRoot);
    const scenario = catalog.scenarios.find((s) => s.id === "L2")!;
    const profile = profiles.find((p) => p.projectId === scenario.benchmarkProjectId)!;
    const baseCase = cases.find((c) => c.id === scenario.baseCaseId)!;
    const canonicalTarget: DisposableTreatmentTargetV1 = {
      scenarioId: scenario.id,
      treatmentId: "stale-index",
      benchmarkProjectId: scenario.benchmarkProjectId,
      canonicalProjectRoot: path.resolve(repoRoot, profile.rootPath),
      targetRoot: path.resolve(repoRoot, profile.rootPath)
    };
    const receipt = await executeIncrementalChangeStalenessMutation(scenario, canonicalTarget, baseCase.sourceRoots, repoRoot);
    expect(receipt.status).toBe("rejected");
    expect(receipt.errors.some((message) => message.includes("canonical benchmark target directly"))).toBe(true);
  });

  it("rejects execution-time wrong pre-hash before any write (TST-B2-010)", async () => {
    const { cases } = await loadFixtures();
    const catalog = await readProductionIncrementalChangeStalenessScenarioCatalog(repoRoot);
    const scenario = catalog.scenarios.find((s) => s.id === "L2")!;
    const baseCase = cases.find((c) => c.id === scenario.baseCaseId)!;
    const runRoot = makeRunRoot();
    const target = await createDisposableTreatmentTarget({
      repoRoot,
      runRoot,
      scenarioId: "TEST-N",
      treatmentId: "stale-index",
      benchmarkProjectId: scenario.benchmarkProjectId,
      canonicalProjectRootRelative: "benchmarks/projects/task-workflow-medium-ts"
    });
    const tampered = { ...scenario, mutation: { files: [{ ...scenario.mutation.files[0], expectedPreSha256: "0".repeat(64) }] } };
    const beforeBytes = readFileSync(path.join(target.targetRoot, "src/services/completeTask.ts"));
    const receipt = await executeIncrementalChangeStalenessMutation(tampered, target, baseCase.sourceRoots, repoRoot);
    expect(receipt.status).toBe("rejected");
    expect(readFileSync(path.join(target.targetRoot, "src/services/completeTask.ts"))).toEqual(beforeBytes);
  });

  it("rejects execution-time missing preimage before any write (TST-B2-011)", async () => {
    const { cases } = await loadFixtures();
    const catalog = await readProductionIncrementalChangeStalenessScenarioCatalog(repoRoot);
    const scenario = catalog.scenarios.find((s) => s.id === "L2")!;
    const baseCase = cases.find((c) => c.id === scenario.baseCaseId)!;
    const runRoot = makeRunRoot();
    const target = await createDisposableTreatmentTarget({
      repoRoot,
      runRoot,
      scenarioId: "TEST-O",
      treatmentId: "stale-index",
      benchmarkProjectId: scenario.benchmarkProjectId,
      canonicalProjectRootRelative: "benchmarks/projects/task-workflow-medium-ts"
    });
    const tampered = {
      ...scenario,
      mutation: { files: [{ ...scenario.mutation.files[0], operations: [{ expectedPreimage: "not-present-anywhere", replacement: "x" }] }] }
    };
    const beforeBytes = readFileSync(path.join(target.targetRoot, "src/services/completeTask.ts"));
    const receipt = await executeIncrementalChangeStalenessMutation(tampered, target, baseCase.sourceRoots, repoRoot);
    expect(receipt.status).toBe("rejected");
    expect(receipt.errors.some((message) => message.includes("not found"))).toBe(true);
    expect(readFileSync(path.join(target.targetRoot, "src/services/completeTask.ts"))).toEqual(beforeBytes);
  });

  it("rejects execution-time ambiguous preimage before any write (TST-B2-012)", async () => {
    const { cases } = await loadFixtures();
    const catalog = await readProductionIncrementalChangeStalenessScenarioCatalog(repoRoot);
    const scenario = catalog.scenarios.find((s) => s.id === "L2")!;
    const baseCase = cases.find((c) => c.id === scenario.baseCaseId)!;
    const runRoot = makeRunRoot();
    const target = await createDisposableTreatmentTarget({
      repoRoot,
      runRoot,
      scenarioId: "TEST-P",
      treatmentId: "stale-index",
      benchmarkProjectId: scenario.benchmarkProjectId,
      canonicalProjectRootRelative: "benchmarks/projects/task-workflow-medium-ts"
    });
    // "task" occurs multiple times in completeTask.ts, so this preimage is ambiguous.
    const tampered = { ...scenario, mutation: { files: [{ ...scenario.mutation.files[0], operations: [{ expectedPreimage: "task", replacement: "x" }] }] } };
    const beforeBytes = readFileSync(path.join(target.targetRoot, "src/services/completeTask.ts"));
    const receipt = await executeIncrementalChangeStalenessMutation(tampered, target, baseCase.sourceRoots, repoRoot);
    expect(receipt.status).toBe("rejected");
    expect(receipt.errors.some((message) => message.includes("matches") && message.includes("times"))).toBe(true);
    expect(readFileSync(path.join(target.targetRoot, "src/services/completeTask.ts"))).toEqual(beforeBytes);
  });

  it("rejects execution-time wrong expected post-hash before any write (TST-B2-013)", async () => {
    const { cases } = await loadFixtures();
    const catalog = await readProductionIncrementalChangeStalenessScenarioCatalog(repoRoot);
    const scenario = catalog.scenarios.find((s) => s.id === "L2")!;
    const baseCase = cases.find((c) => c.id === scenario.baseCaseId)!;
    const runRoot = makeRunRoot();
    const target = await createDisposableTreatmentTarget({
      repoRoot,
      runRoot,
      scenarioId: "TEST-Q",
      treatmentId: "stale-index",
      benchmarkProjectId: scenario.benchmarkProjectId,
      canonicalProjectRootRelative: "benchmarks/projects/task-workflow-medium-ts"
    });
    const tampered = { ...scenario, mutation: { files: [{ ...scenario.mutation.files[0], expectedPostSha256: "1".repeat(64) }] } };
    const beforeBytes = readFileSync(path.join(target.targetRoot, "src/services/completeTask.ts"));
    const receipt = await executeIncrementalChangeStalenessMutation(tampered, target, baseCase.sourceRoots, repoRoot);
    expect(receipt.status).toBe("rejected");
    expect(readFileSync(path.join(target.targetRoot, "src/services/completeTask.ts"))).toEqual(beforeBytes);
  });

  it("mutation receipts never carry full source contents (TST-B2-017)", async () => {
    const { cases } = await loadFixtures();
    const catalog = await readProductionIncrementalChangeStalenessScenarioCatalog(repoRoot);
    const scenario = catalog.scenarios.find((s) => s.id === "P1")!;
    const baseCase = cases.find((c) => c.id === scenario.baseCaseId)!;
    const runRoot = makeRunRoot();
    const target = await createDisposableTreatmentTarget({
      repoRoot,
      runRoot,
      scenarioId: "TEST-R",
      treatmentId: "stale-index",
      benchmarkProjectId: scenario.benchmarkProjectId,
      canonicalProjectRootRelative: "benchmarks/projects/task-analytics-large-mixed"
    });
    const receipt = await executeIncrementalChangeStalenessMutation(scenario, target, baseCase.sourceRoots, repoRoot);
    expect(receipt.status).toBe("applied");
    const serialized = JSON.stringify(receipt);
    expect(serialized).not.toContain("stale_day_threshold=STALE_DAY_THRESHOLD");
    expect(serialized).not.toContain("def calculate_project_metrics");
    expect(serialized.length).toBeLessThan(4000);
  });
});

describe("all six frozen scenarios execute independently and deterministically on both treatment copies", () => {
  const scenarioIds = ["U1", "L2", "E1", "P1", "I1", "T1"] as const;

  for (const scenarioId of scenarioIds) {
    it(`${scenarioId}: baseline equivalence -> independent mutation -> post-mutation equivalence`, async () => {
      const { profiles, cases } = await loadFixtures();
      const catalog = await readProductionIncrementalChangeStalenessScenarioCatalog(repoRoot);
      const scenario = catalog.scenarios.find((s) => s.id === scenarioId)!;
      const profile = profiles.find((p) => p.projectId === scenario.benchmarkProjectId)!;
      const baseCase = cases.find((c) => c.id === scenario.baseCaseId)!;
      const runRoot = makeRunRoot();

      const stale = await createDisposableTreatmentTarget({
        repoRoot,
        runRoot,
        scenarioId,
        treatmentId: "stale-index",
        benchmarkProjectId: scenario.benchmarkProjectId,
        canonicalProjectRootRelative: profile.rootPath
      });
      const fullRefresh = await createDisposableTreatmentTarget({
        repoRoot,
        runRoot,
        scenarioId,
        treatmentId: "full-refresh",
        benchmarkProjectId: scenario.benchmarkProjectId,
        canonicalProjectRootRelative: profile.rootPath
      });

      // Required pre-mutation proof (Section 19).
      const preStale = await captureIncrementalChangeStalenessSourceState(stale.targetRoot, baseCase.sourceRoots, "stale-index", scenario.benchmarkProjectId);
      const preFullRefresh = await captureIncrementalChangeStalenessSourceState(
        fullRefresh.targetRoot,
        baseCase.sourceRoots,
        "full-refresh",
        scenario.benchmarkProjectId
      );
      expect(preStale.status).toBe("complete");
      expect(preFullRefresh.status).toBe("complete");
      expect(compareIncrementalChangeStalenessSourceStates(preStale, preFullRefresh).result).toBe("equivalent");

      // Required same-mutation proof (Section 20): apply the SAME scenario record independently.
      const staleReceipt = await executeIncrementalChangeStalenessMutation(scenario, stale, baseCase.sourceRoots, repoRoot);
      const fullRefreshReceipt = await executeIncrementalChangeStalenessMutation(scenario, fullRefresh, baseCase.sourceRoots, repoRoot);

      expect(staleReceipt.status).toBe("applied");
      expect(fullRefreshReceipt.status).toBe("applied");
      for (const receipt of [staleReceipt, fullRefreshReceipt]) {
        for (const fileReceipt of receipt.files) {
          expect(fileReceipt.written).toBe(true);
          expect(fileReceipt.observedPostSha256).toBe(fileReceipt.expectedPostSha256);
        }
      }

      // Required post-mutation proof (Section 21).
      const postStale = await captureIncrementalChangeStalenessSourceState(stale.targetRoot, baseCase.sourceRoots, "stale-index", scenario.benchmarkProjectId);
      const postFullRefresh = await captureIncrementalChangeStalenessSourceState(
        fullRefresh.targetRoot,
        baseCase.sourceRoots,
        "full-refresh",
        scenario.benchmarkProjectId
      );
      expect(postStale.status).toBe("complete");
      expect(postFullRefresh.status).toBe("complete");
      expect(compareIncrementalChangeStalenessSourceStates(postStale, postFullRefresh).result).toBe("equivalent");

      // The mutation must have actually changed something relative to the pre-state.
      expect(compareIncrementalChangeStalenessSourceStates(preStale, postStale).result).toBe("different");
    });
  }

  it("P1 applies its two ordered operations in declared sequence on disk (TST-B2-014)", async () => {
    const { profiles, cases } = await loadFixtures();
    const catalog = await readProductionIncrementalChangeStalenessScenarioCatalog(repoRoot);
    const scenario = catalog.scenarios.find((s) => s.id === "P1")!;
    const profile = profiles.find((p) => p.projectId === scenario.benchmarkProjectId)!;
    const baseCase = cases.find((c) => c.id === scenario.baseCaseId)!;
    const runRoot = makeRunRoot();
    const target = await createDisposableTreatmentTarget({
      repoRoot,
      runRoot,
      scenarioId: "P1-order",
      treatmentId: "stale-index",
      benchmarkProjectId: scenario.benchmarkProjectId,
      canonicalProjectRootRelative: profile.rootPath
    });
    const receipt = await executeIncrementalChangeStalenessMutation(scenario, target, baseCase.sourceRoots, repoRoot);
    expect(receipt.status).toBe("applied");
    const content = readFileSync(path.join(target.targetRoot, "py/task_analytics/metrics.py"), "utf8");
    expect(content).toContain("stale_day_threshold=STALE_DAY_THRESHOLD");
    expect(content).toContain(">= stale_day_threshold");
    expect(content).not.toContain("current_day - task.updated_day >= STALE_DAY_THRESHOLD");
  });

  it("I1 applies its two ordered operations in declared sequence on disk (TST-B2-015)", async () => {
    const { profiles, cases } = await loadFixtures();
    const catalog = await readProductionIncrementalChangeStalenessScenarioCatalog(repoRoot);
    const scenario = catalog.scenarios.find((s) => s.id === "I1")!;
    const profile = profiles.find((p) => p.projectId === scenario.benchmarkProjectId)!;
    const baseCase = cases.find((c) => c.id === scenario.baseCaseId)!;
    const runRoot = makeRunRoot();
    const target = await createDisposableTreatmentTarget({
      repoRoot,
      runRoot,
      scenarioId: "I1-order",
      treatmentId: "stale-index",
      benchmarkProjectId: scenario.benchmarkProjectId,
      canonicalProjectRootRelative: profile.rootPath
    });
    const receipt = await executeIncrementalChangeStalenessMutation(scenario, target, baseCase.sourceRoots, repoRoot);
    expect(receipt.status).toBe("applied");
    const content = readFileSync(path.join(target.targetRoot, "ts/src/services/buildAnalyticsSnapshot.ts"), "utf8");
    expect(content).not.toContain("listTasksByProject");
    expect(content).toContain("taskStore.list().filter(");
  });

  it("successful execution's observed post-write SHA is independently reproducible by re-reading the disk file (TST-B2-016)", async () => {
    const { profiles, cases } = await loadFixtures();
    const catalog = await readProductionIncrementalChangeStalenessScenarioCatalog(repoRoot);
    const scenario = catalog.scenarios.find((s) => s.id === "T1")!;
    const profile = profiles.find((p) => p.projectId === scenario.benchmarkProjectId)!;
    const baseCase = cases.find((c) => c.id === scenario.baseCaseId)!;
    const runRoot = makeRunRoot();
    const target = await createDisposableTreatmentTarget({
      repoRoot,
      runRoot,
      scenarioId: "T1-reread",
      treatmentId: "stale-index",
      benchmarkProjectId: scenario.benchmarkProjectId,
      canonicalProjectRootRelative: profile.rootPath
    });
    const receipt = await executeIncrementalChangeStalenessMutation(scenario, target, baseCase.sourceRoots, repoRoot);
    expect(receipt.status).toBe("applied");
    const onDiskSha = sha256OfFile(path.join(target.targetRoot, "py/tests/test_quality.py"));
    expect(onDiskSha).toBe(receipt.files[0].observedPostSha256);
    expect(onDiskSha).toBe(scenario.mutation.files[0].expectedPostSha256);
  });

  it("T1 remains updated_day 8 -> 9 and never reintroduces the abandoned completion_rate design (TST-B2-037)", async () => {
    const catalog = await readProductionIncrementalChangeStalenessScenarioCatalog(repoRoot);
    const t1 = catalog.scenarios.find((s) => s.id === "T1")!;
    const op = t1.mutation.files[0].operations[0];
    expect(op.expectedPreimage).toContain('"updated_day": 8');
    expect(op.replacement).toContain('"updated_day": 9');
    expect(op.expectedPreimage).not.toContain("completion_rate");
  });
});

describe("Batch 2 owners never perform index/retrieval treatment behavior (TST-B2-038)", () => {
  it("disposableTarget/sourceState/mutationExecution source never references index/retrieval owners", () => {
    const forbiddenModuleImports = [/from ["'].*indexSnapshot\.js["']/, /from ["'].*runMyDevKitRetrieval\.js["']/, /from ["'].*indexFreshness\.js["']/, /from ["'].*affectedNeighborhood\.js["']/];
    const files = [
      "src/experiments/plugins/incrementalChangeStaleness/disposableTarget.ts",
      "src/experiments/plugins/incrementalChangeStaleness/sourceState.ts",
      "src/experiments/plugins/incrementalChangeStaleness/mutationExecution.ts"
    ];
    for (const file of files) {
      const text = readFileSync(path.resolve(repoRoot, file), "utf8");
      for (const pattern of forbiddenModuleImports) {
        expect(pattern.test(text)).toBe(false);
      }
      expect(text).not.toMatch(/buildMyDevKitIndex/);
      expect(text).not.toMatch(/runMyDevKitRetrieval/);
    }
  });
});

describe("canonical and catalog immutability across the full Batch 2 focused suite (TST-B2-034, TST-B2-035, TST-B2-036)", () => {
  it("every tracked canonical file and both catalogs remain byte-for-byte unchanged", () => {
    expectCanonicalFilesUnchanged();
  });
});
