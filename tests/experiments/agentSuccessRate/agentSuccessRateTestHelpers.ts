import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { assertAgentSuccessTask, type AgentSuccessTaskV1 } from "../../../src/evaluation/agentSuccess/index.js";
import { runExperiment } from "../../../src/experiments/runner.js";
import type { ExperimentRun } from "../../../src/experiments/types.js";
import type { AgentSuccessRateRun } from "../../../src/experiments/plugins/agentSuccessRate/index.js";
import type {
  AgentSuccessCaseEvidenceV1,
  AgentSuccessTreatmentEvidenceV1,
  AgentSuccessVerificationCheckEvidenceV1
} from "../../../src/experiments/plugins/agentSuccessRate/index.js";
import { FIXTURE_FILES, FIX_PATCH, baseTaskInput, makeTempDir, writeProjectFiles } from "../../evaluation/benchmarkSandbox/sandboxTestHelpers.js";

export { FIXTURE_FILES, FIX_PATCH, baseTaskInput, makeTempDir, writeProjectFiles };

export const README_PATCH = ["diff --git a/docs/readme.md b/docs/readme.md", "--- a/docs/readme.md", "+++ b/docs/readme.md", "@@ -1 +1,2 @@", " # Fixture", "+extra", ""].join("\n");

export const PROTECTED_PATCH = ["diff --git a/protected.txt b/protected.txt", "--- a/protected.txt", "+++ b/protected.txt", "@@ -1 +1 @@", "-do not touch", "+touched", ""].join("\n");

/** A controlled tool root that mirrors the benchmarks/projects layout. Nothing is committed to the real benchmarks. */
export function makeToolRoot(projects: Readonly<Record<string, Readonly<Record<string, string>>>> = { fixture: FIXTURE_FILES }): string {
  const toolRoot = makeTempDir("lab-asr-tool-");
  writeFileSync(path.join(toolRoot, "package.json"), '{"name":"asr-tool-root","version":"0.0.0"}\n');
  for (const [project, files] of Object.entries(projects)) {
    const projectRoot = path.join(toolRoot, "benchmarks", "projects", project);
    mkdirSync(projectRoot, { recursive: true });
    writeProjectFiles(projectRoot, files);
  }
  return toolRoot;
}

export function taskInput(overrides: Record<string, unknown> = {}, patch: string = FIX_PATCH): Record<string, unknown> {
  return { ...baseTaskInput(), deterministicFixture: { id: "fx-fix", patch, notes: "prose that must never count as evidence" }, ...overrides };
}

export function makeTask(overrides: Record<string, unknown> = {}, patch: string = FIX_PATCH): AgentSuccessTaskV1 {
  return assertAgentSuccessTask(taskInput(overrides, patch));
}

export async function runAgentSuccess(args: {
  toolRoot: string;
  tasks?: unknown;
  config?: Record<string, unknown>;
  runId?: string;
  targetPath?: string;
  outputRoot?: string;
  extraInputs?: Record<string, unknown>;
}): Promise<{ run: AgentSuccessRateRun; outDir: string }> {
  const outDir = args.outputRoot ?? path.join(makeTempDir("lab-asr-out-"), "out");
  const inputs: Record<string, unknown> = { ...(args.tasks === undefined ? {} : { agentSuccessTasks: args.tasks }), ...args.extraInputs };
  const run: ExperimentRun = await runExperiment({
    pluginId: "agent-success-rate",
    toolRoot: args.toolRoot,
    outputRoot: outDir,
    runId: args.runId ?? "run-1",
    startedAt: new Date("2026-01-01T00:00:00.000Z"),
    config: args.config,
    targetPath: args.targetPath,
    inputs
  });
  return { run: run as AgentSuccessRateRun, outDir };
}

// ---- synthetic evidence for pure analysis tests ----

const check = (checkId: string, checkClass: "task" | "regression", status: AgentSuccessVerificationCheckEvidenceV1["status"]): AgentSuccessVerificationCheckEvidenceV1 => ({
  checkId,
  class: checkClass,
  status,
  exitCode: status === "passed" ? 0 : status === "failed" ? 1 : null,
  durationMs: 5,
  failureReason: status === "passed" ? null : "reason"
});

export function makeTreatmentEvidence(overrides: Partial<AgentSuccessTreatmentEvidenceV1> = {}, treatmentId: AgentSuccessTreatmentEvidenceV1["treatmentId"] = "raw-full-file"): AgentSuccessTreatmentEvidenceV1 {
  return {
    treatmentId,
    status: "completed",
    availability: "complete",
    sandboxId: `sb-${treatmentId}`,
    sandboxBaseline: { commit: "a".repeat(40), fileCount: 6, digest: "d".repeat(64) },
    baselineTextLineCount: 10,
    baselineVerification: { phase: "baseline", taskResults: [check("task-add", "task", "failed")], regressionResults: [check("regression-id", "regression", "passed")] },
    baselineAssessment: { evaluable: true, reasons: [] },
    patch: {
      attempted: true,
      outcome: "success",
      code: null,
      message: null,
      appliedFiles: [{ path: "src/math.cjs", status: "modified" }],
      rejections: [],
      attemptedProtectedPaths: [],
      proposedPatchBytes: 100
    },
    change: {
      baselineCommit: "a".repeat(40),
      changedFiles: [{ relativePath: "src/math.cjs", status: "modified", beforeSha256: "1".repeat(64), afterSha256: "2".repeat(64), additions: 1, deletions: 1 }],
      addedCount: 0,
      modifiedCount: 1,
      deletedCount: 0,
      changedCount: 1,
      totalAdditions: 1,
      totalDeletions: 1
    },
    postEditVerification: { phase: "post-edit", taskResults: [check("task-add", "task", "passed")], regressionResults: [check("regression-id", "regression", "passed")] },
    protectedIntegrity: { status: "intact", mutatedPaths: [] },
    timing: { agentDurationMs: null, baselineVerificationDurationMs: 10, patchPipelineDurationMs: 20, postEditVerificationDurationMs: 30, evaluationDurationMs: 70 },
    agentTokenUsage: null,
    cleanup: { attempted: true, removed: true, reason: null },
    proposedPatchPath: `diffs/fixture/fixture-add-fix/${treatmentId}/attempt-1-proposed.patch`,
    appliedPatchPath: `diffs/fixture/fixture-add-fix/${treatmentId}/attempt-1-applied.patch`,
    errors: [],
    ...overrides
  };
}

export function makeCaseEvidence(task: AgentSuccessTaskV1, perTreatment: Partial<AgentSuccessTreatmentEvidenceV1>[] = [{}, {}]): AgentSuccessCaseEvidenceV1 {
  return {
    caseId: task.id,
    caseName: task.title,
    benchmarkProject: task.benchmarkProject,
    taskLocality: task.taskLocality,
    fixtureId: "fx-fix",
    treatments: [makeTreatmentEvidence(perTreatment[0], "raw-full-file"), makeTreatmentEvidence(perTreatment[1], "context-pack")]
  };
}

export { check as makeCheckEvidence };
