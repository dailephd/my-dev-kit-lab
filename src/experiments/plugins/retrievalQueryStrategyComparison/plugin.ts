import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { resolveWithinRoot } from "../../../core/pathSafety.js";
import { serializeLocalRepositorySubjectManifest, type LocalRepositorySubject } from "../../../evaluation/localRepositorySubject/index.js";
import type { EvaluationCase } from "../../../evaluation/types.js";
import { summarizeExperimentRun } from "../../results.js";
import type {
  ExperimentCase,
  ExperimentOutcome,
  ExperimentPlugin,
  ExperimentRun,
  ExperimentRunStatus
} from "../../types.js";
import { LocalSubjectExecutionError } from "../contextWindowScaling/localSubjectErrors.js";
import { projectExternalLocalTarget } from "../contextWindowScaling/localSubjectPrivacy.js";
import { isSamePhysicalDirectory } from "../contextWindowScaling/localSubjectScratch.js";
import { selectWarmIndexCases } from "../warmIndexReuse/selection.js";
import {
  defaultRetrievalQueryStrategyComparisonConfig,
  retrievalQueryStrategyComparisonConfigDefinition,
  validateRetrievalQueryStrategyComparisonConfig,
  type RetrievalQueryStrategyComparisonConfig
} from "./config.js";
import { analyzeRetrievalQueryStrategyComparison } from "./analysis.js";
import {
  buildRetrievalQueryStrategyComparisonAnalysisArtifact,
  RETRIEVAL_QUERY_STRATEGY_COMPARISON_ANALYSIS_ARTIFACT_FILE
} from "./analysisArtifact.js";
import type { RetrievalQueryStrategyComparisonAnalysisV1, RetrievalQueryStrategyTreatmentAnalysisV1 } from "./analysisTypes.js";
import {
  executeRetrievalQueryStrategyCaseFromPreparedIndex,
  executeRetrievalQueryStrategyComparison,
  type RetrievalQueryStrategyComparisonDependencies
} from "./execution.js";
import { executeLocalRepositorySubjectRetrievalQueryStrategyComparison, type RetrievalQueryStrategyLocalSubjectDependencies } from "./localSubjectExecution.js";
import {
  assertRetrievalQueryStrategyExternalProjectionIsPrivate,
  describeRetrievalQueryStrategyLocalSubjectFailureForPersistence,
  projectRetrievalQueryStrategyAnalysisForExternalLocalPersistence,
  projectRetrievalQueryStrategyExecutionForExternalLocalPersistence,
  RETRIEVAL_QUERY_STRATEGY_UNEXPECTED_EXTERNAL_FAILURE_MESSAGE
} from "./localSubjectPrivacy.js";
import {
  buildRetrievalQueryStrategyComparisonExecutionArtifact,
  RETRIEVAL_QUERY_STRATEGY_COMPARISON_EXECUTION_ARTIFACT_FILE
} from "./executionArtifact.js";
import {
  RETRIEVAL_QUERY_STRATEGY_COMPARISON_PLUGIN_ID,
  RETRIEVAL_QUERY_STRATEGY_COMPARISON_VARIANTS,
  retrievalQueryStrategyComparisonMetadata
} from "./metadata.js";
import { toRetrievalQueryStrategyOutcomeMetrics, toRetrievalQueryStrategyRunMetrics } from "./metrics.js";
import type {
  RetrievalQueryStrategyComparisonCaseEvidenceV1,
  RetrievalQueryStrategyTreatmentEvidenceV1
} from "./types.js";

/** Privacy-safe subject manifest persisted beside the artifacts for external-local runs (same file as the other local-subject plugins). */
export const RETRIEVAL_QUERY_STRATEGY_COMPARISON_LOCAL_SUBJECT_MANIFEST_FILE = "local-repository-subject-manifest.json";

/** An external target must always arrive with a loaded local repository subject; there is no bundled fallback against it. */
export const RETRIEVAL_QUERY_STRATEGY_COMPARISON_EXTERNAL_REQUIRES_SUBJECT_MESSAGE =
  "External-local retrieval-query-strategy-comparison targets require a loaded local repository subject (--local-subject-config).";

/** Carries only bounded, context-free evidence; retrieval results never attach to the run. */
export type RetrievalQueryStrategyComparisonRun = ExperimentRun & {
  caseExecutionEvidence: RetrievalQueryStrategyComparisonCaseEvidenceV1[];
  analysis: RetrievalQueryStrategyComparisonAnalysisV1;
};

export const retrievalQueryStrategyComparisonPlugin: ExperimentPlugin<
  RetrievalQueryStrategyComparisonConfig,
  RetrievalQueryStrategyComparisonRun
> = {
  metadata: retrievalQueryStrategyComparisonMetadata,
  defaultConfig: defaultRetrievalQueryStrategyComparisonConfig,
  configDefinition: retrievalQueryStrategyComparisonConfigDefinition,
  supportedVariants: RETRIEVAL_QUERY_STRATEGY_COMPARISON_VARIANTS.map((variant) => variant.id),
  validateConfig: validateRetrievalQueryStrategyComparisonConfig,
  async run(context) {
    const startedAt = context.startedAt.toISOString();
    const localSubject = readLocalSubjectInput(context.inputs);
    if (localSubject) return runLocalSubject(context, localSubject, startedAt);
    // The runner does not enforce supportedTargets; never fall back to the bundled corpus against an external repository.
    if (context.target.kind !== "self" || context.target.isSelf !== true) {
      throw new Error(RETRIEVAL_QUERY_STRATEGY_COMPARISON_EXTERNAL_REQUIRES_SUBJECT_MESSAGE);
    }
    const cases = selectWarmIndexCases(readCasesInput(context.inputs), context.config);
    const outDir = context.outputRoot ?? path.resolve(context.toolRoot, context.config.outDir);
    await mkdir(outDir, { recursive: true });

    const caseEvidence = await executeRetrievalQueryStrategyComparison({
      cases,
      kitCommand: context.config.kitCommand,
      outputRoot: outDir,
      dependencies: readDependenciesInput(context.inputs)
    });
    // Scientific analysis is calculated in memory before persistence; reports later consume it, never recalculate it.
    const analysis = analyzeRetrievalQueryStrategyComparison(cases, caseEvidence);
    const completedAt = new Date().toISOString();
    const artifact = buildRetrievalQueryStrategyComparisonExecutionArtifact({
      runId: context.runId,
      pluginId: RETRIEVAL_QUERY_STRATEGY_COMPARISON_PLUGIN_ID,
      pluginSchemaVersion: retrievalQueryStrategyComparisonMetadata.schemaVersion,
      startedAt,
      completedAt,
      cases: caseEvidence
    });
    const analysisArtifact = buildRetrievalQueryStrategyComparisonAnalysisArtifact({
      runId: context.runId,
      pluginId: RETRIEVAL_QUERY_STRATEGY_COMPARISON_PLUGIN_ID,
      pluginSchemaVersion: retrievalQueryStrategyComparisonMetadata.schemaVersion,
      startedAt,
      completedAt,
      analysis
    });
    const executionArtifactPath = resolveWithinRoot(outDir, RETRIEVAL_QUERY_STRATEGY_COMPARISON_EXECUTION_ARTIFACT_FILE);
    const analysisArtifactPath = resolveWithinRoot(outDir, RETRIEVAL_QUERY_STRATEGY_COMPARISON_ANALYSIS_ARTIFACT_FILE);
    await writeFile(executionArtifactPath, `${JSON.stringify(artifact, null, 2)}\n`, "utf8");
    await writeFile(analysisArtifactPath, `${JSON.stringify(analysisArtifact, null, 2)}\n`, "utf8");

    return mapRetrievalQueryStrategyComparisonToRun({
      runId: context.runId,
      startedAt,
      completedAt,
      target: context.target,
      caseEvidence,
      analysis,
      executionArtifactPath,
      analysisArtifactPath
    });
  },
  summarize(result) {
    return result.summary ?? summarizeExperimentRun(result);
  }
};

function readLocalSubjectInput(inputs: Record<string, unknown> | undefined): LocalRepositorySubject | undefined {
  const value = inputs?.localSubject;
  return value && typeof value === "object" ? (value as LocalRepositorySubject) : undefined;
}

/** Test seams for the external path derive from the same optional dependency input the bundled path reads. */
function readLocalSubjectDependencies(
  inputs: Record<string, unknown> | undefined
): Partial<RetrievalQueryStrategyLocalSubjectDependencies> | undefined {
  const injected = readDependenciesInput(inputs);
  if (!injected) return undefined;
  const { buildIndex, runCoreStrategy, runSemanticStrategy } = injected;
  return {
    ...(buildIndex ? { buildIndex } : {}),
    ...(runCoreStrategy || runSemanticStrategy
      ? {
          executeCase: (options) =>
            executeRetrievalQueryStrategyCaseFromPreparedIndex({
              ...options,
              dependencies: { ...(runCoreStrategy ? { runCoreStrategy } : {}), ...(runSemanticStrategy ? { runSemanticStrategy } : {}) }
            })
        }
      : {})
  };
}

/**
 * External-local path. The safe seam owns execution, immutability and scratch cleanup and either returns evidence or
 * throws. Scientific analysis is calculated from the real, unprojected identities; only then is the evidence
 * privacy-projected and asserted private. Nothing durable is written before every gate has passed, and then in this
 * order: execution artifact, analysis artifact, manifest.
 */
async function runLocalSubject(
  context: Parameters<ExperimentPlugin<RetrievalQueryStrategyComparisonConfig, RetrievalQueryStrategyComparisonRun>["run"]>[0],
  subject: LocalRepositorySubject,
  startedAt: string
): Promise<RetrievalQueryStrategyComparisonRun> {
  if (context.target.isSelf || context.target.kind !== "external-local") {
    throw new Error("Local-repository subject mode requires an external-local target.");
  }
  if (context.config.caseIds !== undefined || context.config.benchmarkProjects !== undefined) {
    throw new Error("Case and benchmark-project filters are not supported for an external local repository subject; the subject config owns the case set.");
  }
  if (!(await isSamePhysicalDirectory(context.target.targetRoot, subject.repositoryRoot))) {
    throw new Error("The selected --target is not the repository the local subject was loaded from.");
  }
  const outDir = context.outputRoot;
  if (!outDir) throw new Error("Local-repository subject mode requires an experiment output directory.");

  let localResult;
  try {
    localResult = await executeLocalRepositorySubjectRetrievalQueryStrategyComparison({
      subject,
      kitCommand: context.config.kitCommand,
      workRoot: outDir,
      dependencies: readLocalSubjectDependencies(context.inputs)
    });
  } catch (error) {
    if (error instanceof LocalSubjectExecutionError) throw new Error(describeRetrievalQueryStrategyLocalSubjectFailureForPersistence(error));
    throw new Error(RETRIEVAL_QUERY_STRATEGY_UNEXPECTED_EXTERNAL_FAILURE_MESSAGE);
  }

  // Science first, on real identities; placeholders are never scientific identities.
  const analysis = analyzeRetrievalQueryStrategyComparison(subject.evaluationCases, localResult.caseEvidence);
  const projectedExecution = projectRetrievalQueryStrategyExecutionForExternalLocalPersistence(localResult.caseEvidence);
  const projectedAnalysis = projectRetrievalQueryStrategyAnalysisForExternalLocalPersistence(analysis);
  const privateValues = {
    filePaths: [...subject.eligibleFiles, ...subject.runtimeSafetyExclusions.gitIgnoredFiles, ...subject.runtimeSafetyExclusions.oversizedFiles],
    caseTitles: subject.evaluationCases.map((evaluationCase) => evaluationCase.title),
    warnings: localResult.caseEvidence.flatMap((entry) => entry.treatments.flatMap((treatment) => treatment.retrieval?.warnings ?? [])),
    privateRoots: [subject.repositoryRoot, outDir]
  };
  assertRetrievalQueryStrategyExternalProjectionIsPrivate(projectedExecution, privateValues);
  assertRetrievalQueryStrategyExternalProjectionIsPrivate(projectedAnalysis, privateValues);

  await mkdir(outDir, { recursive: true });
  const completedAt = new Date().toISOString();
  const executionArtifact = buildRetrievalQueryStrategyComparisonExecutionArtifact({
    runId: context.runId,
    pluginId: RETRIEVAL_QUERY_STRATEGY_COMPARISON_PLUGIN_ID,
    pluginSchemaVersion: retrievalQueryStrategyComparisonMetadata.schemaVersion,
    startedAt,
    completedAt,
    cases: projectedExecution
  });
  const analysisArtifact = buildRetrievalQueryStrategyComparisonAnalysisArtifact({
    runId: context.runId,
    pluginId: RETRIEVAL_QUERY_STRATEGY_COMPARISON_PLUGIN_ID,
    pluginSchemaVersion: retrievalQueryStrategyComparisonMetadata.schemaVersion,
    startedAt,
    completedAt,
    analysis: projectedAnalysis
  });
  await writeFile(
    resolveWithinRoot(outDir, RETRIEVAL_QUERY_STRATEGY_COMPARISON_EXECUTION_ARTIFACT_FILE),
    `${JSON.stringify(executionArtifact, null, 2)}\n`,
    "utf8"
  );
  await writeFile(
    resolveWithinRoot(outDir, RETRIEVAL_QUERY_STRATEGY_COMPARISON_ANALYSIS_ARTIFACT_FILE),
    `${JSON.stringify(analysisArtifact, null, 2)}\n`,
    "utf8"
  );
  await writeFile(
    resolveWithinRoot(outDir, RETRIEVAL_QUERY_STRATEGY_COMPARISON_LOCAL_SUBJECT_MANIFEST_FILE),
    serializeLocalRepositorySubjectManifest(subject.manifest),
    "utf8"
  );

  // Durable external run: logical target and basenames only; metrics come from the unchanged numeric analysis.
  const run = mapRetrievalQueryStrategyComparisonToRun({
    runId: context.runId,
    startedAt,
    completedAt,
    target: projectExternalLocalTarget(subject.manifest),
    caseEvidence: projectedExecution,
    analysis: projectedAnalysis,
    executionArtifactPath: RETRIEVAL_QUERY_STRATEGY_COMPARISON_EXECUTION_ARTIFACT_FILE,
    analysisArtifactPath: RETRIEVAL_QUERY_STRATEGY_COMPARISON_ANALYSIS_ARTIFACT_FILE
  });
  run.artifacts.push({
    id: "local-repository-subject-manifest",
    label: "Privacy-safe local repository subject manifest",
    path: RETRIEVAL_QUERY_STRATEGY_COMPARISON_LOCAL_SUBJECT_MANIFEST_FILE,
    kind: "artifact",
    mimeType: "application/json",
    description: "Privacy-safe logical subject, Git, safety and aggregate inventory metadata without source or private identity lists."
  });
  return run;
}

export function mapRetrievalQueryStrategyComparisonToRun(args: {
  runId: string;
  startedAt: string;
  completedAt: string;
  target: ExperimentRun["target"];
  caseEvidence: readonly RetrievalQueryStrategyComparisonCaseEvidenceV1[];
  analysis: RetrievalQueryStrategyComparisonAnalysisV1;
  executionArtifactPath: string;
  analysisArtifactPath: string;
}): RetrievalQueryStrategyComparisonRun {
  const cases: ExperimentCase[] = args.caseEvidence.map((entry, caseIndex) => ({
    id: entry.caseId,
    name: entry.caseName,
    outcomes: entry.treatments.map((treatment, treatmentIndex) =>
      buildOutcome(entry, treatment, args.analysis.cases[caseIndex].treatments[treatmentIndex])
    ),
    metadata: { benchmarkProject: entry.benchmarkProject, taskLocality: entry.taskLocality }
  }));
  const run: RetrievalQueryStrategyComparisonRun = {
    runId: args.runId,
    pluginId: RETRIEVAL_QUERY_STRATEGY_COMPARISON_PLUGIN_ID,
    startedAt: args.startedAt,
    completedAt: args.completedAt,
    status: aggregateTreatmentStatus(args.caseEvidence.flatMap((entry) => entry.treatments.map((treatment) => treatment.status))),
    target: args.target,
    variants: RETRIEVAL_QUERY_STRATEGY_COMPARISON_VARIANTS.map((variant) => ({ ...variant })),
    cases,
    metrics: toRetrievalQueryStrategyRunMetrics(args.analysis),
    artifacts: [
      {
        id: "retrieval-query-strategy-comparison-execution",
        label: "Retrieval query strategy comparison execution evidence",
        path: args.executionArtifactPath,
        kind: "artifact",
        mimeType: "application/json",
        description:
          "Matched per-case execution evidence for all seven retrieval query strategies without context text or raw command output."
      },
      {
        id: "retrieval-query-strategy-comparison-analysis",
        label: "Retrieval query strategy comparison scientific analysis",
        path: args.analysisArtifactPath,
        kind: "artifact",
        mimeType: "application/json",
        description:
          "Planner-defined retrieval-quality, F1, matched task-type aggregates, and Pareto comparison for the seven retrieval query strategies."
      }
    ],
    warnings: [],
    // Outcome failures are the authoritative per-treatment failure location.
    failures: [],
    metadata: { executionArtifactPath: args.executionArtifactPath, analysisArtifactPath: args.analysisArtifactPath },
    caseExecutionEvidence: structuredClone(args.caseEvidence) as RetrievalQueryStrategyComparisonCaseEvidenceV1[],
    analysis: structuredClone(args.analysis)
  };
  run.summary = summarizeExperimentRun(run);
  return run;
}

function buildOutcome(
  caseEvidence: RetrievalQueryStrategyComparisonCaseEvidenceV1,
  treatment: RetrievalQueryStrategyTreatmentEvidenceV1,
  treatmentAnalysis: RetrievalQueryStrategyTreatmentAnalysisV1
): ExperimentOutcome {
  const { caseId, benchmarkProject, taskLocality } = caseEvidence;
  const { strategyId } = treatment;
  return {
    id: `${caseId}:${strategyId}`,
    caseId,
    variantId: strategyId,
    status: treatment.status,
    metrics: toRetrievalQueryStrategyOutcomeMetrics(treatmentAnalysis, caseId),
    artifacts: [],
    warnings: (treatment.retrieval?.warnings ?? []).map((message) => ({
      code: "retrieval-warning",
      message,
      variantId: strategyId,
      caseId
    })),
    failures: treatment.errors.map((error) => ({
      code: error.code,
      message: error.message,
      variantId: strategyId,
      caseId,
      recoverable: true
    })),
    metadata: {
      benchmarkProject,
      taskLocality,
      evidenceAvailability: treatment.retrieval?.evidenceAvailability ?? null
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

function readCasesInput(inputs: Record<string, unknown> | undefined): EvaluationCase[] {
  const value = inputs?.cases;
  if (!Array.isArray(value)) {
    throw new Error("Retrieval query strategy comparison requires cases input.");
  }
  return value as EvaluationCase[];
}

function readDependenciesInput(
  inputs: Record<string, unknown> | undefined
): Partial<RetrievalQueryStrategyComparisonDependencies> | undefined {
  const value = inputs?.retrievalDependencies;
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Partial<RetrievalQueryStrategyComparisonDependencies>)
    : undefined;
}
