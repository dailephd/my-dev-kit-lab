import { existsSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { BenchmarkSandboxError, createBenchmarkSandbox, snapshotProjectTree, type BenchmarkSandbox } from "../../../src/evaluation/benchmarkSandbox/index.js";
import type {
  AgentSuccessRateAnalysisArtifactV1,
  AgentSuccessRateExecutionArtifactV1,
  AgentSuccessRateRun
} from "../../../src/experiments/plugins/agentSuccessRate/index.js";
import { useSandboxTestCleanup } from "../../evaluation/benchmarkSandbox/sandboxTestHelpers.js";
import { FIXTURE_FILES, FIX_PATCH, PROTECTED_PATCH, README_PATCH, makeToolRoot, runAgentSuccess, taskInput } from "./agentSuccessRateTestHelpers.js";

useSandboxTestCleanup();

const readJson = <T>(file: string): T => JSON.parse(readFileSync(file, "utf8")) as T;
const metricOf = (run: AgentSuccessRateRun, variantId: string, id: string) =>
  run.analysis.cases[0]!.treatments.find((t) => t.treatmentId === variantId)!.metrics[id as keyof AgentSuccessRateRun["analysis"]["cases"][0]["treatments"][0]["metrics"]];
const canonicalOf = (toolRoot: string) => path.join(toolRoot, "benchmarks", "projects", "fixture");

describe("agent-success-rate deterministic execution (through runExperiment)", () => {
  it("ASR-014..017 executes one task in two independent sandboxes with the same fixture patch and records successful evidence", async () => {
    const toolRoot = makeToolRoot();
    const canonicalBefore = await snapshotProjectTree(canonicalOf(toolRoot), { excludedNames: [] });
    const created: BenchmarkSandbox[] = [];
    const { run, outDir } = await runAgentSuccess({
      toolRoot,
      tasks: [taskInput()],
      extraInputs: {
        agentSuccessDependencies: {
          createSandbox: async (options: Parameters<typeof createBenchmarkSandbox>[0]) => {
            const sandbox = await createBenchmarkSandbox(options);
            created.push(sandbox);
            return sandbox;
          }
        }
      }
    });

    // ASR-014: two independent sandboxes, run status and shape
    expect(run.status).toBe("completed");
    expect(run.variants.map((v) => v.id)).toEqual(["raw-full-file", "context-pack"]);
    expect(run.cases).toHaveLength(1);
    expect(run.cases[0]!.outcomes.map((o) => `${o.variantId}:${o.status}`)).toEqual(["raw-full-file:completed", "context-pack:completed"]);
    expect(created).toHaveLength(2);
    expect(new Set(created.map((s) => s.sandboxId)).size).toBe(2);
    expect(new Set(created.map((s) => s.projectRoot)).size).toBe(2);
    expect(created[0]!.baseline.commit).toMatch(/^[0-9a-f]{40}$/);

    const execution = readJson<AgentSuccessRateExecutionArtifactV1>(path.join(outDir, "agent-success-rate-execution.json"));
    const [raw, pack] = execution.cases[0]!.treatments;

    // ASR-016: explicit scientific limitation
    expect(execution.executionMode).toBe("deterministic-fixture");
    expect(execution.contextEffectEvaluated).toBe(false);
    expect(run.metadata).toMatchObject({ executionMode: "deterministic-fixture", contextEffectEvaluated: false });

    // ASR-017: clean baseline -> patch -> post-edit verification
    for (const treatment of [raw!, pack!]) {
      expect(treatment.sandboxBaseline!.commit).toMatch(/^[0-9a-f]{40}$/);
      expect(treatment.baselineAssessment).toEqual({ evaluable: true, reasons: [] });
      expect(treatment.baselineVerification!.taskResults.map((r) => r.status)).toEqual(["failed"]);
      expect(treatment.baselineVerification!.regressionResults.map((r) => r.status)).toEqual(["passed"]);
      expect(treatment.patch).toMatchObject({ attempted: true, outcome: "success", appliedFiles: [{ path: "src/math.cjs", status: "modified" }] });
      expect(treatment.change!.changedFiles.map((f) => `${f.status}:${f.relativePath}`)).toEqual(["modified:src/math.cjs"]);
      expect(treatment.postEditVerification!.taskResults.map((r) => r.status)).toEqual(["passed"]);
      expect(treatment.postEditVerification!.regressionResults.map((r) => r.status)).toEqual(["passed"]);
      expect(treatment.protectedIntegrity).toEqual({ status: "intact", mutatedPaths: [] });
      expect(treatment.cleanup).toEqual({ attempted: true, removed: true, reason: null });
      expect(treatment.availability).toBe("complete");
    }
    expect(raw!.sandboxId).not.toBe(pack!.sandboxId);
    // Both treatments receive the same deterministic fixture patch (ASR-015).
    const proposedRaw = readFileSync(path.join(outDir, raw!.proposedPatchPath!), "utf8");
    const proposedPack = readFileSync(path.join(outDir, pack!.proposedPatchPath!), "utf8");
    expect(proposedRaw).toBe(FIX_PATCH);
    expect(proposedPack).toBe(proposedRaw);
    expect(raw!.proposedPatchPath).not.toBe(pack!.proposedPatchPath);

    // task success and metrics for both treatments
    for (const variant of ["raw-full-file", "context-pack"]) {
      expect(metricOf(run, variant, "taskSuccess")).toMatchObject({ availability: "available", value: true });
      expect(metricOf(run, variant, "requiredFactsSatisfied")).toMatchObject({ value: true });
      expect(metricOf(run, variant, "expectedEditCoverage")).toMatchObject({ value: 1 });
      expect(metricOf(run, variant, "editScopePrecision")).toMatchObject({ value: 1 });
      expect(metricOf(run, variant, "unexpectedChangedFileCount")).toMatchObject({ value: 0 });
      expect(metricOf(run, variant, "changedFileCount")).toMatchObject({ value: 1 });
      expect(metricOf(run, variant, "totalChurn")).toMatchObject({ value: 2 });
      expect(metricOf(run, variant, "baselineTextLineCount")).toMatchObject({ value: 9 });
      expect(metricOf(run, variant, "relativeChurn").value).toBeCloseTo(2 / 9, 10);
    }
    expect(run.cases[0]!.outcomes[0]!.metrics.find((m) => m.id === "agent-success-rate.taskSuccess")).toMatchObject({ value: true, unit: "boolean", variantId: "raw-full-file", caseId: "fixture-add-fix" });

    // artifacts and patch separation
    const analysis = readJson<AgentSuccessRateAnalysisArtifactV1>(path.join(outDir, "agent-success-rate-analysis.json"));
    expect(analysis.analysis.cases[0]!.treatments.map((t) => t.treatmentId)).toEqual(["raw-full-file", "context-pack"]);
    const applied = readFileSync(path.join(outDir, raw!.appliedPatchPath!), "utf8");
    expect(applied).toContain("diff --git a/src/math.cjs b/src/math.cjs");
    expect(applied).not.toBe(proposedRaw);
    expect(run.artifacts.map((a) => a.path)).toEqual(
      expect.arrayContaining(["agent-success-rate-execution.json", "agent-success-rate-analysis.json", raw!.proposedPatchPath!, raw!.appliedPatchPath!, pack!.proposedPatchPath!, pack!.appliedPatchPath!])
    );
    expect(raw!.proposedPatchPath).toBe("diffs/fixture/fixture-add-fix/raw-full-file/attempt-1-proposed.patch");

    // ASR-020/021: canonical unchanged, sandboxes removed
    expect(await snapshotProjectTree(canonicalOf(toolRoot), { excludedNames: [] })).toEqual(canonicalBefore);
    for (const sandbox of created) expect(existsSync(sandbox.sandboxRoot)).toBe(false);
    expect(existsSync(path.join(outDir, "sandboxes"))).toBe(false);

    // ASR-051: no source, patch body, stdout or machine-local path inside the JSON artifacts
    const jsonText = readFileSync(path.join(outDir, "agent-success-rate-execution.json"), "utf8") + readFileSync(path.join(outDir, "agent-success-rate-analysis.json"), "utf8");
    for (const forbidden of ["module.exports", "diff --git", "@@", "do not touch", "prose that must never", "add failed", toolRoot, outDir, toolRoot.replace(/\\/g, "/")]) {
      expect(jsonText, forbidden).not.toContain(forbidden);
    }
    expect(JSON.stringify(run)).not.toContain("diff --git");
  }, 60_000);

  it("ASR-018 an invalid baseline is skipped evidence, neither task failure nor success", async () => {
    // The task check already passes at baseline (it points at the passing script), so nothing is left to fix.
    const task = taskInput({
      taskChecks: [{ id: "task-add", executable: "node", args: ["tests/regression.check.cjs"], timeoutMs: 20000 }],
      regressionChecks: [{ id: "regression-id", executable: "node", args: ["tests/regression.check.cjs"], timeoutMs: 20000 }]
    });
    const toolRoot = makeToolRoot();
    const { run, outDir } = await runAgentSuccess({ toolRoot, tasks: [task] });
    expect(run.status).toBe("skipped");
    for (const outcome of run.cases[0]!.outcomes) {
      expect(outcome.status).toBe("skipped");
      expect(outcome.metadata).toMatchObject({ evidenceAvailability: "baseline-invalid", taskSuccess: null });
      expect(outcome.warnings[0]).toMatchObject({ code: "baseline-invalid", details: { reasons: ["ALL_TASK_CHECKS_PASSED"] } });
    }
    expect(metricOf(run, "raw-full-file", "taskSuccess")).toMatchObject({ availability: "unavailable", value: null });
    expect(run.analysis.aggregates[0]).toMatchObject({ evaluableCaseCount: 0, successfulCaseCount: 0 });
    expect(run.analysis.aggregates[0]!.taskSuccessRate.availability).toBe("unavailable");
    const execution = readJson<AgentSuccessRateExecutionArtifactV1>(path.join(outDir, "agent-success-rate-execution.json"));
    expect(execution.cases[0]!.treatments[0]!.patch.attempted).toBe(false);
    expect(execution.cases[0]!.treatments[0]!.proposedPatchPath).toBeNull();
    expect(existsSync(path.join(outDir, "diffs"))).toBe(false);
  }, 60_000);

  it("ASR-019 a patch rejection is a completed, measured failed attempt", async () => {
    const toolRoot = makeToolRoot();
    const { run, outDir } = await runAgentSuccess({ toolRoot, tasks: [taskInput({}, PROTECTED_PATCH)] });
    expect(run.status).toBe("completed");
    const outcome = run.cases[0]!.outcomes[0]!;
    expect(outcome.status).toBe("completed");
    expect(outcome.failures).toEqual([]);
    expect(outcome.metadata).toMatchObject({ taskSuccess: false });
    const [raw] = run.caseExecutionEvidence[0]!.treatments;
    expect(raw!.patch).toMatchObject({ outcome: "policy-rejection", attemptedProtectedPaths: ["protected.txt"], appliedFiles: [] });
    expect(raw!.postEditVerification).toBeNull();
    expect(raw!.change).toBeNull();
    expect(raw!.appliedPatchPath).toBeNull();
    expect(existsSync(path.join(outDir, raw!.proposedPatchPath!))).toBe(true);
    expect(readdirSync(path.join(outDir, "diffs/fixture/fixture-add-fix/raw-full-file"))).toEqual(["attempt-1-proposed.patch"]);
    expect(metricOf(run, "raw-full-file", "taskSuccess")).toMatchObject({ availability: "available", value: false });
    expect(metricOf(run, "raw-full-file", "taskCheckPassRate").availability).toBe("unavailable");
    expect(metricOf(run, "raw-full-file", "changedFileCount").availability).toBe("unavailable");
    // A rejected proposal is not a mutation.
    expect(metricOf(run, "raw-full-file", "protectedMutationCount")).toMatchObject({ availability: "available", value: 0 });
    expect(metricOf(run, "raw-full-file", "attemptedProtectedEditCount")).toMatchObject({ value: 1 });
    expect(run.analysis.aggregates[0]).toMatchObject({ evaluableCaseCount: 1, successfulCaseCount: 0 });
    expect(run.analysis.aggregates[0]!.taskSuccessRate).toMatchObject({ availability: "available", value: 0 });
  }, 60_000);

  it("ASR-019 an unparseable proposal is also a completed failed attempt", async () => {
    const toolRoot = makeToolRoot();
    const { run } = await runAgentSuccess({ toolRoot, tasks: [taskInput({}, "this is not a patch\n")] });
    expect(run.status).toBe("completed");
    expect(run.caseExecutionEvidence[0]!.treatments[0]!.patch).toMatchObject({ outcome: "parse-failure", code: "NO_CANDIDATE" });
    expect(metricOf(run, "context-pack", "taskSuccess")).toMatchObject({ value: false });
  }, 60_000);

  it("ASR-029 unexpected but unprotected edits are measured and do not invalidate behavioral success", async () => {
    const toolRoot = makeToolRoot();
    const { run } = await runAgentSuccess({ toolRoot, tasks: [taskInput({}, FIX_PATCH + README_PATCH)] });
    expect(run.status).toBe("completed");
    expect(metricOf(run, "raw-full-file", "taskSuccess")).toMatchObject({ value: true });
    expect(metricOf(run, "raw-full-file", "unexpectedChangedFileCount")).toMatchObject({ value: 1 });
    expect(metricOf(run, "raw-full-file", "editScopePrecision").value).toBeCloseTo(0.5, 10);
    expect(metricOf(run, "raw-full-file", "expectedEditCoverage")).toMatchObject({ value: 1 });
    expect(metricOf(run, "raw-full-file", "changedFileCount")).toMatchObject({ value: 2 });
  }, 60_000);

  it("ASR-028 a protected file mutated during post-edit verification prevents task success", async () => {
    // The regression check rewrites a protected file once the fix is in place; only a post-edit check can do this.
    const files = {
      ...FIXTURE_FILES,
      "tests/regression.check.cjs":
        'const { add } = require("../src/math.cjs");\nif (add(1, 2) === 3) { require("node:fs").writeFileSync(require("node:path").join(__dirname, "..", "protected.txt"), "mutated\\n"); }\n'
    };
    const toolRoot = makeToolRoot({ fixture: files });
    const { run } = await runAgentSuccess({ toolRoot, tasks: [taskInput()] });
    const [raw] = run.caseExecutionEvidence[0]!.treatments;
    expect(raw!.protectedIntegrity).toEqual({ status: "mutated", mutatedPaths: ["protected.txt"] });
    expect(metricOf(run, "raw-full-file", "taskResolved")).toMatchObject({ value: true });
    expect(metricOf(run, "raw-full-file", "protectedMutationCount")).toMatchObject({ value: 1 });
    expect(metricOf(run, "raw-full-file", "taskSuccess")).toMatchObject({ availability: "available", value: false });
  }, 60_000);

  it("ASR-021 owned sandboxes are cleaned even when the attempt fails unexpectedly", async () => {
    const toolRoot = makeToolRoot();
    const created: BenchmarkSandbox[] = [];
    const { run, outDir } = await runAgentSuccess({
      toolRoot,
      tasks: [taskInput()],
      extraInputs: {
        agentSuccessDependencies: {
          createSandbox: async (options: Parameters<typeof createBenchmarkSandbox>[0]) => {
            const sandbox = await createBenchmarkSandbox(options);
            created.push(sandbox);
            return sandbox;
          },
          applyPatch: async () => {
            throw new Error("patch pipeline exploded");
          }
        }
      }
    });
    expect(run.status).toBe("failed");
    expect(run.cases[0]!.outcomes.map((o) => o.status)).toEqual(["failed", "failed"]);
    expect(run.cases[0]!.outcomes[0]!.failures.map((f) => f.code)).toEqual(["EXECUTION_FAILED"]);
    expect(created).toHaveLength(2);
    for (const sandbox of created) expect(existsSync(sandbox.sandboxRoot)).toBe(false);
    expect(existsSync(path.join(outDir, "sandboxes"))).toBe(false);
    expect(metricOf(run, "raw-full-file", "taskSuccess").availability).toBe("unavailable");
  }, 60_000);

  it("ASR-022 a cleanup failure is not silently counted as full success", async () => {
    const toolRoot = makeToolRoot();
    const { run } = await runAgentSuccess({
      toolRoot,
      tasks: [taskInput()],
      extraInputs: { agentSuccessDependencies: { removeSandbox: async () => ({ removed: false, reason: "directory is locked" }) } }
    });
    expect(run.status).toBe("partial");
    for (const outcome of run.cases[0]!.outcomes) {
      expect(outcome.status).toBe("partial");
      expect(outcome.failures.map((f) => f.code)).toEqual(["CLEANUP_FAILED"]);
    }
    const [raw] = run.caseExecutionEvidence[0]!.treatments;
    expect(raw!.cleanup).toMatchObject({ attempted: true, removed: false, reason: "directory is locked" });
    // The measured verdict is still recorded; the integrity problem is reported separately.
    expect(metricOf(run, "raw-full-file", "taskSuccess")).toMatchObject({ value: true });
    expect(run.summary!.failures.some((f) => f.code === "CLEANUP_FAILED")).toBe(true);
  }, 60_000);

  it("a sandbox creation failure is an infrastructure failure, not a task failure", async () => {
    const toolRoot = makeToolRoot();
    const { run } = await runAgentSuccess({
      toolRoot,
      tasks: [taskInput()],
      extraInputs: {
        agentSuccessDependencies: {
          createSandbox: async () => {
            throw new BenchmarkSandboxError("GIT_UNAVAILABLE", "the git executable is not available.");
          }
        }
      }
    });
    expect(run.status).toBe("failed");
    expect(run.cases[0]!.outcomes[0]!.failures[0]!.code).toBe("SANDBOX_GIT_UNAVAILABLE");
    expect(run.cases[0]!.outcomes[0]!.metadata).toMatchObject({ taskSuccess: null });
    expect(run.caseExecutionEvidence[0]!.treatments[0]!.cleanup.attempted).toBe(false);
  }, 60_000);

  it("a timed-out post-edit check yields partial evidence and an undetermined verdict, not a failing test", async () => {
    const files = { ...FIXTURE_FILES, "tests/hang.check.cjs": "setInterval(() => {}, 1000);\n" };
    const toolRoot = makeToolRoot({ fixture: files });
    // The regression check hangs only after the fix, so the baseline stays evaluable.
    const regression = 'const { add } = require("../src/math.cjs");\nif (add(1, 2) === 3) { setInterval(() => {}, 1000); }\n';
    writeFixtureFile(toolRoot, "tests/regression.check.cjs", regression);
    const { run } = await runAgentSuccess({
      toolRoot,
      tasks: [taskInput({ regressionChecks: [{ id: "regression-id", executable: "node", args: ["tests/regression.check.cjs"], timeoutMs: 700 }] })]
    });
    expect(run.status).toBe("partial");
    expect(run.cases[0]!.outcomes[0]!.failures.map((f) => f.code)).toContain("POST_EDIT_CHECK_INDETERMINATE");
    expect(metricOf(run, "raw-full-file", "regressionSafe")).toMatchObject({ availability: "unavailable" });
    expect(metricOf(run, "raw-full-file", "taskSuccess")).toMatchObject({ availability: "unavailable", value: null });
    expect(metricOf(run, "raw-full-file", "regressionCheckPassRate").availability).toBe("unavailable");
    expect(metricOf(run, "raw-full-file", "taskCheckPassRate")).toMatchObject({ availability: "available", value: 1 });
  }, 90_000);
});

function writeFixtureFile(toolRoot: string, relativePath: string, content: string): void {
  writeFileSync(path.join(toolRoot, "benchmarks", "projects", "fixture", ...relativePath.split("/")), content);
}
