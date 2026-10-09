import { access, mkdir, readFile, rm, rmdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { runAgentPrompt } from "../../../agents/index.js";
import { runMeasuredCommand } from "../../../core/runMeasuredCommand.js";
import { resolveWithinRoot } from "../../../core/pathSafety.js";
import type { AgentSuccessTaskV1 } from "../../../evaluation/agentSuccess/index.js";
import { buildMyDevKitIndex, probeMyDevKitVersion } from "../../../evaluation/runMyDevKitRetrieval.js";
import { summarizeExperimentRun } from "../../results.js";
import type { ExperimentCase, ExperimentOutcome, ExperimentPlugin, ExperimentRun, ExperimentRunStatus } from "../../types.js";
import { analyzeAgentSuccessRate } from "./analysis.js";
import { projectAgentFacingTask } from "./agentTaskProjection.js";
import {
  AGENT_SUCCESS_RATE_ANALYSIS_ARTIFACT_FILE,
  buildAgentSuccessRateAnalysisArtifact,
  validateAgentSuccessRateAnalysisArtifact,
  validateAgentSuccessRateArtifactFamily
} from "./analysisArtifact.js";
import type { AgentSuccessRateAnalysisV1, AgentSuccessTreatmentAnalysisV1 } from "./analysisTypes.js";
import { agentSuccessRateConfigDefinition, defaultAgentSuccessRateConfig, validateAgentSuccessRateConfig, type AgentSuccessRateConfig } from "./config.js";
import {
  AgentSuccessPackContextBuilder,
  DEFAULT_AGENT_SUCCESS_KIT_COMMAND,
  buildContextTaskInput,
  buildRawFullFileContext,
  collectForbiddenAgentValues,
  type AgentSuccessContextDependencies,
  type ForbiddenAgentValue
} from "./contextGeneration.js";
import {
  AGENT_SUCCESS_RATE_SELF_ONLY_MESSAGE,
  AgentSuccessRateInputError,
  boundMessage,
  executeAgentSuccessCase,
  readAgentSuccessTasksInput,
  resolveControlledBenchmarkProject,
  resolveSandboxRuntimeRoot,
  selectAgentSuccessTasks,
  type AgentSuccessRateDependencies
} from "./execution.js";
import { AGENT_SUCCESS_RATE_EXECUTION_ARTIFACT_FILE, buildAgentSuccessRateExecutionArtifact, validateAgentSuccessRateExecutionArtifact } from "./executionArtifact.js";
import type { AgentSuccessCaseEvidenceV1, AgentSuccessPatchFile, AgentSuccessRealAgentProviderId, AgentSuccessTreatmentEvidenceV1 } from "./executionTypes.js";
import { attemptEvidenceOf } from "./attemptEvidence.js";
import { executeAgentSuccessRepairCase } from "./repairExecution.js";
import {
  AGENT_SUCCESS_RATE_EXECUTION_MODE,
  AGENT_SUCCESS_RATE_PLUGIN_ID,
  AGENT_SUCCESS_RATE_REAL_AGENT_EXECUTION_MODE,
  AGENT_SUCCESS_RATE_VARIANTS,
  agentSuccessRateMetadata,
  type AgentSuccessExecutionMode
} from "./metadata.js";
import { toAgentSuccessOutcomeMetrics, toAgentSuccessRunMetrics } from "./metrics.js";
import {
  AGENT_SUCCESS_RATE_DEFAULT_AGENT_TIMEOUT_MS,
  createRealAgentProposalSource,
  type AgentSuccessRealAgentSettings,
  type AgentSuccessRunAgent
} from "./realAgentExecution.js";

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
    const real = readRealAgentConfig(context.config);
    const loadedTasks = selectAgentSuccessTasks(readAgentSuccessTasksInput(inputs, { requireFixture: real === null }), context.config);
    // Real-agent mode seals each task: the fixture is captured only as a leak-guard value and then removed, so nothing
    // downstream can read the reference patch.
    const forbiddenByTask = new Map<string, ForbiddenAgentValue[]>();
    const tasks: AgentSuccessTaskV1[] = real === null ? loadedTasks : loadedTasks.map((task) => sealTask(task, forbiddenByTask));
    const executionMode: AgentSuccessExecutionMode = real === null ? AGENT_SUCCESS_RATE_EXECUTION_MODE : AGENT_SUCCESS_RATE_REAL_AGENT_EXECUTION_MODE;
    const projectRoots = new Map<string, string>();
    for (const task of tasks) {
      if (!projectRoots.has(task.benchmarkProject)) projectRoots.set(task.benchmarkProject, await resolveControlledBenchmarkProject(context.toolRoot, task.benchmarkProject));
    }
    const outDir = path.resolve(context.outputRoot ?? path.resolve(context.toolRoot, context.config.outDir));
    const runtimeRoot = await resolveSandboxRuntimeRoot(outDir, context.toolRoot);
    const io = readArtifactIo(inputs);
    const removeAttemptDirectory = readRemoveAttemptDirectoryInput(inputs);
    const dependencies = readDependenciesInput(inputs);

    await io.ensureDirectory(outDir);
    const runtimeRootExisted = await io.exists(runtimeRoot);
    const caseEvidence: AgentSuccessCaseEvidenceV1[] = [];
    const patchFiles: AgentSuccessPatchFile[] = [];
    const contextFiles: AgentSuccessPatchFile[] = [];
    const warnings: ExperimentRun["warnings"] = [];
    const packBuilder =
      real === null
        ? null
        : new AgentSuccessPackContextBuilder(real.kitCommand, { ...defaultContextDependencies(), ...readContextDependenciesInput(inputs) });
    const settings: AgentSuccessRealAgentSettings | null =
      real === null
        ? null
        : {
            providerId: real.providerId,
            timeoutMs: real.timeoutMs,
            env: readAgentEnvInput(inputs),
            runAgent: readRunAgentInput(inputs),
            outDir,
            protectedRoots: [context.toolRoot, outDir, runtimeRoot, packageRoot(), ...projectRoots.values()],
            privateRoots: [outDir, context.toolRoot],
            ...readRemoveDirectoryInput(inputs)
          };
    try {
      for (const task of tasks) {
        const canonicalProjectRoot = projectRoots.get(task.benchmarkProject)!;
        let repairContexts: Parameters<typeof createRealAgentProposalSource>[0]["contexts"] | null = null;
        if (real !== null && settings !== null && packBuilder !== null) {
          // Both treatment contexts come from the same clean canonical project state, before any sandbox exists.
          const contextInput = buildContextTaskInput(task);
          const contexts = {
            "raw-full-file": await buildRawFullFileContext(contextInput, canonicalProjectRoot),
            "context-pack": await packBuilder.build(contextInput, canonicalProjectRoot)
          };
          repairContexts = contexts;
        }
        const result =
          real !== null && settings !== null && repairContexts !== null
            ? await executeAgentSuccessRepairCase({
                task,
                runId: context.runId,
                canonicalProjectRoot,
                runtimeRoot,
                privateRoots: [outDir, context.toolRoot],
                dependencies,
                // Each attempt is built from the same public task, the same original treatment context and (for repairs)
                // only the harness-authored feedback about the previous attempt.
                repairFor: () => ({
                  providerId: real.providerId,
                  repairAttempts: real.repairAttempts,
                  createProposalSource: ({ attemptNumber, feedback }) =>
                    createRealAgentProposalSource({
                      settings,
                      runId: context.runId,
                      task: projectAgentFacingTask(task),
                      contexts: repairContexts!,
                      forbidden: forbiddenByTask.get(task.id) ?? [],
                      attemptNumber,
                      ...(feedback ? { repair: { feedback, maxAttempts: 1 + real.repairAttempts } } : {})
                    })
                })
              })
            : await executeAgentSuccessCase({
                task,
                runId: context.runId,
                canonicalProjectRoot,
                runtimeRoot,
                privateRoots: [outDir, context.toolRoot],
                dependencies
              });
        caseEvidence.push(result.evidence);
        patchFiles.push(...result.patchFiles);
        contextFiles.push(...result.contextFiles);
      }
    } finally {
      // Only an empty runtime root this run created is removed; rmdir refuses a non-empty directory.
      if (!runtimeRootExisted) {
        // rmdir refuses a non-empty directory, so a leftover sandbox keeps the root; that is reported, never hidden.
        await rmdir(runtimeRoot).catch((error: unknown) => {
          warnings.push({ code: "sandbox-runtime-root-not-removed", message: boundMessage(`The sandbox runtime root could not be removed: ${error instanceof Error ? error.message : String(error)}`, [outDir, context.toolRoot]) });
        });
      }
      const disposeReason = packBuilder === null ? null : await packBuilder.dispose();
      if (disposeReason !== null) warnings.push({ code: "context-work-directory-not-removed", message: disposeReason });
    }

    // Scientific analysis is calculated once, in memory, before persistence; reports never recalculate it.
    const analysis = analyzeAgentSuccessRate(tasks, caseEvidence, executionMode);
    const completedAt = new Date().toISOString();
    const common = { runId: context.runId, pluginId: AGENT_SUCCESS_RATE_PLUGIN_ID, pluginSchemaVersion: agentSuccessRateMetadata.schemaVersion, startedAt, completedAt };
    const executionArtifact = buildAgentSuccessRateExecutionArtifact({
      ...common,
      cases: caseEvidence,
      realAgent:
        real === null
          ? undefined
          : {
              providerId: real.providerId,
              timeoutMs: real.timeoutMs,
              attemptsPerTreatment: (1 + real.repairAttempts) as 1 | 2 | 3,
              repairAttempts: real.repairAttempts as 0 | 1 | 2,
              promptTransport: "stdin",
              contextEffectEvaluated: analysis.contextEffectEvaluated
            }
    });
    const analysisArtifact = buildAgentSuccessRateAnalysisArtifact({ ...common, analysis });
    const problems = [
      ...validateAgentSuccessRateExecutionArtifact(executionArtifact),
      ...validateAgentSuccessRateAnalysisArtifact(analysisArtifact),
      ...validateAgentSuccessRateArtifactFamily(executionArtifact, analysisArtifact),
      ...validatePatchFiles(caseEvidence, patchFiles),
      ...validateContextFiles(caseEvidence, contextFiles),
      ...(await validateAgentArtifacts(caseEvidence, outDir, io))
    ];
    if (problems.length > 0) {
      throw new Error(AGENT_SUCCESS_RATE_ARTIFACT_STATE_MESSAGE + (await removeAgentAttemptDirectories(caseEvidence, outDir, removeAttemptDirectory)));
    }

    // Context and patch artifacts, then execution, then analysis last. Pre-existing files are never overwritten.
    const targets = [
      ...contextFiles.map((file) => ({ filePath: resolveWithinRoot(outDir, file.relativePath), content: file.content })),
      ...patchFiles.map((file) => ({ filePath: resolveWithinRoot(outDir, file.relativePath), content: file.content })),
      { filePath: resolveWithinRoot(outDir, AGENT_SUCCESS_RATE_EXECUTION_ARTIFACT_FILE), content: `${JSON.stringify(executionArtifact, null, 2)}\n` },
      { filePath: resolveWithinRoot(outDir, AGENT_SUCCESS_RATE_ANALYSIS_ARTIFACT_FILE), content: `${JSON.stringify(analysisArtifact, null, 2)}\n` }
    ];
    for (const target of targets) {
      if (await io.exists(target.filePath)) {
        throw new Error(AGENT_SUCCESS_RATE_PERSISTENCE_FAILURE_MESSAGE + (await removeAgentAttemptDirectories(caseEvidence, outDir, removeAttemptDirectory)));
      }
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
      throw new Error(AGENT_SUCCESS_RATE_PERSISTENCE_FAILURE_MESSAGE + (await removeAgentAttemptDirectories(caseEvidence, outDir, removeAttemptDirectory)));
    }

    return mapAgentSuccessRateToRun({
      runId: context.runId,
      startedAt,
      completedAt,
      target: context.target,
      caseEvidence,
      analysis,
      patchArtifactPaths: patchFiles.map((file) => file.relativePath),
      contextArtifactPaths: contextFiles.map((file) => file.relativePath),
      providerId: real?.providerId ?? null,
      realSettings: real === null ? undefined : { timeoutMs: real.timeoutMs, repairAttempts: real.repairAttempts },
      warnings
    });
  },
  summarize(result) {
    return result.summary ?? summarizeExperimentRun(result);
  }
};

/** Every patch artifact must be promised by exactly one treatment's evidence, and vice versa. */
function validatePatchFiles(caseEvidence: readonly AgentSuccessCaseEvidenceV1[], patchFiles: readonly AgentSuccessPatchFile[]): string[] {
  const problems: string[] = [];
  const promised = caseEvidence
    .flatMap((entry) => entry.treatments.flatMap((t) => attemptEvidenceOf(t).flatMap((attempt) => [attempt.proposedPatchPath, attempt.appliedPatchPath])))
    .filter((p): p is string => p !== null);
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
  contextArtifactPaths?: readonly string[];
  providerId?: AgentSuccessRealAgentProviderId | null;
  realSettings?: { timeoutMs: number; repairAttempts: number };
  warnings?: ExperimentRun["warnings"];
}): AgentSuccessRateRun {
  const realMode = args.analysis.executionMode === AGENT_SUCCESS_RATE_REAL_AGENT_EXECUTION_MODE;
  const patchOwner = new Map<string, { caseId: string; variantId: string }>();
  for (const entry of args.caseEvidence) {
    for (const t of entry.treatments) {
      for (const attempt of attemptEvidenceOf(t)) {
        for (const p of [attempt.proposedPatchPath, attempt.appliedPatchPath]) if (p) patchOwner.set(p, { caseId: entry.caseId, variantId: t.treatmentId });
      }
    }
  }
  const cases: ExperimentCase[] = args.caseEvidence.map((entry, caseIndex) => ({
    id: entry.caseId,
    name: entry.caseName,
    outcomes: entry.treatments.map((treatment, treatmentIndex) =>
      buildOutcome(entry, treatment, args.analysis.cases[caseIndex]!.treatments[treatmentIndex]!, args.analysis.executionMode, args.analysis.contextEffectEvaluated)
    ),
    metadata: { benchmarkProject: entry.benchmarkProject, taskLocality: entry.taskLocality, ...(realMode ? {} : { fixtureId: entry.fixtureId }) }
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
      ...(args.contextArtifactPaths ?? []).map((contextPath) => ({
        id: `context:${contextPath}`,
        label: "Treatment source context supplied to the provider",
        path: contextPath,
        kind: "artifact" as const,
        mimeType: "text/plain"
      })),
      ...args.patchArtifactPaths.map((patchPath) => ({
        id: `patch:${patchPath}`,
        label: patchLabel(patchPath, realMode),
        path: patchPath,
        kind: "artifact" as const,
        mimeType: "text/x-diff",
        ...patchOwner.get(patchPath)
      }))
    ],
    warnings: [...(args.warnings ?? [])],
    // Outcome failures are the authoritative per-treatment failure location.
    failures: [],
    metadata: {
      executionMode: args.analysis.executionMode,
      ...(args.providerId ? { providerId: args.providerId } : {}),
      ...(args.realSettings ? { timeoutMs: args.realSettings.timeoutMs, repairAttempts: args.realSettings.repairAttempts } : {}),
      contextEffectEvaluated: args.analysis.contextEffectEvaluated,
      executionArtifactPath: AGENT_SUCCESS_RATE_EXECUTION_ARTIFACT_FILE,
      analysisArtifactPath: AGENT_SUCCESS_RATE_ANALYSIS_ARTIFACT_FILE
    },
    caseExecutionEvidence: structuredClone(args.caseEvidence) as AgentSuccessCaseEvidenceV1[],
    analysis: structuredClone(args.analysis)
  };
  run.summary = summarizeExperimentRun(run);
  return run;
}

function buildOutcome(
  caseEvidence: AgentSuccessCaseEvidenceV1,
  treatment: AgentSuccessTreatmentEvidenceV1,
  treatmentAnalysis: AgentSuccessTreatmentAnalysisV1,
  executionMode: AgentSuccessExecutionMode,
  contextEffectEvaluated: boolean
): ExperimentOutcome {
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
      executionMode,
      ...(treatment.realAgent ? { providerId: treatment.realAgent.providerId, providerStatus: treatment.realAgent.providerStatus } : {}),
      ...(treatmentAnalysis.repair
        ? {
            attemptCount: treatmentAnalysis.repair.attemptCount,
            repairAttemptCount: treatmentAnalysis.repair.repairAttemptCount,
            initialAttemptTaskSuccess: treatmentAnalysis.repair.initialAttemptTaskSuccess.availability === "available" ? (treatmentAnalysis.repair.initialAttemptTaskSuccess.value as boolean) : null,
            repairSucceeded: treatmentAnalysis.repair.repairSucceeded.availability === "available" ? (treatmentAnalysis.repair.repairSucceeded.value as boolean) : null
          }
        : {}),
      contextEffectEvaluated
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

// ---------------------------------------------------------------------------------------------------------------
// Real-agent helpers
// ---------------------------------------------------------------------------------------------------------------

type RealAgentRunConfig = { providerId: AgentSuccessRealAgentProviderId; timeoutMs: number; kitCommand: string; repairAttempts: number };

/** Real-agent mode exists only when a provider is named; the closed config validator has already enforced the opt-in. */
function readRealAgentConfig(config: AgentSuccessRateConfig): RealAgentRunConfig | null {
  if (config.agentId === undefined) return null;
  return {
    providerId: config.agentId,
    timeoutMs: config.timeoutMs ?? AGENT_SUCCESS_RATE_DEFAULT_AGENT_TIMEOUT_MS,
    kitCommand: config.kitCommand ?? DEFAULT_AGENT_SUCCESS_KIT_COMMAND,
    repairAttempts: config.repairAttempts ?? 0
  };
}

/** Captures hidden values for the leak guard, then returns a copy of the task with the reference fixture removed. */
function sealTask(task: AgentSuccessTaskV1, forbiddenByTask: Map<string, ForbiddenAgentValue[]>): AgentSuccessTaskV1 {
  forbiddenByTask.set(task.id, collectForbiddenAgentValues(task));
  const sealed: AgentSuccessTaskV1 = { ...task };
  delete sealed.deterministicFixture;
  return sealed;
}

/** The installed package root (two levels above src/ or dist/ output of this module). */
function packageRoot(): string {
  return fileURLToPath(new URL("../../../../", import.meta.url));
}

function defaultContextDependencies(): AgentSuccessContextDependencies {
  return {
    buildIndex: buildMyDevKitIndex,
    runCommand: runMeasuredCommand,
    readSymbolIndex: async (indexDir) => JSON.parse(await readFile(path.join(indexDir, "symbol-index.json"), "utf8")) as unknown,
    probeVersion: probeMyDevKitVersion
  };
}

function readContextDependenciesInput(inputs: Record<string, unknown> | undefined): Partial<AgentSuccessContextDependencies> {
  const value = inputs?.agentSuccessContextDependencies;
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Partial<AgentSuccessContextDependencies>) : {};
}

function readRunAgentInput(inputs: Record<string, unknown> | undefined): AgentSuccessRunAgent {
  const value = inputs?.agentSuccessRunAgent;
  return typeof value === "function" ? (value as AgentSuccessRunAgent) : runAgentPrompt;
}

function readAgentEnvInput(inputs: Record<string, unknown> | undefined): NodeJS.ProcessEnv | undefined {
  const value = inputs?.agentSuccessAgentEnv;
  return value && typeof value === "object" && !Array.isArray(value) ? (value as NodeJS.ProcessEnv) : undefined;
}

/** Every context artifact must be promised by exactly one treatment's evidence, and vice versa. */
function validateContextFiles(caseEvidence: readonly AgentSuccessCaseEvidenceV1[], contextFiles: readonly AgentSuccessPatchFile[]): string[] {
  // The treatment context is persisted once, by the initial attempt, and repairs reuse it unchanged.
  const promised = caseEvidence.flatMap((entry) => entry.treatments.map((t) => attemptEvidenceOf(t)[0]?.realAgent?.context.contextArtifactPath ?? null)).filter((p): p is string => p !== null);
  const produced = contextFiles.map((file) => file.relativePath);
  const problems: string[] = [];
  if (new Set(produced).size !== produced.length) problems.push("duplicate context artifact path.");
  if ([...promised].sort().join("\n") !== [...produced].sort().join("\n")) problems.push("context artifacts do not match the paths promised by execution evidence.");
  return problems;
}

/** Agent attempt files are written by the shared agent runner; each referenced file must exist and attempts are single. */
async function validateAgentArtifacts(caseEvidence: readonly AgentSuccessCaseEvidenceV1[], outDir: string, io: AgentSuccessRateArtifactIo): Promise<string[]> {
  const problems: string[] = [];
  const directories = new Set<string>();
  for (const entry of caseEvidence) {
    for (const treatment of entry.treatments) {
      for (const attempt of attemptEvidenceOf(treatment)) {
        const real = attempt.realAgent;
        if (!real?.agentArtifactDirectory) continue;
        if (directories.has(real.agentArtifactDirectory)) problems.push("duplicate agent attempt directory.");
        directories.add(real.agentArtifactDirectory);
        if (!real.agentArtifactDirectory.endsWith(`/attempt-${real.attempt}`)) problems.push(`agent attempt directory is not attempt-${real.attempt}.`);
        for (const reference of Object.values(real.agentArtifacts)) {
          if (reference === null) continue;
          try {
            if (!(await io.exists(resolveWithinRoot(outDir, reference)))) problems.push(`agent artifact ${reference} is missing.`);
          } catch {
            problems.push("agent artifact path is invalid.");
          }
        }
      }
    }
  }
  return problems;
}

/**
 * Removes only attempt directories this run created (those recorded as invoked). Removal is best effort, but a directory
 * that could not be removed is counted and reported in the returned suffix so cleanup is never presented as complete.
 */
async function removeAgentAttemptDirectories(
  caseEvidence: readonly AgentSuccessCaseEvidenceV1[],
  outDir: string,
  removeDirectory: (directory: string) => Promise<void>
): Promise<string> {
  let failures = 0;
  for (const entry of caseEvidence) {
    for (const treatment of entry.treatments) {
      for (const attempt of attemptEvidenceOf(treatment)) {
        const directory = attempt.realAgent?.agentArtifactDirectory;
        if (!directory) continue;
        try {
          await removeDirectory(resolveWithinRoot(outDir, directory));
        } catch {
          failures += 1;
        }
      }
    }
  }
  return failures > 0 ? ` ${failures} agent attempt director${failures === 1 ? "y" : "ies"} could not be removed.` : "";
}

function patchLabel(patchPath: string, realMode: boolean): string {
  const attempt = /attempt-(\d+)-/.exec(patchPath)?.[1];
  const suffix = realMode && attempt && attempt !== "1" ? ` (attempt ${attempt})` : "";
  if (patchPath.endsWith("-applied.patch")) return `Applied patch (from change evidence)${suffix}`;
  return `${realMode ? "Proposed patch (provider final answer)" : "Proposed deterministic fixture patch"}${suffix}`;
}

/** Removal seam for failed-persistence attempt directories so a removal failure can be proven on every platform. */
function readRemoveAttemptDirectoryInput(inputs: Record<string, unknown> | undefined): (directory: string) => Promise<void> {
  const value = inputs?.agentSuccessRemoveAttemptDirectory;
  return typeof value === "function" ? (value as (directory: string) => Promise<void>) : (directory) => rm(directory, { recursive: true, force: true });
}

function readRemoveDirectoryInput(inputs: Record<string, unknown> | undefined): { removeDirectory?: (directory: string) => Promise<void> } {
  const value = inputs?.agentSuccessRemoveDirectory;
  return typeof value === "function" ? { removeDirectory: value as (directory: string) => Promise<void> } : {};
}
