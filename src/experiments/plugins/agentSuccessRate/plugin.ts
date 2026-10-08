import { access, mkdir, rm, rmdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { resolveWithinRoot } from "../../../core/pathSafety.js";
import { summarizeExperimentRun } from "../../results.js";
import type { ExperimentCase, ExperimentOutcome, ExperimentPlugin, ExperimentRun, ExperimentRunStatus } from "../../types.js";
import { analyzeAgentSuccessRate } from "./analysis.js";
import {
  AGENT_SUCCESS_RATE_ANALYSIS_ARTIFACT_FILE,
  buildAgentSuccessRateAnalysisArtifact,
  validateAgentSuccessRateAnalysisArtifact,
  validateAgentSuccessRateArtifactFamily
} from "./analysisArtifact.js";
import type { AgentSuccessRateAnalysisV1, AgentSuccessTreatmentAnalysisV1 } from "./analysisTypes.js";
import { agentSuccessRateConfigDefinition, defaultAgentSuccessRateConfig, validateAgentSuccessRateConfig, type AgentSuccessRateConfig } from "./config.js";
import {
  AGENT_SUCCESS_RATE_SELF_ONLY_MESSAGE,
  AgentSuccessRateInputError,
  executeAgentSuccessCase,
  readAgentSuccessTasksInput,
  resolveControlledBenchmarkProject,
  resolveSandboxRuntimeRoot,
  selectAgentSuccessTasks,
  type AgentSuccessRateDependencies
} from "./execution.js";
import { AGENT_SUCCESS_RATE_EXECUTION_ARTIFACT_FILE, buildAgentSuccessRateExecutionArtifact, validateAgentSuccessRateExecutionArtifact } from "./executionArtifact.js";
import type { AgentSuccessCaseEvidenceV1, AgentSuccessPatchFile, AgentSuccessTreatmentEvidenceV1 } from "./executionTypes.js";
import { AGENT_SUCCESS_RATE_PLUGIN_ID, AGENT_SUCCESS_RATE_VARIANTS, agentSuccessRateMetadata } from "./metadata.js";
import { toAgentSuccessOutcomeMetrics, toAgentSuccessRunMetrics } from "./metrics.js";

export const AGENT_SUCCESS_RATE_PERSISTENCE_FAILURE_MESSAGE = "Agent success rate artifact persistence failed.";
export const AGENT_SUCCESS_RATE_ARTIFACT_STATE_MESSAGE = "Agent success rate artifact state was inconsistent; nothing was written.";

/** Filesystem seam so tests can prove write order and failure behavior. Production uses the real filesystem. */
export type AgentSuccessRateArtifactIo = {
  ensureDirectory(directory: string): Promise<void>;
  exists(filePath: string): Promise<boolean>;
  writeFile(filePath: string, content: string): Promise<void>;
  removeFile(filePath: string): Promise<void>;
};

const defaultArtifactIo: AgentSuccessRateArtifactIo = {
  ensureDirectory: async (directory) => {
    await mkdir(directory, { recursive: true });
  },
  exists: async (filePath) => {
    try {
      await access(filePath);
      return true;
    } catch {
      return false;
    }
  },
  writeFile: (filePath, content) => writeFile(filePath, content, "utf8"),
  removeFile: (filePath) => rm(filePath, { force: true })
};

/** Carries only bounded, source-free and patch-free evidence. */
export type AgentSuccessRateRun = ExperimentRun & {
  caseExecutionEvidence: AgentSuccessCaseEvidenceV1[];
  analysis: AgentSuccessRateAnalysisV1;
};

export const agentSuccessRatePlugin: ExperimentPlugin<AgentSuccessRateConfig, AgentSuccessRateRun> = {
  metadata: agentSuccessRateMetadata,
  defaultConfig: defaultAgentSuccessRateConfig,
  configDefinition: agentSuccessRateConfigDefinition,
  supportedVariants: AGENT_SUCCESS_RATE_VARIANTS.map((variant) => variant.id),
  validateConfig: validateAgentSuccessRateConfig,
  async run(context) {
    const startedAt = context.startedAt.toISOString();
    // The runner does not enforce supportedTargets; refuse before any filesystem mutation.
    if (context.target.kind !== "self" || context.target.isSelf !== true) {
      throw new AgentSuccessRateInputError(AGENT_SUCCESS_RATE_SELF_ONLY_MESSAGE);
    }
    const inputs = context.inputs;
    // Fail closed on inputs and project resolution before any sandbox exists.
    const tasks = selectAgentSuccessTasks(readAgentSuccessTasksInput(inputs), context.config);
    const projectRoots = new Map<string, string>();
    for (const task of tasks) {
      if (!projectRoots.has(task.benchmarkProject)) projectRoots.set(task.benchmarkProject, await resolveControlledBenchmarkProject(context.toolRoot, task.benchmarkProject));
    }
    const outDir = path.resolve(context.outputRoot ?? path.resolve(context.toolRoot, context.config.outDir));
    const runtimeRoot = await resolveSandboxRuntimeRoot(outDir, context.toolRoot);
    const io = readArtifactIo(inputs);
    const dependencies = readDependenciesInput(inputs);

    await io.ensureDirectory(outDir);
    const runtimeRootExisted = await io.exists(runtimeRoot);
    const caseEvidence: AgentSuccessCaseEvidenceV1[] = [];
    const patchFiles: AgentSuccessPatchFile[] = [];
    try {
      for (const task of tasks) {
        const result = await executeAgentSuccessCase({
          task,
          runId: context.runId,
          canonicalProjectRoot: projectRoots.get(task.benchmarkProject)!,
          runtimeRoot,
          privateRoots: [outDir, context.toolRoot],
          dependencies
        });
        caseEvidence.push(result.evidence);
        patchFiles.push(...result.patchFiles);
      }
    } finally {
      // Only an empty runtime root this run created is removed; rmdir refuses a non-empty directory.
      if (!runtimeRootExisted) await rmdir(runtimeRoot).catch(() => undefined);
    }

    // Scientific analysis is calculated once, in memory, before persistence; reports never recalculate it.
    const analysis = analyzeAgentSuccessRate(tasks, caseEvidence);
    const completedAt = new Date().toISOString();
    const common = { runId: context.runId, pluginId: AGENT_SUCCESS_RATE_PLUGIN_ID, pluginSchemaVersion: agentSuccessRateMetadata.schemaVersion, startedAt, completedAt };
    const executionArtifact = buildAgentSuccessRateExecutionArtifact({ ...common, cases: caseEvidence });
    const analysisArtifact = buildAgentSuccessRateAnalysisArtifact({ ...common, analysis });
    const problems = [
      ...validateAgentSuccessRateExecutionArtifact(executionArtifact),
      ...validateAgentSuccessRateAnalysisArtifact(analysisArtifact),
      ...validateAgentSuccessRateArtifactFamily(executionArtifact, analysisArtifact),
      ...validatePatchFiles(caseEvidence, patchFiles)
    ];
    if (problems.length > 0) throw new Error(AGENT_SUCCESS_RATE_ARTIFACT_STATE_MESSAGE);

    // Patch artifacts, then execution, then analysis last. Pre-existing files are never overwritten.
    const targets = [
      ...patchFiles.map((file) => ({ filePath: resolveWithinRoot(outDir, file.relativePath), content: file.content })),
      { filePath: resolveWithinRoot(outDir, AGENT_SUCCESS_RATE_EXECUTION_ARTIFACT_FILE), content: `${JSON.stringify(executionArtifact, null, 2)}\n` },
      { filePath: resolveWithinRoot(outDir, AGENT_SUCCESS_RATE_ANALYSIS_ARTIFACT_FILE), content: `${JSON.stringify(analysisArtifact, null, 2)}\n` }
    ];
    for (const target of targets) {
      if (await io.exists(target.filePath)) throw new Error(AGENT_SUCCESS_RATE_PERSISTENCE_FAILURE_MESSAGE);
    }
    const created: string[] = [];
    try {
      for (const target of targets) {
        await io.ensureDirectory(path.dirname(target.filePath));
        await io.writeFile(target.filePath, target.content);
        created.push(target.filePath);
      }
    } catch {
      // Remove only files this attempt created; never touch anything else.
      for (const filePath of created.reverse()) {
        try {
          await io.removeFile(filePath);
        } catch {
          // best effort: the failure below is the outcome
        }
      }
      throw new Error(AGENT_SUCCESS_RATE_PERSISTENCE_FAILURE_MESSAGE);
    }

    return mapAgentSuccessRateToRun({
      runId: context.runId,
      startedAt,
      completedAt,
      target: context.target,
      caseEvidence,
      analysis,
      patchArtifactPaths: patchFiles.map((file) => file.relativePath)
    });
  },
  summarize(result) {
    return result.summary ?? summarizeExperimentRun(result);
  }
};

/** Every patch artifact must be promised by exactly one treatment's evidence, and vice versa. */
function validatePatchFiles(caseEvidence: readonly AgentSuccessCaseEvidenceV1[], patchFiles: readonly AgentSuccessPatchFile[]): string[] {
  const problems: string[] = [];
  const promised = caseEvidence.flatMap((entry) => entry.treatments.flatMap((t) => [t.proposedPatchPath, t.appliedPatchPath])).filter((p): p is string => p !== null);
  const produced = patchFiles.map((file) => file.relativePath);
  if (new Set(produced).size !== produced.length) problems.push("duplicate patch artifact path.");
  if ([...promised].sort().join("\n") !== [...produced].sort().join("\n")) problems.push("patch artifacts do not match the paths promised by execution evidence.");
  return problems;
}

export function mapAgentSuccessRateToRun(args: {
  runId: string;
  startedAt: string;
  completedAt: string;
  target: ExperimentRun["target"];
  caseEvidence: readonly AgentSuccessCaseEvidenceV1[];
  analysis: AgentSuccessRateAnalysisV1;
  patchArtifactPaths: readonly string[];
}): AgentSuccessRateRun {
  const patchOwner = new Map<string, { caseId: string; variantId: string }>();
  for (const entry of args.caseEvidence) {
    for (const t of entry.treatments) {
      for (const p of [t.proposedPatchPath, t.appliedPatchPath]) if (p) patchOwner.set(p, { caseId: entry.caseId, variantId: t.treatmentId });
    }
  }
  const cases: ExperimentCase[] = args.caseEvidence.map((entry, caseIndex) => ({
    id: entry.caseId,
    name: entry.caseName,
    outcomes: entry.treatments.map((treatment, treatmentIndex) => buildOutcome(entry, treatment, args.analysis.cases[caseIndex]!.treatments[treatmentIndex]!)),
    metadata: { benchmarkProject: entry.benchmarkProject, taskLocality: entry.taskLocality, fixtureId: entry.fixtureId }
  }));
  const run: AgentSuccessRateRun = {
    runId: args.runId,
    pluginId: AGENT_SUCCESS_RATE_PLUGIN_ID,
    startedAt: args.startedAt,
    completedAt: args.completedAt,
    status: aggregateTreatmentStatus(args.caseEvidence.flatMap((entry) => entry.treatments.map((treatment) => treatment.status))),
    target: args.target,
    variants: AGENT_SUCCESS_RATE_VARIANTS.map((variant) => ({ ...variant })),
    cases,
    metrics: toAgentSuccessRunMetrics(args.analysis),
    artifacts: [
      {
        id: "agent-success-rate-execution",
        label: "Agent success rate execution evidence",
        path: AGENT_SUCCESS_RATE_EXECUTION_ARTIFACT_FILE,
        kind: "artifact",
        mimeType: "application/json",
        description: "Per-case, per-treatment execution evidence without source text, patch bodies or raw command output."
      },
      {
        id: "agent-success-rate-analysis",
        label: "Agent success rate scientific analysis",
        path: AGENT_SUCCESS_RATE_ANALYSIS_ARTIFACT_FILE,
        kind: "artifact",
        mimeType: "application/json",
        description: "Task-success, edit-quality and blast-radius metrics with explicit availability, plus matched-case aggregates."
      },
      ...args.patchArtifactPaths.map((patchPath) => ({
        id: `patch:${patchPath}`,
        label: patchPath.endsWith("-applied.patch") ? "Applied patch (from change evidence)" : "Proposed deterministic fixture patch",
        path: patchPath,
        kind: "artifact" as const,
        mimeType: "text/x-diff",
        ...patchOwner.get(patchPath)
      }))
    ],
    warnings: [],
    // Outcome failures are the authoritative per-treatment failure location.
    failures: [],
    metadata: {
      executionMode: args.analysis.executionMode,
      contextEffectEvaluated: false,
      executionArtifactPath: AGENT_SUCCESS_RATE_EXECUTION_ARTIFACT_FILE,
      analysisArtifactPath: AGENT_SUCCESS_RATE_ANALYSIS_ARTIFACT_FILE
    },
    caseExecutionEvidence: structuredClone(args.caseEvidence) as AgentSuccessCaseEvidenceV1[],
    analysis: structuredClone(args.analysis)
  };
  run.summary = summarizeExperimentRun(run);
  return run;
}

function buildOutcome(caseEvidence: AgentSuccessCaseEvidenceV1, treatment: AgentSuccessTreatmentEvidenceV1, treatmentAnalysis: AgentSuccessTreatmentAnalysisV1): ExperimentOutcome {
  const { caseId } = caseEvidence;
  const { treatmentId } = treatment;
  const success = treatmentAnalysis.metrics.taskSuccess;
  return {
    id: `${caseId}:${treatmentId}`,
    caseId,
    variantId: treatmentId,
    status: treatment.status,
    metrics: toAgentSuccessOutcomeMetrics(treatmentAnalysis),
    artifacts: [],
    warnings:
      treatment.availability === "baseline-invalid"
        ? [
            {
              code: "baseline-invalid",
              message: "The benchmark baseline is not evaluable; no implementation attempt was scored.",
              variantId: treatmentId,
              caseId,
              details: { reasons: treatment.baselineAssessment?.reasons ?? [] }
            }
          ]
        : [],
    failures: treatment.errors.map((error) => ({ code: error.code, message: error.message, variantId: treatmentId, caseId, recoverable: false })),
    metadata: {
      evidenceAvailability: treatment.availability,
      // taskSuccess is a measurement, not an infrastructure status; null means it could not be determined.
      taskSuccess: success.availability === "available" ? (success.value as boolean) : null,
      executionMode: "deterministic-fixture",
      contextEffectEvaluated: false
    }
  };
}

function aggregateTreatmentStatus(statuses: readonly ExperimentRunStatus[]): ExperimentRunStatus {
  if (statuses.length === 0) return "skipped";
  if (statuses.every((status) => status === "completed")) return "completed";
  if (statuses.every((status) => status === "skipped")) return "skipped";
  if (statuses.every((status) => status === "failed")) return "failed";
  return "partial";
}

function readDependenciesInput(inputs: Record<string, unknown> | undefined): Partial<AgentSuccessRateDependencies> | undefined {
  const value = inputs?.agentSuccessDependencies;
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Partial<AgentSuccessRateDependencies>) : undefined;
}

function readArtifactIo(inputs: Record<string, unknown> | undefined): AgentSuccessRateArtifactIo {
  const value = inputs?.agentSuccessArtifactIo;
  return value && typeof value === "object" && !Array.isArray(value) ? { ...defaultArtifactIo, ...(value as Partial<AgentSuccessRateArtifactIo>) } : defaultArtifactIo;
}
