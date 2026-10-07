import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  applyPatchToSandbox,
  assessBaseline,
  assertAgentSuccessTask,
  runVerificationChecks
} from "../../../src/evaluation/agentSuccess/index.js";
import { createBenchmarkSandbox, removeBenchmarkSandbox, snapshotProjectTree } from "../../../src/evaluation/benchmarkSandbox/index.js";
import { captureChangeSet } from "../../../src/evaluation/changeSet/index.js";
import {
  FIX_PATCH,
  baseTaskInput,
  initCanonicalGitRepository,
  makeCanonicalFixture,
  makeTempDir,
  trackSandbox,
  useSandboxTestCleanup
} from "../benchmarkSandbox/sandboxTestHelpers.js";

useSandboxTestCleanup();
describe("mutable benchmark evaluation foundation lifecycle", () => {
  it("RSP-047 runs copy, baseline checks, patch, change capture, post-edit checks, canonical comparison and cleanup", async () => {
    const task = assertAgentSuccessTask(baseTaskInput());
    const canonical = makeCanonicalFixture();
    initCanonicalGitRepository(canonical);
    const canonicalBefore = await snapshotProjectTree(canonical, { excludedNames: [] });
    const runtimeRoot = path.join(makeTempDir("lab-rt-"), "runtime");

    // copy -> clean baseline
    const sandbox = await createBenchmarkSandbox({ canonicalProjectRoot: canonical, runtimeRoot, sandboxId: "e2e" });
    trackSandbox(runtimeRoot, "e2e");
    expect(sandbox.baseline.commit).toMatch(/^[0-9a-f]{40}$/);

    // baseline checks: a failing task check and a passing regression check make the benchmark evaluable
    const baseline = await runVerificationChecks({ sandbox, task, phase: "baseline" });
    expect(baseline.taskResults.map((entry) => entry.status)).toEqual(["failed"]);
    expect(baseline.regressionResults.map((entry) => entry.status)).toEqual(["passed"]);
    expect(assessBaseline(baseline)).toEqual({ evaluable: true, reasons: [] });
    const baselineEvidence = baseline.taskResults[0]!.stderrPath;
    expect(readFileSync(baselineEvidence, "utf8")).toContain("add failed");

    // patch (fenced, with prose) -> change capture
    const patched = await applyPatchToSandbox({
      sandbox,
      rawProposal: `The bug is the subtraction.\n\`\`\`diff\n${FIX_PATCH}\`\`\`\n`,
      protectedFiles: task.protectedFiles
    });
    expect(patched).toEqual({ outcome: "success", files: [{ path: "src/math.cjs", status: "modified" }] });
    const changes = await captureChangeSet({ sandbox });
    expect(changes.changedFiles.map((file) => `${file.status}:${file.relativePath}`)).toEqual(["modified:src/math.cjs"]);
    expect(changes).toMatchObject({ changedCount: 1, totalAdditions: 1, totalDeletions: 1 });
    // Expected-vs-actual scope is raw evidence only here: the changed file is within the task's allowed list.
    expect(task.allowedEditFiles).toContain(changes.changedFiles[0]!.relativePath);

    // post-edit checks: task check now passes, regression check still passes, kept separate
    const post = await runVerificationChecks({ sandbox, task, phase: "post-edit" });
    expect(post.taskResults.map((entry) => entry.status)).toEqual(["passed"]);
    expect(post.regressionResults.map((entry) => entry.status)).toEqual(["passed"]);

    // canonical unchanged, then cleanup of the owned runtime only
    expect(await snapshotProjectTree(canonical, { excludedNames: [] })).toEqual(canonicalBefore);
    expect(existsSync(baselineEvidence)).toBe(true);
    expect(await removeBenchmarkSandbox({ runtimeRoot, sandboxId: "e2e" })).toEqual({ removed: true, alreadyAbsent: false });
    expect(existsSync(sandbox.sandboxRoot)).toBe(false);
    expect(await snapshotProjectTree(canonical, { excludedNames: [] })).toEqual(canonicalBefore);
  });

  it("RSP-049 still permits cleanup after failing and timing-out checks while preserving evidence until then", async () => {
    const canonical = makeCanonicalFixture({ "tests/hang.check.cjs": "setInterval(() => {}, 1000);\n" });
    const runtimeRoot = path.join(makeTempDir("lab-rt-"), "runtime");
    const sandbox = await createBenchmarkSandbox({ canonicalProjectRoot: canonical, runtimeRoot, sandboxId: "failing" });
    trackSandbox(runtimeRoot, "failing");

    const phase = await runVerificationChecks({
      sandbox,
      task: {
        taskChecks: [
          { id: "fails", executable: "node", args: ["tests/task.check.cjs"], timeoutMs: 20_000 },
          { id: "hangs", executable: "node", args: ["tests/hang.check.cjs"], timeoutMs: 600 }
        ],
        regressionChecks: [{ id: "ok", executable: "node", args: ["tests/regression.check.cjs"], timeoutMs: 20_000 }]
      },
      phase: "baseline"
    });
    expect(phase.taskResults.map((entry) => entry.status)).toEqual(["failed", "timeout"]);
    expect(phase.regressionResults.map((entry) => entry.status)).toEqual(["passed"]);
    expect(assessBaseline(phase)).toEqual({ evaluable: false, reasons: ["CHECK_NOT_EVALUABLE"] });
    for (const result of [...phase.taskResults, ...phase.regressionResults]) {
      expect(existsSync(result.stdoutPath), result.checkId).toBe(true);
      expect(existsSync(result.stderrPath), result.checkId).toBe(true);
    }

    expect(await removeBenchmarkSandbox({ runtimeRoot, sandboxId: "failing" })).toMatchObject({ removed: true });
    expect(existsSync(sandbox.sandboxRoot)).toBe(false);
  });
});
