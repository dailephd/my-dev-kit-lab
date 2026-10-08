import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { beforeAll, describe, expect, it } from "vitest";
import {
  applyPatchToSandbox,
  assertReadAgentSuccessCorpus,
  assessBaseline,
  runVerificationChecks,
  type AgentSuccessCorpusV1,
  type AgentSuccessTaskV1,
  type BaselineAssessment,
  type PatchApplicationResult,
  type VerificationPhaseResult
} from "../../src/evaluation/agentSuccess/index.js";
import { createBenchmarkSandbox, digestTreeSnapshot, removeBenchmarkSandbox, snapshotProjectTree } from "../../src/evaluation/benchmarkSandbox/index.js";
import { captureChangeSet, type ChangeSetV1 } from "../../src/evaluation/changeSet/index.js";
import {
  validateAgentSuccessRateAnalysisArtifact,
  validateAgentSuccessRateArtifactFamily,
  validateAgentSuccessRateExecutionArtifact,
  type AgentSuccessRateAnalysisArtifactV1,
  type AgentSuccessRateExecutionArtifactV1,
  type AgentSuccessRateRun
} from "../../src/experiments/plugins/agentSuccessRate/index.js";
import { runExperiment } from "../../src/experiments/runner.js";
import { makeTempDir, useSandboxTestCleanup } from "../evaluation/benchmarkSandbox/sandboxTestHelpers.js";

useSandboxTestCleanup();

const repoRoot = process.cwd();
const projectsRoot = path.join(repoRoot, "benchmarks", "projects");

type TaskEvidence = {
  taskId: string;
  project: string;
  locality: string;
  sandboxId: string;
  baselineDigest: string;
  baselineCommit: string;
  canonicalDigestBefore: string;
  canonicalDigestAfter: string;
  canonicalFilesBefore: string[];
  canonicalFilesAfter: string[];
  baselineTaskStatuses: string[];
  baselineRegressionStatuses: string[];
  baselineAssessment: BaselineAssessment;
  patch: PatchApplicationResult;
  change: ChangeSetV1;
  changedPaths: string[];
  protectedMutations: string[];
  postTaskStatuses: string[];
  postRegressionStatuses: string[];
  unsatisfiedRequiredFacts: string[];
  unsatisfiedOptionalFacts: string[];
  cleanup: { removed: boolean; sandboxDirectoryGone: boolean; siblingFilePreserved: boolean; siblingDirectoryPreserved: boolean };
  sandboxRoot: string;
};

const evidence: TaskEvidence[] = [];
let corpus: AgentSuccessCorpusV1;

function listFiles(root: string): string[] {
  return readdirSync(root, { recursive: true, withFileTypes: true })
    .filter((entry) => entry.isFile())
    .map((entry) => path.relative(root, path.join(entry.parentPath, entry.name)).replace(/\\/g, "/"))
    .sort();
}

async function canonicalDigest(root: string): Promise<string> {
  return digestTreeSnapshot(await snapshotProjectTree(root, { excludedNames: [] }));
}

function statusesOf(phase: VerificationPhaseResult): { task: string[]; regression: string[] } {
  return { task: phase.taskResults.map((result) => result.status), regression: phase.regressionResults.map((result) => result.status) };
}

function unsatisfiedFacts(task: AgentSuccessTaskV1, post: VerificationPhaseResult, required: boolean): string[] {
  const passed = new Map([...post.taskResults, ...post.regressionResults].map((result) => [result.checkId, result.status === "passed"]));
  return task.behaviorFacts
    .filter((fact) => fact.required === required)
    .filter((fact) => !fact.verificationCheckIds.every((id) => passed.get(id) === true))
    .map((fact) => fact.id);
}

async function evaluateTask(task: AgentSuccessTaskV1): Promise<TaskEvidence> {
  const canonicalProjectRoot = path.join(projectsRoot, task.benchmarkProject);
  const runtimeRoot = makeTempDir("lab-asc-accept-");
  // Unrelated content beside the sandbox must survive its cleanup.
  writeFileSync(path.join(runtimeRoot, "sibling.txt"), "unrelated");
  mkdirSync(path.join(runtimeRoot, "sibling-dir"));
  writeFileSync(path.join(runtimeRoot, "sibling-dir", "keep.txt"), "unrelated");

  const canonicalDigestBefore = await canonicalDigest(canonicalProjectRoot);
  const canonicalFilesBefore = listFiles(canonicalProjectRoot);
  const sandboxId = `accept-${task.id}`.slice(0, 64);
  const sandbox = await createBenchmarkSandbox({ canonicalProjectRoot, runtimeRoot, sandboxId });

  const baseline = await runVerificationChecks({ sandbox, task, phase: "baseline" });
  const baselineAssessment = assessBaseline(baseline);
  const baselineStatuses = statusesOf(baseline);

  const patch = await applyPatchToSandbox({ sandbox, rawProposal: task.deterministicFixture!.patch, protectedFiles: task.protectedFiles });
  const change = await captureChangeSet({ sandbox });
  const changedPaths = change.changedFiles.map((file) => file.relativePath);
  const protectedSet = new Set(task.protectedFiles);
  const protectedMutations = changedPaths.filter((file) => protectedSet.has(file));

  const post = await runVerificationChecks({ sandbox, task, phase: "post-edit" });
  const postStatuses = statusesOf(post);

  const removal = await removeBenchmarkSandbox({ runtimeRoot, sandboxId });
  const result: TaskEvidence = {
    taskId: task.id,
    project: task.benchmarkProject,
    locality: task.taskLocality,
    sandboxId,
    baselineDigest: sandbox.baseline.digest,
    baselineCommit: sandbox.baseline.commit,
    canonicalDigestBefore,
    canonicalDigestAfter: await canonicalDigest(canonicalProjectRoot),
    canonicalFilesBefore,
    canonicalFilesAfter: listFiles(canonicalProjectRoot),
    baselineTaskStatuses: baselineStatuses.task,
    baselineRegressionStatuses: baselineStatuses.regression,
    baselineAssessment,
    patch,
    change,
    changedPaths,
    protectedMutations,
    postTaskStatuses: postStatuses.task,
    postRegressionStatuses: postStatuses.regression,
    unsatisfiedRequiredFacts: unsatisfiedFacts(task, post, true),
    unsatisfiedOptionalFacts: unsatisfiedFacts(task, post, false),
    cleanup: {
      removed: removal.removed,
      sandboxDirectoryGone: !existsSync(sandbox.sandboxRoot),
      siblingFilePreserved: readFileSync(path.join(runtimeRoot, "sibling.txt"), "utf8") === "unrelated",
      siblingDirectoryPreserved: existsSync(path.join(runtimeRoot, "sibling-dir", "keep.txt"))
    },
    sandboxRoot: sandbox.sandboxRoot
  };
  return result;
}

const forTask = (task: AgentSuccessTaskV1): TaskEvidence => evidence.find((entry) => entry.taskId === task.id)!;

describe("agent-success corpus dynamic acceptance (real canonical projects, independent clean copies)", () => {
  beforeAll(async () => {
    corpus = assertReadAgentSuccessCorpus(repoRoot);
    // Strictly sequential and each from its own fresh sandbox: no task ever sees another task's patch.
    for (const task of corpus.tasks) evidence.push(await evaluateTask(task));

    // Compact deterministic evidence for humans; written under the ignored reports root and never committed.
    const reportDir = path.join(repoRoot, "reports", "agent-success-corpus");
    mkdirSync(reportDir, { recursive: true });
    const report = evidence.map((entry) => ({
      taskId: entry.taskId,
      project: entry.project,
      locality: entry.locality,
      baseline: { taskChecks: entry.baselineTaskStatuses, regressionChecks: entry.baselineRegressionStatuses, evaluable: entry.baselineAssessment.evaluable },
      referencePatch: { outcome: entry.patch.outcome, changedFiles: entry.changedPaths, protectedMutations: entry.protectedMutations },
      postEdit: { taskChecks: entry.postTaskStatuses, regressionChecks: entry.postRegressionStatuses },
      unsatisfiedRequiredFacts: entry.unsatisfiedRequiredFacts,
      canonicalUnchanged: entry.canonicalDigestBefore === entry.canonicalDigestAfter,
      cleanup: entry.cleanup
    }));
    writeFileSync(path.join(reportDir, "dynamic-acceptance.json"), `${JSON.stringify({ schema: "agent-success-corpus-acceptance-evidence", tasks: report }, null, 2)}\n`);
  }, 600_000);

  it("evaluates exactly the six catalog tasks in catalog order", () => {
    expect(evidence.map((entry) => entry.taskId)).toEqual(corpus.tasks.map((task) => task.id));
    expect(evidence).toHaveLength(6);
  });

  it("COR-015 every unmodified baseline is evaluable", () => {
    for (const entry of evidence) expect(entry.baselineAssessment, entry.taskId).toEqual({ evaluable: true, reasons: [] });
  });

  it("COR-016 both task checks fail for each unmodified baseline", () => {
    for (const entry of evidence) expect(entry.baselineTaskStatuses, entry.taskId).toEqual(["failed", "failed"]);
  });

  it("COR-017 every regression check passes before the patch", () => {
    for (const task of corpus.tasks) {
      expect(forTask(task).baselineRegressionStatuses, task.id).toEqual(task.regressionChecks.map(() => "passed"));
    }
  });

  it("COR-019 every reference patch applies cleanly", () => {
    for (const entry of evidence) expect(entry.patch, entry.taskId).toMatchObject({ outcome: "success" });
  });

  it("COR-020 every reference patch changes exactly the expected edit files with deterministic change evidence", () => {
    for (const task of corpus.tasks) {
      const entry = forTask(task);
      expect(entry.changedPaths, task.id).toEqual(task.expectedEditFiles);
      expect(entry.change.changedFiles.every((file) => file.status === "modified"), task.id).toBe(true);
      expect(entry.change.changedCount, task.id).toBe(task.expectedEditFiles.length);
      expect(entry.change.baselineCommit, task.id).toBe(entry.baselineCommit);
      // The measured line counts are exactly the counts written in the reference patch.
      const patchLines = task.deterministicFixture!.patch.split("\n");
      const additions = patchLines.filter((line) => line.startsWith("+") && !line.startsWith("+++")).length;
      const deletions = patchLines.filter((line) => line.startsWith("-") && !line.startsWith("---")).length;
      expect(entry.change.totalAdditions, task.id).toBe(additions);
      expect(entry.change.totalDeletions, task.id).toBe(deletions);
    }
  });

  it("COR-021 no reference patch mutates a protected file", () => {
    for (const entry of evidence) expect(entry.protectedMutations, entry.taskId).toEqual([]);
  });

  it("COR-022 every reference patch makes both task checks pass", () => {
    for (const entry of evidence) expect(entry.postTaskStatuses, entry.taskId).toEqual(["passed", "passed"]);
  });

  it("COR-023 every reference patch preserves passing regression checks", () => {
    for (const task of corpus.tasks) {
      expect(forTask(task).postRegressionStatuses, task.id).toEqual(task.regressionChecks.map(() => "passed"));
    }
  });

  it("COR-024 every required behavior fact is satisfied by post-edit check evidence", () => {
    for (const entry of evidence) {
      expect(entry.unsatisfiedRequiredFacts, entry.taskId).toEqual([]);
      expect(entry.unsatisfiedOptionalFacts, entry.taskId).toEqual([]);
    }
  });

  it("COR-025 the six tasks are independent and were evaluated from identical clean copies", () => {
    expect(new Set(evidence.map((entry) => entry.sandboxId)).size).toBe(6);
    for (const project of ["agent-success-task-board-node", "agent-success-inventory-node"]) {
      const own = evidence.filter((entry) => entry.project === project);
      expect(own).toHaveLength(3);
      // Same canonical content and same deterministic baseline commit for every task of a project, regardless of order.
      expect(new Set(own.map((entry) => entry.baselineDigest)).size).toBe(1);
      expect(new Set(own.map((entry) => entry.baselineCommit)).size).toBe(1);
      expect(own[0]!.baselineDigest).toBe(own[0]!.canonicalDigestBefore);
    }
    // Each task is fixed by its own patch alone while the other tasks' defects remain: the baseline of every task
    // fails its own checks, and none of the reference patches touches another task's check files.
    for (const task of corpus.tasks) {
      for (const file of forTask(task).changedPaths) expect(file.startsWith("src/"), `${task.id}:${file}`).toBe(true);
    }
  });

  it("COR-026 canonical benchmark projects are unchanged by evaluation", () => {
    for (const entry of evidence) {
      expect(entry.canonicalDigestAfter, entry.taskId).toBe(entry.canonicalDigestBefore);
      expect(entry.canonicalFilesAfter, entry.taskId).toEqual(entry.canonicalFilesBefore);
    }
  });

  it("COR-027 the owned sandbox is removed after each task and unrelated sibling content is preserved", () => {
    for (const entry of evidence) {
      expect(entry.cleanup, entry.taskId).toEqual({ removed: true, sandboxDirectoryGone: true, siblingFilePreserved: true, siblingDirectoryPreserved: true });
    }
  });

  it("COR-028 no generated output remains in the canonical benchmark projects", () => {
    for (const project of ["agent-success-task-board-node", "agent-success-inventory-node"]) {
      const files = listFiles(path.join(projectsRoot, project));
      expect(files.filter((file) => /(^|\/)(node_modules|dist|build|coverage|lab-output|\.git)(\/|$)/.test(file))).toEqual([]);
      expect(files.filter((file) => file.endsWith(".patch") || file.endsWith(".orig") || file.endsWith(".rej"))).toEqual([]);
    }
  });

  it("COR-031 the intentionally failing benchmark checks are not discovered by the root Vitest suite", () => {
    const result = spawnSync(process.execPath, [path.join(repoRoot, "node_modules", "vitest", "vitest.mjs"), "list", "--filesOnly", "--dir", "benchmarks"], {
      cwd: repoRoot,
      encoding: "utf8",
      timeout: 120_000
    });
    const combined = `${result.stdout}\n${result.stderr}`;
    expect(combined).not.toMatch(/agent-success-(task-board|inventory)-node/);
    expect(combined).not.toMatch(/\.check\.mjs/);
    // Naming is the only protection needed: none of the benchmark files matches Vitest's default include globs.
    for (const project of ["agent-success-task-board-node", "agent-success-inventory-node"]) {
      expect(listFiles(path.join(projectsRoot, project)).filter((file) => /\.(test|spec)\.[cm]?[jt]sx?$/.test(file))).toEqual([]);
    }
  }, 150_000);

  it("COR-014 and COR-025 patches are not order-dependent: a reverse-order replay gives identical outcomes for a localized and a broad task", async () => {
    // Evaluate two tasks of the same project again in reverse catalog order from fresh copies.
    const tasks = corpus.tasks.filter((task) => task.benchmarkProject === "agent-success-task-board-node").reverse();
    for (const task of [tasks[0]!, tasks[2]!]) {
      const replay = await evaluateTask(task);
      const original = forTask(task);
      expect(replay.baselineTaskStatuses).toEqual(original.baselineTaskStatuses);
      expect(replay.postTaskStatuses).toEqual(original.postTaskStatuses);
      expect(replay.postRegressionStatuses).toEqual(original.postRegressionStatuses);
      expect(replay.change.changedFiles).toEqual(original.change.changedFiles);
      expect(replay.change.diff).toBe(original.change.diff);
      expect(replay.baselineCommit).toBe(original.baselineCommit);
    }
  }, 240_000);
});

describe("agent-success-rate plugin over the canonical six-task corpus", () => {
  it("COR-040 to COR-044 evaluates six cases, 12 treatment outcomes and valid deterministic artifacts", async () => {
    const tasks = assertReadAgentSuccessCorpus(repoRoot).tasks;
    const outDir = path.join(makeTempDir("lab-asc-plugin-"), "out");
    const canonicalBefore = await Promise.all(["agent-success-task-board-node", "agent-success-inventory-node"].map((project) => canonicalDigest(path.join(projectsRoot, project))));

    const run = (await runExperiment({
      pluginId: "agent-success-rate",
      toolRoot: repoRoot,
      outputRoot: outDir,
      runId: "corpus-acceptance",
      startedAt: new Date("2026-01-01T00:00:00.000Z"),
      inputs: { agentSuccessTasks: tasks }
    })) as AgentSuccessRateRun;

    // COR-040 / COR-041
    expect(run.failures).toEqual([]);
    expect(run.status).toBe("completed");
    expect(run.cases.map((entry) => entry.id)).toEqual(tasks.map((task) => task.id));
    expect(run.cases).toHaveLength(6);
    const outcomes = run.cases.flatMap((entry) => entry.outcomes);
    expect(outcomes).toHaveLength(12);
    expect(outcomes.map((outcome) => outcome.variantId)).toEqual(tasks.flatMap(() => ["raw-full-file", "context-pack"]));

    // COR-042: the reference patch fixes the task under both variants (pipeline and corpus validity only).
    for (const outcome of outcomes) {
      expect(outcome.status, outcome.id).toBe("completed");
      expect(outcome.metadata?.taskSuccess, outcome.id).toBe(true);
      // COR-044
      expect(outcome.metadata?.executionMode, outcome.id).toBe("deterministic-fixture");
      expect(outcome.metadata?.contextEffectEvaluated, outcome.id).toBe(false);
    }

    // COR-043: persisted artifacts are valid and agree with the six-task corpus.
    const execution = JSON.parse(readFileSync(path.join(outDir, "agent-success-rate-execution.json"), "utf8")) as AgentSuccessRateExecutionArtifactV1;
    const analysis = JSON.parse(readFileSync(path.join(outDir, "agent-success-rate-analysis.json"), "utf8")) as AgentSuccessRateAnalysisArtifactV1;
    expect(validateAgentSuccessRateExecutionArtifact(execution)).toEqual([]);
    expect(validateAgentSuccessRateAnalysisArtifact(analysis)).toEqual([]);
    expect(validateAgentSuccessRateArtifactFamily(execution, analysis)).toEqual([]);
    expect(execution.cases.map((entry) => entry.caseId)).toEqual(tasks.map((task) => task.id));
    expect(execution.contextEffectEvaluated).toBe(false);
    expect(analysis.analysis.contextEffectEvaluated).toBe(false);
    expect(analysis.analysis.executionMode).toBe("deterministic-fixture");
    expect(analysis.analysis.cases.map((entry) => entry.caseId)).toEqual(tasks.map((task) => task.id));
    for (const entry of execution.cases) {
      expect(entry.treatments.map((treatment) => treatment.treatmentId)).toEqual(["raw-full-file", "context-pack"]);
      for (const treatment of entry.treatments) {
        expect(treatment.baselineAssessment).toEqual({ evaluable: true, reasons: [] });
        expect(treatment.protectedIntegrity).toMatchObject({ status: "intact", mutatedPaths: [] });
        expect(treatment.cleanup).toMatchObject({ attempted: true, removed: true });
        expect(treatment.patch).toMatchObject({ outcome: "success" });
      }
    }
    for (const entry of analysis.analysis.cases) {
      for (const treatment of entry.treatments) {
        expect(treatment.metrics.taskSuccess).toMatchObject({ availability: "available", value: true });
      }
    }
    for (const aggregate of analysis.analysis.aggregates) {
      expect(aggregate.taskSuccessRate).toMatchObject({ availability: "available", value: 1 });
    }

    // Patch artifacts: one proposed and one applied patch per case and treatment, no sandbox directory left behind.
    const written = readdirSync(outDir, { recursive: true, withFileTypes: true })
      .filter((entry) => entry.isFile())
      .map((entry) => path.relative(outDir, path.join(entry.parentPath, entry.name)).replace(/\\/g, "/"))
      .sort();
    expect(written.filter((file) => file.endsWith(".patch"))).toHaveLength(24);
    expect(existsSync(path.join(outDir, "sandboxes"))).toBe(false);

    // Canonical projects were not mutated.
    const canonicalAfter = await Promise.all(["agent-success-task-board-node", "agent-success-inventory-node"].map((project) => canonicalDigest(path.join(projectsRoot, project))));
    expect(canonicalAfter).toEqual(canonicalBefore);
  }, 600_000);
});
