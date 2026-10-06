import path from "node:path";
import type { RetrievalQualityRatioMetricV1 } from "../../evaluation/retrievalQuality/index.js";
import type { ExperimentRun } from "../../experiments/index.js";
import { CONTEXT_PACK_GENERATION_METHODOLOGY } from "../../experiments/plugins/contextPackGeneration/analysisArtifact.js";
import type { ContextPackGenerationCaseEvidenceV1 } from "../../experiments/plugins/contextPackGeneration/executionTypes.js";
import { CONTEXT_PACK_GENERATION_PLUGIN_ID, CONTEXT_PACK_GENERATION_TREATMENT_IDS } from "../../experiments/plugins/contextPackGeneration/metadata.js";
import type { ContextPackGenerationRun } from "../../experiments/plugins/contextPackGeneration/plugin.js";
import type { ContextPack } from "../../experiments/plugins/contextPackGeneration/types.js";
import {
  CONTEXT_PACK_GENERATION_REPORT_SCHEMA_VERSION,
  PACK_PREVIEW_MAX_CALL_RELATIONSHIPS,
  PACK_PREVIEW_MAX_EVIDENCE_NOTES,
  PACK_PREVIEW_MAX_FILES,
  PACK_PREVIEW_MAX_SOURCE_LINES_PER_SLICE,
  PACK_PREVIEW_MAX_SOURCE_SLICES,
  PACK_PREVIEW_MAX_SYMBOLS,
  PACK_PREVIEW_MAX_TESTS,
  type ContextPackGenerationReportCaseV1,
  type ContextPackGenerationReportPreviewV1,
  type ContextPackGenerationReportV1,
  type ContextPackPreviewListV1,
  type ContextPackPreviewSourceSliceV1
} from "./contextPackGenerationReportModel.js";

/** Fixed wording: observed evidence only. */
export const CONTEXT_PACK_GENERATION_LIMITATIONS: readonly string[] = [
  "This is a context-pack experiment over deterministic my-dev-kit workflows; it is not a coding-agent success evaluation.",
  "Estimated tokens come from the existing Lab estimator over rendered text, not provider billing telemetry.",
  "Unavailable and not-applicable values are not converted to zero.",
  "Scope means use matched complete cases only and are unweighted macro means over task instances.",
  "No composite score, ranking, or winning treatment is produced; treatments are reported side by side.",
  "Tests and call relationships in the pack are descriptive and are not scored.",
  "The context pack is an experimental Lab artifact, not the production my-dev-kit context API.",
  "The pack preview is bounded for display only and does not change the stored pack or any measured size."
];

const copyMetric = (metric: RetrievalQualityRatioMetricV1): RetrievalQualityRatioMetricV1 => ({
  availability: metric.availability,
  numerator: metric.numerator,
  denominator: metric.denominator,
  value: metric.value,
  reason: metric.reason
});

const NO_MEASUREMENT: RetrievalQualityRatioMetricV1 = { availability: "unavailable", numerator: null, denominator: null, value: null, reason: "no-retrieval-measurement" };

function bounded<S, T>(source: readonly S[], limit: number, project: (item: S) => T): ContextPackPreviewListV1<T> {
  return { items: source.slice(0, limit).map(project), totalCount: source.length, omittedCount: Math.max(0, source.length - limit) };
}

/** Display truncation of a stored slice: first lines only. The pack's own `truncated` flag is copied untouched. */
function previewSlice(slice: ContextPack["sourceSlices"][number]): ContextPackPreviewSourceSliceV1 {
  const lines = slice.text.split("\n");
  const shown = lines.slice(0, PACK_PREVIEW_MAX_SOURCE_LINES_PER_SLICE);
  return {
    file: slice.file,
    symbolName: slice.symbolName,
    startLine: slice.startLine,
    endLine: slice.endLine,
    lineCount: slice.lineCount,
    boundaryKnown: slice.boundaryKnown,
    truncated: slice.truncated,
    previewText: shown.join("\n"),
    previewLineCount: shown.length,
    previewTruncated: lines.length > shown.length
  };
}

function buildPreview(entry: ContextPackGenerationCaseEvidenceV1, pack: ContextPack | undefined): ContextPackGenerationReportPreviewV1 {
  const packTreatment = entry.treatments.find((treatment) => treatment.treatmentId === "context-pack");
  const packArtifactPath = packTreatment?.packArtifactPath ?? null;
  const base = {
    caseId: entry.caseId,
    packArtifactPath,
    // Section summaries are persisted execution evidence; they never come from the preview truncation.
    sections: (packTreatment?.sections ?? []).map((section) => ({
      id: section.id,
      availability: section.availability,
      reason: section.reason,
      itemCount: section.itemCount,
      estimatedTokens: section.estimatedTokens
    }))
  };
  if (!pack) {
    return {
      ...base,
      status: packArtifactPath === null ? "no-pack-produced" : "pack-artifact-unavailable",
      packAvailability: packTreatment?.availability ?? null,
      task: null,
      files: null,
      symbols: null,
      sourceSlices: null,
      callRelationships: null,
      tests: null,
      evidenceNotes: null
    };
  }
  return {
    ...base,
    status: "available",
    packAvailability: pack.availability,
    task: { title: pack.task.title, summary: pack.task.summary },
    files: bounded(pack.files, PACK_PREVIEW_MAX_FILES, (file) => ({ path: file.path, rank: file.rank, reason: file.reason })),
    symbols: bounded(pack.symbols, PACK_PREVIEW_MAX_SYMBOLS, (symbol) => ({ name: symbol.name, file: symbol.file, line: symbol.line, nodeId: symbol.nodeId })),
    sourceSlices: bounded(pack.sourceSlices, PACK_PREVIEW_MAX_SOURCE_SLICES, previewSlice),
    callRelationships: bounded(
      pack.callRelationships.filter((relationship) => relationship.kind === "calls"),
      PACK_PREVIEW_MAX_CALL_RELATIONSHIPS,
      (relationship) => ({ fromNodeId: relationship.fromNodeId, toNodeId: relationship.toNodeId })
    ),
    tests: bounded(pack.tests, PACK_PREVIEW_MAX_TESTS, (test) => ({ path: test.path, how: test.how })),
    evidenceNotes: bounded(pack.evidenceNotes, PACK_PREVIEW_MAX_EVIDENCE_NOTES, (code) => code)
  };
}

/**
 * Presentation-only adapter over the already-calculated `run.analysis` and `run.caseExecutionEvidence`. It recalculates no
 * F1, fact coverage, token size, saving, matched-case membership, mean or delta; it copies persisted values. `contextPacks`
 * are the persisted per-case pack artifacts, loaded by the caller; only display truncation is derived from them.
 */
export function buildContextPackGenerationReport(
  run: ExperimentRun,
  contextPacks: ReadonlyMap<string, ContextPack> = new Map()
): ContextPackGenerationReportV1 | null {
  if (run.pluginId !== CONTEXT_PACK_GENERATION_PLUGIN_ID) return null;

  const candidate = run as Partial<ContextPackGenerationRun>;
  const analysis = candidate.analysis;
  const execution = candidate.caseExecutionEvidence;
  if (!analysis || !execution) {
    // A run that failed before analysis exists still gets the generic failure report.
    if (run.status === "failed") return null;
    throw new Error("Invalid context-pack-generation report source: execution evidence and analysis are required.");
  }
  const inconsistent =
    analysis.cases.length !== execution.length ||
    analysis.cases.some(
      (entry, index) =>
        entry.caseId !== execution[index].caseId ||
        entry.treatments.length !== CONTEXT_PACK_GENERATION_TREATMENT_IDS.length ||
        entry.treatments.some((treatment, position) => treatment.treatmentId !== CONTEXT_PACK_GENERATION_TREATMENT_IDS[position])
    );
  if (inconsistent) {
    throw new Error("Invalid context-pack-generation report source: execution evidence and analysis are inconsistent.");
  }

  const cases: ContextPackGenerationReportCaseV1[] = analysis.cases.map((entry, caseIndex) => ({
    caseId: entry.caseId,
    caseName: execution[caseIndex].caseName,
    benchmarkProject: entry.benchmarkProject,
    taskLocality: entry.taskLocality,
    treatments: entry.treatments.map((treatment) => ({
      treatmentId: treatment.treatmentId,
      executionStatus: treatment.executionStatus,
      availability: treatment.availability,
      fileF1: copyMetric(treatment.fileF1),
      symbolF1: copyMetric(treatment.symbolF1),
      factCoverage: treatment.quality ? copyMetric(treatment.quality.fact.coverage) : { ...NO_MEASUREMENT },
      estimatedTokens: treatment.estimatedTokens,
      tokenCountMethod: treatment.tokenCountMethod
    })),
    comparison: { ...entry.comparison }
  }));

  return {
    schemaVersion: CONTEXT_PACK_GENERATION_REPORT_SCHEMA_VERSION,
    experiment: { pluginId: run.pluginId, target: run.target.isSelf ? "self" : "external target" },
    treatmentOrder: [...CONTEXT_PACK_GENERATION_TREATMENT_IDS],
    methodology: { ...CONTEXT_PACK_GENERATION_METHODOLOGY },
    cases,
    scopes: structuredClone(analysis.scopes),
    previews: execution.map((entry) => buildPreview(entry, contextPacks.get(entry.caseId))),
    // Execution/analysis artifacts live directly in the output root; never expose a machine-local absolute path.
    artifacts: run.artifacts.map((artifact) => ({
      id: artifact.id,
      path: artifact.path ? (path.isAbsolute(artifact.path) ? path.basename(artifact.path) : artifact.path) : null,
      caseId: artifact.caseId ?? null
    })),
    limitations: [...CONTEXT_PACK_GENERATION_LIMITATIONS]
  };
}
