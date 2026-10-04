import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { resolveWithinRoot } from "../../../core/pathSafety.js";
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
import { selectWarmIndexCases } from "../warmIndexReuse/selection.js";
import {
  defaultRetrievalPrecisionRecallConfig,
  retrievalPrecisionRecallConfigDefinition,
  validateRetrievalPrecisionRecallConfig,
  type RetrievalPrecisionRecallConfig
} from "./config.js";
import { executeRetrievalPrecisionRecall, type RetrievalPrecisionRecallDependencies } from "./execution.js";
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

export const RETRIEVAL_PRECISION_RECALL_SELF_TARGET_ONLY_MESSAGE = "retrieval-precision-recall currently supports only the bundled self target.";

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
    // The runner does not enforce supportedTargets, so the plugin fails closed on its own.
    if (context.target.kind !== "self" || context.target.isSelf !== true) {
      throw new Error(RETRIEVAL_PRECISION_RECALL_SELF_TARGET_ONLY_MESSAGE);
    }
    const startedAt = context.startedAt.toISOString();
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
