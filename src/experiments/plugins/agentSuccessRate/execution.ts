import { createHash } from "node:crypto";
import { lstat, readFile, realpath } from "node:fs/promises";
import path from "node:path";
import { resolveWithinRoot } from "../../../core/pathSafety.js";
import {
  applyPatchToSandbox,
  assessBaseline,
  runVerificationChecks,
  validateAgentSuccessTask,
  type AgentSuccessTaskV1,
  type PatchApplicationResult,
  type VerificationCheckResult,
  type VerificationPhase,
  type VerificationPhaseResult
} from "../../../evaluation/agentSuccess/index.js";
import {
  BenchmarkSandboxError,
  createBenchmarkSandbox,
  removeBenchmarkSandbox,
  snapshotProjectTree,
  type BenchmarkSandbox,
  type CreateBenchmarkSandboxOptions,
  type RemoveBenchmarkSandboxOptions,
  type RemoveBenchmarkSandboxResult
} from "../../../evaluation/benchmarkSandbox/index.js";
import { isSameOrInside, resolvePhysicalPath } from "../../../evaluation/benchmarkSandbox/pathPolicy.js";
import { captureChangeSet, type ChangeSetV1 } from "../../../evaluation/changeSet/index.js";
import { isPathInside, sanitizePathSegment } from "../../outputPaths.js";
import type { AgentSuccessRateTreatmentId } from "./metadata.js";
import { AGENT_SUCCESS_RATE_TREATMENT_IDS } from "./metadata.js";
import type {
  AgentSuccessCaseEvidenceV1,
  AgentSuccessChangeEvidenceV1,
  AgentSuccessPatchEvidenceV1,
  AgentSuccessPatchFile,
  AgentSuccessProtectedIntegrityEvidenceV1,
  AgentSuccessTreatmentEvidenceV1,
  AgentSuccessTreatmentResult,
  AgentSuccessVerificationEvidenceV1
} from "./executionTypes.js";

export const AGENT_SUCCESS_RATE_MISSING_INPUT_MESSAGE =
  "Agent success rate requires an agentSuccessTasks input (an array of AgentSuccessTaskV1). No production task catalog is bundled in this version.";
export const AGENT_SUCCESS_RATE_SELF_ONLY_MESSAGE = "agent-success-rate supports only the self target; external-local targets are not supported.";

const MAX_BOUNDED_MESSAGE = 300;
const SAFE_PROJECT_ID = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;

export class AgentSuccessRateInputError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AgentSuccessRateInputError";
  }
}

/** Lab seams so tests can prove failure semantics. Production uses the Batch 1 implementations. */
export type AgentSuccessRateDependencies = {
  createSandbox(options: CreateBenchmarkSandboxOptions): Promise<BenchmarkSandbox>;
  removeSandbox(options: RemoveBenchmarkSandboxOptions): Promise<RemoveBenchmarkSandboxResult>;
  applyPatch(options: Parameters<typeof applyPatchToSandbox>[0]): Promise<PatchApplicationResult>;
  captureChanges(options: { sandbox: BenchmarkSandbox }): Promise<ChangeSetV1>;
  runChecks(options: { sandbox: BenchmarkSandbox; task: AgentSuccessTaskV1; phase: VerificationPhase }): Promise<VerificationPhaseResult>;
};

export const defaultAgentSuccessRateDependencies: AgentSuccessRateDependencies = {
  createSandbox: createBenchmarkSandbox,
  removeSandbox: removeBenchmarkSandbox,
  applyPatch: applyPatchToSandbox,
  captureChanges: captureChangeSet,
  runChecks: (options) => runVerificationChecks(options)
};

// ---------------------------------------------------------------------------------------------------------------
// Inputs
// ---------------------------------------------------------------------------------------------------------------

/**
 * Validates every candidate with the Batch 1 validator before anything touches the filesystem. Fails closed: there is
 * no default catalog, and no task is inferred from retrieval EvaluationCase objects.
 */
export function readAgentSuccessTasksInput(inputs: Record<string, unknown> | undefined): AgentSuccessTaskV1[] {
  const value = inputs?.agentSuccessTasks;
  if (value === undefined) throw new AgentSuccessRateInputError(AGENT_SUCCESS_RATE_MISSING_INPUT_MESSAGE);
  if (!Array.isArray(value)) throw new AgentSuccessRateInputError("agentSuccessTasks input must be an array of AgentSuccessTaskV1.");
  if (value.length === 0) throw new AgentSuccessRateInputError("agentSuccessTasks input must not be empty.");
  const tasks: AgentSuccessTaskV1[] = [];
  const seen = new Set<string>();
  value.forEach((candidate: unknown, index) => {
    const result = validateAgentSuccessTask(candidate);
    if (!result.ok) {
      const detail = result.issues
        .slice(0, 5)
        .map((issue) => `${issue.path || "(root)"}: ${issue.code}`)
        .join("; ");
      throw new AgentSuccessRateInputError(`agentSuccessTasks[${index}] is not a valid AgentSuccessTaskV1: ${detail}`);
    }
    const task = result.task;
    if (seen.has(task.id)) throw new AgentSuccessRateInputError(`Duplicate agent-success task id: ${task.id}`);
    seen.add(task.id);
    if (!task.deterministicFixture) {
      throw new AgentSuccessRateInputError(`Task ${task.id} has no deterministicFixture; deterministic-fixture mode requires one.`);
    }
    tasks.push(task);
  });
  return tasks;
}

/** Keeps input order, applies case then project filters, and fails clearly for unknown IDs or an empty selection. */
export function selectAgentSuccessTasks(
  tasks: readonly AgentSuccessTaskV1[],
  filters: { caseIds?: readonly string[]; benchmarkProjects?: readonly string[] }
): AgentSuccessTaskV1[] {
  const knownCases = new Set(tasks.map((task) => task.id));
  const missingCases = (filters.caseIds ?? []).filter((caseId) => !knownCases.has(caseId));
  if (missingCases.length > 0) throw new AgentSuccessRateInputError(`Agent-success task not found: ${missingCases.join(", ")}`);
  const knownProjects = new Set(tasks.map((task) => task.benchmarkProject));
  const missingProjects = (filters.benchmarkProjects ?? []).filter((project) => !knownProjects.has(project));
  if (missingProjects.length > 0) throw new AgentSuccessRateInputError(`Benchmark project not found: ${missingProjects.join(", ")}`);
  const selected = tasks
    .filter((task) => !filters.caseIds?.length || filters.caseIds.includes(task.id))
    .filter((task) => !filters.benchmarkProjects?.length || filters.benchmarkProjects.includes(task.benchmarkProject));
  if (selected.length === 0) throw new AgentSuccessRateInputError("No agent-success tasks matched the requested filters.");
  return selected;
}

/**
 * Resolves `<toolRoot>/benchmarks/projects/<benchmarkProject>` physically. A project ID that is not a plain path
 * segment, a missing project, a link, or a project that resolves outside the controlled directory is rejected.
 */
export async function resolveControlledBenchmarkProject(toolRoot: string, benchmarkProject: string): Promise<string> {
  if (!SAFE_PROJECT_ID.test(benchmarkProject)) {
    throw new AgentSuccessRateInputError(`Benchmark project id is not a safe path segment: ${boundMessage(benchmarkProject, [])}`);
  }
  const projectsRoot = path.join(path.resolve(toolRoot), "benchmarks", "projects");
  const candidate = resolveWithinRoot(projectsRoot, benchmarkProject);
  let stats;
  try {
    stats = await lstat(candidate);
  } catch {
    throw new AgentSuccessRateInputError(`Benchmark project not found in the controlled benchmark directory: ${benchmarkProject}`);
  }
  if (stats.isSymbolicLink() || !stats.isDirectory()) {
    throw new AgentSuccessRateInputError(`Benchmark project must be a real directory: ${benchmarkProject}`);
  }
  const physicalRoot = await realpath(projectsRoot);
  const physicalProject = await realpath(candidate);
  if (physicalProject === physicalRoot || !isPathInside(physicalRoot, physicalProject)) {
    throw new AgentSuccessRateInputError(`Benchmark project escapes the controlled benchmark directory: ${benchmarkProject}`);
  }
  return physicalProject;
}

/** The runtime root lives under the experiment output root and must never overlap the controlled benchmarks. */
export async function resolveSandboxRuntimeRoot(outDir: string, toolRoot: string): Promise<string> {
  const runtimeRoot = path.join(path.resolve(outDir), "sandboxes");
  const physicalRuntime = await resolvePhysicalPath(runtimeRoot);
  const physicalBenchmarks = await resolvePhysicalPath(path.join(path.resolve(toolRoot), "benchmarks"));
  if (isSameOrInside(physicalBenchmarks, physicalRuntime) || isSameOrInside(physicalRuntime, physicalBenchmarks)) {
    throw new AgentSuccessRateInputError("The experiment output root must not overlap the controlled benchmark directory.");
  }
  return runtimeRoot;
}

// ---------------------------------------------------------------------------------------------------------------
// Execution
// ---------------------------------------------------------------------------------------------------------------

export function deriveAgentSuccessSandboxId(runId: string, caseId: string, treatmentId: AgentSuccessRateTreatmentId): string {
  const digest = createHash("sha256").update(`${runId}\0${caseId}\0${treatmentId}`).digest("hex").slice(0, 20);
  return `asr-${digest}-${treatmentId === "raw-full-file" ? "raw" : "ctx"}`;
}

export function agentSuccessPatchArtifactPath(benchmarkProject: string, caseId: string, treatmentId: string, kind: "proposed" | "applied"): string {
  return `diffs/${sanitizePathSegment(benchmarkProject)}/${sanitizePathSegment(caseId)}/${sanitizePathSegment(treatmentId)}/attempt-1-${kind}.patch`;
}

/** Bounds a message and replaces any known machine-local root so no absolute path is persisted. */
export function boundMessage(message: string, privateRoots: readonly string[]): string {
  let text = message;
  for (const root of [...privateRoots].filter(Boolean).sort((a, b) => b.length - a.length)) {
    for (const variant of new Set([root, root.replace(/\\/g, "/")])) text = text.split(variant).join("<path>");
  }
  text = text.replace(/\s+/g, " ").trim();
  return text.length > MAX_BOUNDED_MESSAGE ? `${text.slice(0, MAX_BOUNDED_MESSAGE)}...` : text;
}

function summarizeVerification(phase: VerificationPhaseResult, privateRoots: readonly string[]): AgentSuccessVerificationEvidenceV1 {
  const summarize = (result: VerificationCheckResult, checkClass: "task" | "regression") => ({
    checkId: result.checkId,
    class: checkClass,
    status: result.status,
    exitCode: result.exitCode,
    durationMs: result.durationMs,
    failureReason: result.failureReason === null ? null : boundMessage(result.failureReason, privateRoots)
  });
  return {
    phase: phase.phase,
    taskResults: phase.taskResults.map((result) => summarize(result, "task")),
    regressionResults: phase.regressionResults.map((result) => summarize(result, "regression"))
  };
}

function summarizeChange(changes: ChangeSetV1): AgentSuccessChangeEvidenceV1 {
  return {
    baselineCommit: changes.baselineCommit,
    changedFiles: changes.changedFiles.map((file) => ({ ...file })),
    addedCount: changes.addedCount,
    modifiedCount: changes.modifiedCount,
    deletedCount: changes.deletedCount,
    changedCount: changes.changedCount,
    totalAdditions: changes.totalAdditions,
    totalDeletions: changes.totalDeletions
  };
}

/** Total line count of baseline files that are text (contain no NUL byte). Null when it cannot be determined reliably. */
async function countBaselineTextLines(sandbox: BenchmarkSandbox): Promise<number | null> {
  try {
    let lines = 0;
    for (const entry of sandbox.baseline.manifest) {
      const data = await readFile(path.join(sandbox.projectRoot, ...entry.path.split("/")));
      if (data.includes(0)) continue;
      for (const byte of data) if (byte === 10) lines += 1;
      if (data.length > 0 && data[data.length - 1] !== 10) lines += 1;
    }
    return lines;
  } catch {
    return null;
  }
}

/** Compares every protected path with the sandbox baseline manifest after all Lab-run work is finished. */
async function evaluateProtectedIntegrity(
  sandbox: BenchmarkSandbox,
  task: AgentSuccessTaskV1,
  changes: ChangeSetV1 | null
): Promise<AgentSuccessProtectedIntegrityEvidenceV1> {
  const protectedPaths = new Set(task.protectedFiles);
  const mutated = new Set<string>();
  for (const file of changes?.changedFiles ?? []) if (protectedPaths.has(file.relativePath)) mutated.add(file.relativePath);
  try {
    const working = new Map((await snapshotProjectTree(sandbox.projectRoot, { excludedNames: [".git"] })).map((entry) => [entry.path, entry.sha256]));
    const baseline = new Map(sandbox.baseline.manifest.map((entry) => [entry.path, entry.sha256]));
    for (const protectedPath of protectedPaths) {
      if (working.get(protectedPath) !== baseline.get(protectedPath)) mutated.add(protectedPath);
    }
  } catch {
    return { status: mutated.size > 0 ? "mutated" : "unproven", mutatedPaths: [...mutated].sort() };
  }
  return { status: mutated.size > 0 ? "mutated" : "intact", mutatedPaths: [...mutated].sort() };
}

function emptyPatchEvidence(): AgentSuccessPatchEvidenceV1 {
  return { attempted: false, outcome: null, code: null, message: null, appliedFiles: [], rejections: [], attemptedProtectedPaths: [], proposedPatchBytes: 0 };
}

function recordPatchOutcome(evidence: AgentSuccessPatchEvidenceV1, result: PatchApplicationResult, privateRoots: readonly string[]): void {
  evidence.outcome = result.outcome;
  switch (result.outcome) {
    case "parse-failure":
      evidence.code = result.code;
      break;
    case "policy-rejection":
      evidence.rejections = result.rejections.map((rejection) => ({ code: rejection.code, path: rejection.path ?? null }));
      evidence.attemptedProtectedPaths = [
        ...new Set(result.rejections.filter((rejection) => rejection.code === "PROTECTED_PATH" && rejection.path).map((rejection) => rejection.path as string))
      ].sort();
      break;
    case "git-check-failure":
    case "git-apply-failure":
      evidence.message = boundMessage(result.message, privateRoots);
      break;
    case "success":
      evidence.appliedFiles = result.files.map((file) => ({ path: file.path, status: file.status }));
      break;
  }
}

function isIndeterminate(result: { status: string }): boolean {
  return result.status === "timeout" || result.status === "error";
}

/**
 * Runs one case/treatment: independent sandbox, baseline verification, the task's deterministic fixture patch through
 * the Lab-owned pipeline, change capture, post-edit verification, protected-file integrity, and guarded cleanup.
 * Cleanup is attempted after every successfully created sandbox.
 */
export async function executeAgentSuccessTreatment(args: {
  task: AgentSuccessTaskV1;
  treatmentId: AgentSuccessRateTreatmentId;
  runId: string;
  canonicalProjectRoot: string;
  runtimeRoot: string;
  privateRoots: readonly string[];
  dependencies?: Partial<AgentSuccessRateDependencies>;
}): Promise<AgentSuccessTreatmentResult> {
  const deps = { ...defaultAgentSuccessRateDependencies, ...args.dependencies };
  const { task, treatmentId } = args;
  const privateRoots = [args.runtimeRoot, args.canonicalProjectRoot, ...args.privateRoots];
  const fixture = task.deterministicFixture;
  const sandboxId = deriveAgentSuccessSandboxId(args.runId, task.id, treatmentId);
  const started = Date.now();

  const evidence: AgentSuccessTreatmentEvidenceV1 = {
    treatmentId,
    status: "failed",
    availability: "infrastructure-failure",
    sandboxId,
    sandboxBaseline: null,
    baselineTextLineCount: null,
    baselineVerification: null,
    baselineAssessment: null,
    patch: emptyPatchEvidence(),
    change: null,
    postEditVerification: null,
    protectedIntegrity: { status: "unproven", mutatedPaths: [] },
    timing: { agentDurationMs: null, baselineVerificationDurationMs: null, patchPipelineDurationMs: null, postEditVerificationDurationMs: null, evaluationDurationMs: null },
    agentTokenUsage: null,
    cleanup: { attempted: false, removed: false, reason: null },
    proposedPatchPath: null,
    appliedPatchPath: null,
    errors: []
  };
  const patchFiles: AgentSuccessPatchFile[] = [];
  const addError = (code: string, message: string): void => {
    evidence.errors.push({ code, message: boundMessage(message, privateRoots) });
  };

  if (!fixture) {
    addError("FIXTURE_MISSING", `Task ${task.id} has no deterministicFixture.`);
    return { evidence, patchFiles };
  }

  let sandbox: BenchmarkSandbox;
  try {
    sandbox = await deps.createSandbox({ canonicalProjectRoot: args.canonicalProjectRoot, runtimeRoot: args.runtimeRoot, sandboxId });
  } catch (error) {
    addError(error instanceof BenchmarkSandboxError ? `SANDBOX_${error.code}` : "SANDBOX_CREATION_FAILED", error instanceof Error ? error.message : String(error));
    evidence.timing.evaluationDurationMs = Date.now() - started;
    return { evidence, patchFiles };
  }

  let changes: ChangeSetV1 | null = null;
  try {
    evidence.sandboxBaseline = { commit: sandbox.baseline.commit, fileCount: sandbox.baseline.fileCount, digest: sandbox.baseline.digest };
    evidence.baselineTextLineCount = await countBaselineTextLines(sandbox);

    const baselineStarted = Date.now();
    const baseline = await deps.runChecks({ sandbox, task, phase: "baseline" });
    evidence.timing.baselineVerificationDurationMs = Date.now() - baselineStarted;
    evidence.baselineVerification = summarizeVerification(baseline, privateRoots);
    const assessment = assessBaseline(baseline);
    evidence.baselineAssessment = { evaluable: assessment.evaluable, reasons: [...assessment.reasons] };

    if (!assessment.evaluable) {
      evidence.status = "skipped";
      evidence.availability = "baseline-invalid";
      evidence.protectedIntegrity = await evaluateProtectedIntegrity(sandbox, task, null);
    } else {
      const proposedPath = agentSuccessPatchArtifactPath(task.benchmarkProject, task.id, treatmentId, "proposed");
      patchFiles.push({ relativePath: proposedPath, content: fixture.patch });
      evidence.proposedPatchPath = proposedPath;
      evidence.patch.attempted = true;
      evidence.patch.proposedPatchBytes = Buffer.byteLength(fixture.patch, "utf8");

      const patchStarted = Date.now();
      const applied = await deps.applyPatch({ sandbox, rawProposal: fixture.patch, protectedFiles: task.protectedFiles });
      recordPatchOutcome(evidence.patch, applied, privateRoots);
      let captureFailed = false;
      if (applied.outcome === "success") {
        try {
          changes = await deps.captureChanges({ sandbox });
          evidence.change = summarizeChange(changes);
          const appliedPath = agentSuccessPatchArtifactPath(task.benchmarkProject, task.id, treatmentId, "applied");
          patchFiles.push({ relativePath: appliedPath, content: changes.diff });
          evidence.appliedPatchPath = appliedPath;
        } catch (error) {
          captureFailed = true;
          addError("CHANGE_CAPTURE_FAILED", error instanceof Error ? error.message : String(error));
        }
      }
      evidence.timing.patchPipelineDurationMs = Date.now() - patchStarted;

      let postIndeterminate = false;
      if (applied.outcome === "success") {
        const postStarted = Date.now();
        const post = await deps.runChecks({ sandbox, task, phase: "post-edit" });
        evidence.timing.postEditVerificationDurationMs = Date.now() - postStarted;
        evidence.postEditVerification = summarizeVerification(post, privateRoots);
        postIndeterminate = [...post.taskResults, ...post.regressionResults].some(isIndeterminate);
        if (postIndeterminate) addError("POST_EDIT_CHECK_INDETERMINATE", "At least one post-edit check timed out or errored.");
      }

      evidence.protectedIntegrity = await evaluateProtectedIntegrity(sandbox, task, changes);
      if (evidence.protectedIntegrity.status === "unproven") addError("PROTECTED_INTEGRITY_UNPROVEN", "Protected-file integrity could not be proven.");

      const complete = !captureFailed && !postIndeterminate && evidence.protectedIntegrity.status !== "unproven";
      evidence.status = complete ? "completed" : "partial";
      evidence.availability = complete ? "complete" : "incomplete";
    }
  } catch (error) {
    evidence.status = "failed";
    evidence.availability = "infrastructure-failure";
    addError("EXECUTION_FAILED", error instanceof Error ? error.message : String(error));
  } finally {
    evidence.timing.evaluationDurationMs = Date.now() - started;
    evidence.cleanup.attempted = true;
    try {
      const removal = await deps.removeSandbox({ runtimeRoot: args.runtimeRoot, sandboxId });
      evidence.cleanup.removed = removal.removed;
      if (!removal.removed) evidence.cleanup.reason = boundMessage(removal.reason, privateRoots);
    } catch (error) {
      evidence.cleanup.removed = false;
      evidence.cleanup.reason = boundMessage(error instanceof Error ? error.message : String(error), privateRoots);
    }
    if (!evidence.cleanup.removed) {
      addError("CLEANUP_FAILED", evidence.cleanup.reason ?? "sandbox cleanup failed.");
      if (evidence.status === "completed") {
        evidence.status = "partial";
        evidence.availability = "incomplete";
      }
    }
  }
  return { evidence, patchFiles };
}

export type AgentSuccessCaseResult = { evidence: AgentSuccessCaseEvidenceV1; patchFiles: AgentSuccessPatchFile[] };

/** Executes both mandatory treatments, in fixed order, each in its own sandbox. */
export async function executeAgentSuccessCase(args: {
  task: AgentSuccessTaskV1;
  runId: string;
  canonicalProjectRoot: string;
  runtimeRoot: string;
  privateRoots: readonly string[];
  dependencies?: Partial<AgentSuccessRateDependencies>;
}): Promise<AgentSuccessCaseResult> {
  const treatments: AgentSuccessTreatmentEvidenceV1[] = [];
  const patchFiles: AgentSuccessPatchFile[] = [];
  for (const treatmentId of AGENT_SUCCESS_RATE_TREATMENT_IDS) {
    const result = await executeAgentSuccessTreatment({ ...args, treatmentId });
    treatments.push(result.evidence);
    patchFiles.push(...result.patchFiles);
  }
  return {
    evidence: {
      caseId: args.task.id,
      caseName: args.task.title,
      benchmarkProject: args.task.benchmarkProject,
      taskLocality: args.task.taskLocality,
      fixtureId: args.task.deterministicFixture?.id ?? "",
      treatments
    },
    patchFiles
  };
}

