import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { tokenCountMethod } from "../../../core/countTokens.js";
import { resolveWithinRoot } from "../../../core/pathSafety.js";
import {
  serializeLocalRepositorySubjectManifest,
  type LocalRepositorySubject,
} from "../../../evaluation/localRepositorySubject/index.js";
import type { BenchmarkProjectProfile, EvaluationCase } from "../../../evaluation/types.js";
import { summarizeExperimentRun } from "../../results.js";
import type {
  ExperimentCase,
  ExperimentFailure,
  ExperimentMetric,
  ExperimentOutcome,
  ExperimentPlugin,
  ExperimentRun,
  ExperimentVariant,
  ExperimentWarning,
} from "../../types.js";
import { aggregateStatus } from "../warmIndexReuse/execution.js";
import {
  contextWindowScalingConfigDefinition,
  defaultContextWindowScalingConfig,
  validateContextWindowScalingConfig,
} from "./config.js";
import {
  executeContextWindowScalingCases,
  type ContextWindowScalingDependencies,
} from "./execution.js";
import {
  buildContextWindowScalingExecutionArtifact,
  CONTEXT_WINDOW_SCALING_EXECUTION_ARTIFACT_FILE,
  type CaseExecutionEvidenceV1,
  type TreatmentExecutionEvidenceV1,
} from "./executionArtifact.js";
import { CONTEXT_WINDOW_SCALING_TREATMENT_IDS, contextWindowScalingMetadata } from "./metadata.js";
import {
  aggregateContextWindowScaling,
  toAggregateExperimentMetrics,
  toOutcomeBudgetMetrics,
  type ContextWindowScalingAggregateV1,
} from "./metrics.js";
import { LocalSubjectExecutionError } from "./localSubjectErrors.js";
import { executeLocalRepositorySubjectContextWindowScaling } from "./localSubjectExecution.js";
import {
  describeLocalSubjectFailureForPersistence,
  projectEvidenceForExternalLocalPersistence,
  projectExternalLocalTarget,
  redactKnownPaths,
} from "./localSubjectPrivacy.js";
import { isSamePhysicalDirectory } from "./localSubjectScratch.js";
import { resolveScalingProjectProfiles } from "./projectProfile.js";
import type { ContextWindowScalingConfig } from "./types.js";

/** Privacy-safe Batch 1 manifest persisted beside the execution artifact for external-local runs. */
export const LOCAL_REPOSITORY_SUBJECT_MANIFEST_FILE = "local-repository-subject-manifest.json";

const VARIANTS: ExperimentVariant[] = [
  {
    id: "raw-full-file",
    name: "Raw full file",
    description: "Every file matched by the case's raw include globs, constructed once per case.",
  },
  {
    id: "my-dev-kit-guided",
    name: "my-dev-kit guided",
    description: "my-dev-kit retrieval context, constructed once per case.",
  },
];

/**
 * Run record: bounded and context-free. Scientific truth (fit, utilization, correctness, success,
 * omitted files) lives in executionEvidence and the persisted execution artifact; later reports and
 * plots consume it and never recalculate it.
 */
export type ContextWindowScalingRun = ExperimentRun & {
  contextBudgets: number[];
  executionEvidence: CaseExecutionEvidenceV1[];
  /** Calculated once from executionEvidence; reports and plots never recalculate it. */
  aggregate: ContextWindowScalingAggregateV1;
};

/** Internal-only seam: tests inject construction/evaluation owners through inputs.dependencies. */
export const contextWindowScalingPlugin: ExperimentPlugin<ContextWindowScalingConfig, ContextWindowScalingRun> = {
  metadata: contextWindowScalingMetadata,
  defaultConfig: defaultContextWindowScalingConfig,
  configDefinition: contextWindowScalingConfigDefinition,
  supportedVariants: CONTEXT_WINDOW_SCALING_TREATMENT_IDS,
  validateConfig: validateContextWindowScalingConfig,
  async run(context) {
    const startedAt = context.startedAt.toISOString();
    const localSubject = readLocalSubjectInput(context.inputs);
    if (localSubject) return runLocalSubject(context, localSubject, startedAt);
    if (context.target.kind === "external-local") {
      // Never fall back to the legacy raw/guided path against an external repository: it is neither
      // ignore-aware nor symlink-aware and writes artifacts it must not.
      throw new Error("External-local context-window-scaling targets require a loaded local repository subject (--local-subject-config).");
    }
    const cases = readCasesInput(context.inputs);
    const projectProfiles = resolveScalingProjectProfiles(cases, readProjectProfilesInput(context.inputs));
    const outDir = context.outputRoot ?? path.resolve(context.toolRoot, "lab-output", "context-window-scaling");
    await mkdir(outDir, { recursive: true });

    const executionEvidence = await executeContextWindowScalingCases({
      cases,
      contextBudgets: context.config.contextBudgets,
      kitCommand: context.config.kitCommand,
      outputRoot: outDir,
      projectProfiles,
      cwd: context.target.targetRoot,
      env: readEnvInput(context.inputs),
      dependencies: readDependenciesInput(context.inputs),
    });

    const completedAt = new Date().toISOString();
    const artifact = buildContextWindowScalingExecutionArtifact({
      runId: context.runId,
      pluginId: contextWindowScalingMetadata.id,
      pluginSchemaVersion: contextWindowScalingMetadata.schemaVersion,
      startedAt,
      completedAt,
      tokenCountMethod,
      contextBudgets: context.config.contextBudgets,
      cases: executionEvidence,
    });
    const artifactPath = resolveWithinRoot(outDir, CONTEXT_WINDOW_SCALING_EXECUTION_ARTIFACT_FILE);
    await writeFile(artifactPath, `${JSON.stringify(artifact, null, 2)}\n`, "utf8");

    return mapExecutionToRun({
      runId: context.runId,
      startedAt,
      completedAt,
      target: context.target,
      contextBudgets: context.config.contextBudgets,
      executionEvidence,
      artifactPath,
    });
  },
  summarize(result) {
    return result.summary ?? summarizeExperimentRun(result);
  },
};

function readLocalSubjectInput(inputs: Record<string, unknown> | undefined): LocalRepositorySubject | undefined {
  const value = inputs?.localSubject;
  return value && typeof value === "object" ? (value as LocalRepositorySubject) : undefined;
}

/**
 * External-local path: the Batch 2 safe seam owns execution, immutability and scratch cleanup; this function only
 * projects the privacy-lean result for persistence and feeds the same artifact and run builders as the legacy path.
 */
async function runLocalSubject(
  context: Parameters<ExperimentPlugin<ContextWindowScalingConfig, ContextWindowScalingRun>["run"]>[0],
  subject: LocalRepositorySubject,
  startedAt: string
): Promise<ContextWindowScalingRun> {
  if (context.target.isSelf || context.target.kind !== "external-local") {
    throw new Error("Local-repository subject mode requires an external-local target.");
  }
  if (!(await isSamePhysicalDirectory(context.target.targetRoot, subject.repositoryRoot))) {
    throw new Error("The selected --target is not the repository the local subject was loaded from.");
  }
  const outDir = context.outputRoot;
  if (!outDir) throw new Error("Local-repository subject mode requires an experiment output directory.");

  const knownFiles = [
    ...subject.eligibleFiles,
    ...subject.runtimeSafetyExclusions.gitIgnoredFiles,
    ...subject.runtimeSafetyExclusions.oversizedFiles,
  ];
  const privateRoots = [subject.repositoryRoot, context.target.targetRoot, outDir, context.toolRoot];

  let localResult;
  try {
    localResult = await executeLocalRepositorySubjectContextWindowScaling({
      subject,
      contextBudgets: context.config.contextBudgets,
      kitCommand: context.config.kitCommand,
      workRoot: outDir,
      env: readEnvInput(context.inputs),
      dependencies: readDependenciesInput(context.inputs),
    });
  } catch (error) {
    if (error instanceof LocalSubjectExecutionError) throw new Error(describeLocalSubjectFailureForPersistence(error));
    throw new Error(redactKnownPaths(error instanceof Error ? error.message : String(error), knownFiles, privateRoots));
  }

  const startedAtIso = startedAt;
  const evidence = projectEvidenceForExternalLocalPersistence(localResult.caseEvidence, { knownFiles, privateRoots });
  await mkdir(outDir, { recursive: true });
  const completedAt = new Date().toISOString();
  const artifact = buildContextWindowScalingExecutionArtifact({
    runId: context.runId,
    pluginId: contextWindowScalingMetadata.id,
    pluginSchemaVersion: contextWindowScalingMetadata.schemaVersion,
    startedAt: startedAtIso,
    completedAt,
    tokenCountMethod,
    contextBudgets: context.config.contextBudgets,
    cases: evidence,
  });
  const artifactPath = resolveWithinRoot(outDir, CONTEXT_WINDOW_SCALING_EXECUTION_ARTIFACT_FILE);
  await writeFile(artifactPath, `${JSON.stringify(artifact, null, 2)}
`, "utf8");
  const manifestPath = resolveWithinRoot(outDir, LOCAL_REPOSITORY_SUBJECT_MANIFEST_FILE);
  await writeFile(manifestPath, serializeLocalRepositorySubjectManifest(subject.manifest), "utf8");

  const run = mapExecutionToRun({
    runId: context.runId,
    startedAt: startedAtIso,
    completedAt,
    target: projectExternalLocalTarget(subject.manifest),
    contextBudgets: context.config.contextBudgets,
    executionEvidence: evidence,
    artifactPath,
  });
  run.artifacts.push({
    id: "local-repository-subject-manifest",
    label: "Privacy-safe local repository subject manifest",
    path: manifestPath,
    kind: "artifact",
    mimeType: "application/json",
    description: "Subject identity, Git commit, safety policy and aggregate inventory counts; no paths, source text or file lists.",
  });
  return run;
}

export function mapExecutionToRun(args: {
  runId: string;
  startedAt: string;
  completedAt: string;
  target: ExperimentRun["target"];
  contextBudgets: readonly number[];
  executionEvidence: readonly CaseExecutionEvidenceV1[];
  artifactPath: string;
}): ContextWindowScalingRun {
  const cases: ExperimentCase[] = args.executionEvidence.map((caseEvidence) => ({
    id: caseEvidence.caseId,
    name: caseEvidence.caseName,
    outcomes: caseEvidence.treatments.map((treatment) => buildOutcome(caseEvidence, treatment)),
    metadata: { benchmarkProject: caseEvidence.benchmarkProject },
  }));
  const aggregate = aggregateContextWindowScaling({ contextBudgets: args.contextBudgets, cases: args.executionEvidence });
  const run: ContextWindowScalingRun = {
    runId: args.runId,
    pluginId: contextWindowScalingMetadata.id,
    startedAt: args.startedAt,
    completedAt: args.completedAt,
    status: aggregateStatus(cases.flatMap((experimentCase) => experimentCase.outcomes.map((outcome) => outcome.status))),
    target: args.target,
    variants: VARIANTS.map((variant) => ({ ...variant })),
    cases,
    metrics: toAggregateExperimentMetrics(aggregate),
    artifacts: [
      {
        id: "context-window-scaling-execution",
        label: "Context window scaling execution evidence",
        path: args.artifactPath,
        kind: "artifact",
        mimeType: "application/json",
        description: "Per-case, per-treatment, per-budget fit, correctness, success, and omitted-file evidence without context text.",
      },
    ],
    warnings: [],
    failures: [],
    metadata: { executionArtifactPath: args.artifactPath },
    contextBudgets: [...args.contextBudgets],
    executionEvidence: structuredClone([...args.executionEvidence]),
    aggregate,
  };
  run.summary = summarizeExperimentRun(run);
  return run;
}

function buildOutcome(caseEvidence: CaseExecutionEvidenceV1, treatment: TreatmentExecutionEvidenceV1): ExperimentOutcome {
  const { caseId } = caseEvidence;
  const variantId = treatment.variantId;
  const metrics: ExperimentMetric[] = [];
  if (treatment.context.estimatedTokens !== null) {
    metrics.push({
      id: "context-estimated-tokens",
      name: "Context estimated tokens",
      value: treatment.context.estimatedTokens,
      unit: "tokens",
      variantId,
      caseId,
    });
  }
  if (treatment.relevantFileEvidence.omittedRelevantFileCount !== null) {
    metrics.push({
      id: "omitted-relevant-file-count",
      name: "Omitted relevant files",
      value: treatment.relevantFileEvidence.omittedRelevantFileCount,
      unit: "files",
      variantId,
      caseId,
    });
  }
  metrics.push(...toOutcomeBudgetMetrics(treatment, caseId));
  const warnings: ExperimentWarning[] = [
    ...treatment.context.warnings.map((message) => ({ code: "guided-retrieval-warning", message, variantId, caseId })),
    ...(treatment.evaluation.status === "unavailable"
      ? [{ code: "deterministic-evaluation-unavailable", message: treatment.evaluation.reason ?? "Evaluation unavailable.", variantId, caseId }]
      : []),
  ];
  const failures: ExperimentFailure[] = treatment.errors.map((error) => ({
    code: error.code,
    message: error.message,
    variantId,
    caseId,
    recoverable: true,
  }));
  return {
    id: `${caseId}:${variantId}`,
    caseId,
    variantId,
    status: treatment.status,
    metrics,
    artifacts: [],
    warnings,
    failures,
    metadata: {
      benchmarkProject: caseEvidence.benchmarkProject,
      contextStatus: treatment.context.status,
      evaluationStatus: treatment.evaluation.status,
    },
  };
}

function readCasesInput(inputs: Record<string, unknown> | undefined): EvaluationCase[] {
  const value = inputs?.cases;
  if (!Array.isArray(value) || value.length === 0) {
    throw new Error("Context window scaling requires a non-empty cases input.");
  }
  return value as EvaluationCase[];
}

function readProjectProfilesInput(inputs: Record<string, unknown> | undefined): BenchmarkProjectProfile[] {
  const value = inputs?.projectProfiles;
  return Array.isArray(value) ? (value as BenchmarkProjectProfile[]) : [];
}

function readEnvInput(inputs: Record<string, unknown> | undefined): NodeJS.ProcessEnv | undefined {
  const env = inputs?.env;
  return env && typeof env === "object" && !Array.isArray(env) ? (env as NodeJS.ProcessEnv) : undefined;
}

function readDependenciesInput(inputs: Record<string, unknown> | undefined): Partial<ContextWindowScalingDependencies> | undefined {
  const value = inputs?.dependencies;
  return value && typeof value === "object" ? (value as Partial<ContextWindowScalingDependencies>) : undefined;
}
