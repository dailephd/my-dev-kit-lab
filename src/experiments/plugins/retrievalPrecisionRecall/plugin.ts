import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { resolveWithinRoot } from "../../../core/pathSafety.js";
import { serializeLocalRepositorySubjectManifest, type LocalRepositorySubject } from "../../../evaluation/localRepositorySubject/index.js";
import type { EvaluationCase } from "../../../evaluation/types.js";
import { summarizeExperimentRun } from "../../results.js";
import type {
  ExperimentCase,
  ExperimentFailure,
  ExperimentJsonValue,
  ExperimentOutcome,
  ExperimentPlugin,
  ExperimentRun,
  ExperimentRunStatus,
  ExperimentWarning
} from "../../types.js";
import { LocalSubjectExecutionError } from "../contextWindowScaling/localSubjectErrors.js";
import { projectExternalLocalTarget } from "../contextWindowScaling/localSubjectPrivacy.js";
import { isSamePhysicalDirectory } from "../contextWindowScaling/localSubjectScratch.js";
import { selectWarmIndexCases } from "../warmIndexReuse/selection.js";
import {
  defaultRetrievalPrecisionRecallConfig,
  retrievalPrecisionRecallConfigDefinition,
  validateRetrievalPrecisionRecallConfig,
  type RetrievalPrecisionRecallConfig
} from "./config.js";
import { executeRetrievalPrecisionRecall, type RetrievalPrecisionRecallDependencies } from "./execution.js";
import { executeLocalRepositorySubjectRetrievalPrecisionRecall } from "./localSubjectExecution.js";
import {
  assertExternalLocalProjectionIsPrivate,
  describeRetrievalLocalSubjectFailureForPersistence,
  projectRetrievalEvidenceForExternalLocalPersistence,
  UNEXPECTED_EXTERNAL_FAILURE_MESSAGE
} from "./localSubjectPrivacy.js";
import {
  buildRetrievalPrecisionRecallExecutionArtifact,
  RETRIEVAL_PRECISION_RECALL_EXECUTION_ARTIFACT_FILE
} from "./executionArtifact.js";
import { aggregateRetrievalPrecisionRecall, retrievalRatioOf, toRetrievalPrecisionRecallOutcomeMetrics, toRetrievalPrecisionRecallRunMetrics } from "./metrics.js";
import {
  RETRIEVAL_PRECISION_RECALL_PLUGIN_ID,
  RETRIEVAL_PRECISION_RECALL_VARIANTS,
  RETRIEVAL_PRECISION_RECALL_VARIANT_ID,
  retrievalPrecisionRecallMetadata
} from "./metadata.js";
import {
  RETRIEVAL_PRECISION_RECALL_RATIO_KEYS,
  type RetrievalPrecisionRecallAggregateV1,
  type RetrievalPrecisionRecallCaseEvidenceV1
} from "./types.js";

/** Privacy-safe Batch 1 manifest persisted beside the execution artifact for external-local runs (same file as context-window-scaling). */
export const RETRIEVAL_PRECISION_RECALL_LOCAL_SUBJECT_MANIFEST_FILE = "local-repository-subject-manifest.json";

/** An external target must always arrive with a loaded local repository subject; there is no bundled fallback against it. */
export const RETRIEVAL_PRECISION_RECALL_EXTERNAL_REQUIRES_SUBJECT_MESSAGE =
  "External-local retrieval-precision-recall targets require a loaded local repository subject (--local-subject-config).";

/**
 * The run record carries only bounded, context-free evidence: generic report writers serialize the whole run, so
 * retrieval results (which hold contextText and raw command output) must never be attached to it.
 */
export type RetrievalPrecisionRecallRun = ExperimentRun & {
  caseExecutionEvidence: RetrievalPrecisionRecallCaseEvidenceV1[];
  /** Calculated once before persistence; reports never recalculate it. */
  aggregate: RetrievalPrecisionRecallAggregateV1;
};

export const retrievalPrecisionRecallPlugin: ExperimentPlugin<RetrievalPrecisionRecallConfig, RetrievalPrecisionRecallRun> = {
  metadata: retrievalPrecisionRecallMetadata,
  defaultConfig: defaultRetrievalPrecisionRecallConfig,
  configDefinition: retrievalPrecisionRecallConfigDefinition,
  supportedVariants: RETRIEVAL_PRECISION_RECALL_VARIANTS.map((variant) => variant.id),
  validateConfig: validateRetrievalPrecisionRecallConfig,
  async run(context) {
    const startedAt = context.startedAt.toISOString();
    // The runner does not enforce supportedTargets, so the plugin fails closed on its own.
    const localSubject = readLocalSubjectInput(context.inputs);
    if (localSubject) return runLocalSubject(context, localSubject, startedAt);
    if (context.target.kind !== "self" || context.target.isSelf !== true) {
      // Never fall back to the bundled corpus against an external repository.
      throw new Error(RETRIEVAL_PRECISION_RECALL_EXTERNAL_REQUIRES_SUBJECT_MESSAGE);
    }
    const cases = selectWarmIndexCases(readCasesInput(context.inputs), context.config);
    const outDir = context.outputRoot ?? path.resolve(context.toolRoot, context.config.outDir);
    await mkdir(outDir, { recursive: true });

    const caseEvidence = await executeRetrievalPrecisionRecall({
      cases,
      kitCommand: context.config.kitCommand,
      outputRoot: outDir,
      dependencies: readDependenciesInput(context.inputs)
    });
    // Scientific truth is calculated before persistence; the artifact and every report consume it unchanged.
    const aggregate = aggregateRetrievalPrecisionRecall(caseEvidence);
    const completedAt = new Date().toISOString();
    const artifact = buildRetrievalPrecisionRecallExecutionArtifact({
      runId: context.runId,
      pluginId: RETRIEVAL_PRECISION_RECALL_PLUGIN_ID,
      pluginSchemaVersion: retrievalPrecisionRecallMetadata.schemaVersion,
      startedAt,
      completedAt,
      cases: caseEvidence,
      aggregate
    });
    const artifactPath = resolveWithinRoot(outDir, RETRIEVAL_PRECISION_RECALL_EXECUTION_ARTIFACT_FILE);
    await writeFile(artifactPath, `${JSON.stringify(artifact, null, 2)}\n`, "utf8");

    return mapRetrievalPrecisionRecallToRun({
      runId: context.runId,
      startedAt,
      completedAt,
      target: context.target,
      caseEvidence,
      aggregate,
      artifactPath
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

/**
 * External-local path. The safe seam owns execution, immutability and scratch cleanup and either returns evidence or
 * throws; only after it succeeds is anything durable written: the case evidence is privacy-projected, the aggregate
 * (calculated from the unprojected numbers) is preserved, and the artifact and manifest are written, in that order.
 */
async function runLocalSubject(
  context: Parameters<ExperimentPlugin<RetrievalPrecisionRecallConfig, RetrievalPrecisionRecallRun>["run"]>[0],
  subject: LocalRepositorySubject,
  startedAt: string
): Promise<RetrievalPrecisionRecallRun> {
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
    localResult = await executeLocalRepositorySubjectRetrievalPrecisionRecall({
      subject,
      kitCommand: context.config.kitCommand,
      workRoot: outDir,
      dependencies: readDependenciesInput(context.inputs)
    });
  } catch (error) {
    if (error instanceof LocalSubjectExecutionError) throw new Error(describeRetrievalLocalSubjectFailureForPersistence(error));
    throw new Error(UNEXPECTED_EXTERNAL_FAILURE_MESSAGE);
  }

  // Scientific numbers are calculated once from the unprojected evidence; projection only withholds identities.
  const aggregate = aggregateRetrievalPrecisionRecall(localResult.caseEvidence);
  const projected = projectRetrievalEvidenceForExternalLocalPersistence(localResult.caseEvidence);
  assertExternalLocalProjectionIsPrivate(projected, {
    filePaths: [...subject.eligibleFiles, ...subject.runtimeSafetyExclusions.gitIgnoredFiles, ...subject.runtimeSafetyExclusions.oversizedFiles],
    caseTitles: subject.evaluationCases.map((evaluationCase) => evaluationCase.title),
    warnings: localResult.caseEvidence.flatMap((entry) => entry.retrieval?.warnings ?? [])
  });

  await mkdir(outDir, { recursive: true });
  const completedAt = new Date().toISOString();
  const artifact = buildRetrievalPrecisionRecallExecutionArtifact({
    runId: context.runId,
    pluginId: RETRIEVAL_PRECISION_RECALL_PLUGIN_ID,
    pluginSchemaVersion: retrievalPrecisionRecallMetadata.schemaVersion,
    startedAt,
    completedAt,
    cases: projected,
    aggregate
  });
  const artifactPath = resolveWithinRoot(outDir, RETRIEVAL_PRECISION_RECALL_EXECUTION_ARTIFACT_FILE);
  await writeFile(artifactPath, `${JSON.stringify(artifact, null, 2)}
`, "utf8");
  const manifestPath = resolveWithinRoot(outDir, RETRIEVAL_PRECISION_RECALL_LOCAL_SUBJECT_MANIFEST_FILE);
  await writeFile(manifestPath, serializeLocalRepositorySubjectManifest(subject.manifest), "utf8");

  const run = mapRetrievalPrecisionRecallToRun({
    runId: context.runId,
    startedAt,
    completedAt,
    target: projectExternalLocalTarget(subject.manifest),
    caseEvidence: projected,
    aggregate,
    artifactPath
  });
  run.artifacts.push({
    id: "local-repository-subject-manifest",
    label: "Privacy-safe local repository subject manifest",
    path: manifestPath,
    kind: "artifact",
    mimeType: "application/json",
    description: "Privacy-safe logical subject, Git, safety and aggregate inventory metadata without source or private identity lists."
  });
  return run;
}

export function mapRetrievalPrecisionRecallToRun(args: {
  runId: string;
  startedAt: string;
  completedAt: string;
  target: ExperimentRun["target"];
  caseEvidence: readonly RetrievalPrecisionRecallCaseEvidenceV1[];
  aggregate: RetrievalPrecisionRecallAggregateV1;
  artifactPath: string;
}): RetrievalPrecisionRecallRun {
  const cases: ExperimentCase[] = args.caseEvidence.map((entry) => ({
    id: entry.caseId,
    name: entry.caseName,
    outcomes: [buildOutcome(entry)],
    metadata: { benchmarkProject: entry.benchmarkProject, taskLocality: entry.taskLocality }
  }));
  const failures: ExperimentFailure[] = args.caseEvidence.flatMap((entry) =>
    entry.errors.map((error) => ({
      code: error.code,
      message: error.message,
      variantId: RETRIEVAL_PRECISION_RECALL_VARIANT_ID,
      caseId: entry.caseId,
      recoverable: true
    }))
  );
  const run: RetrievalPrecisionRecallRun = {
    runId: args.runId,
    pluginId: RETRIEVAL_PRECISION_RECALL_PLUGIN_ID,
    startedAt: args.startedAt,
    completedAt: args.completedAt,
    status: aggregateStatus(args.caseEvidence.map((entry) => entry.status)),
    target: args.target,
    variants: RETRIEVAL_PRECISION_RECALL_VARIANTS.map((variant) => ({ ...variant })),
    cases,
    metrics: toRetrievalPrecisionRecallRunMetrics(args.aggregate),
    artifacts: [
      {
        id: "retrieval-precision-recall-execution",
        label: "Retrieval precision/recall execution evidence",
        path: args.artifactPath,
        kind: "artifact",
        mimeType: "application/json",
        description: "Per-case retrieval-quality evidence and aggregate without context text or raw command output."
      }
    ],
    warnings: [],
    failures,
    metadata: { executionArtifactPath: args.artifactPath },
    caseExecutionEvidence: args.caseEvidence.map((entry) => structuredClone(entry)),
    aggregate: structuredClone(args.aggregate)
  };
  run.summary = summarizeExperimentRun(run);
  return run;
}

function buildOutcome(entry: RetrievalPrecisionRecallCaseEvidenceV1): ExperimentOutcome {
  const warnings: ExperimentWarning[] = (entry.retrieval?.warnings ?? []).map((message) => ({
    code: "retrieval-warning",
    message,
    variantId: RETRIEVAL_PRECISION_RECALL_VARIANT_ID,
    caseId: entry.caseId
  }));
  const failures: ExperimentFailure[] = entry.errors.map((error) => ({
    code: error.code,
    message: error.message,
    variantId: RETRIEVAL_PRECISION_RECALL_VARIANT_ID,
    caseId: entry.caseId,
    recoverable: true
  }));
  // Availability and reason stay visible even though an unavailable/not-applicable ratio projects as a null value.
  const metricAvailability: Record<string, ExperimentJsonValue> = {};
  for (const key of RETRIEVAL_PRECISION_RECALL_RATIO_KEYS) {
    const ratio = retrievalRatioOf(entry.quality, key);
    metricAvailability[key] = { availability: ratio.availability, reason: ratio.reason };
  }
  return {
    id: `${entry.caseId}:${RETRIEVAL_PRECISION_RECALL_VARIANT_ID}`,
    caseId: entry.caseId,
    variantId: RETRIEVAL_PRECISION_RECALL_VARIANT_ID,
    status: entry.status,
    metrics: toRetrievalPrecisionRecallOutcomeMetrics(entry.quality, RETRIEVAL_PRECISION_RECALL_VARIANT_ID, entry.caseId),
    artifacts: [],
    warnings,
    failures,
    metadata: {
      benchmarkProject: entry.benchmarkProject,
      evidenceAvailability: entry.retrieval?.evidenceAvailability ?? null,
      metricAvailability
    }
  };
}

/** Same aggregation rule as the generic per-case summary: uniform statuses win, mixed is partial. */
function aggregateStatus(statuses: readonly ExperimentRunStatus[]): ExperimentRunStatus {
  if (statuses.length === 0) return "skipped";
  for (const status of ["completed", "skipped", "failed"] as const) {
    if (statuses.every((value) => value === status)) return status;
  }
  return "partial";
}

function readCasesInput(inputs: Record<string, unknown> | undefined): EvaluationCase[] {
  const value = inputs?.cases;
  if (!Array.isArray(value)) {
    throw new Error("Retrieval precision/recall requires cases input.");
  }
  return value as EvaluationCase[];
}

function readDependenciesInput(inputs: Record<string, unknown> | undefined): Partial<RetrievalPrecisionRecallDependencies> | undefined {
  const value = inputs?.retrievalDependencies;
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Partial<RetrievalPrecisionRecallDependencies>) : undefined;
}
