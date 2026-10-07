import { formatRetrievalQueryStrategyMetric, formatRetrievalQueryStrategyNumber } from "./renderRetrievalQueryStrategyComparisonText.js";
import type {
  ContextPackGenerationRedactedPreviewV1,
  ContextPackGenerationReportPreviewV1,
  ContextPackGenerationReportV1,
  ContextPackPreviewListV1
} from "./contextPackGenerationReportModel.js";

const formatMean = (value: number | undefined | null): string => (value === undefined || value === null ? "unavailable" : value.toFixed(4));
export const formatContextPackNumber = (value: number | null | undefined): string => formatRetrievalQueryStrategyNumber(value ?? null);
const omitted = (list: ContextPackPreviewListV1<unknown>): string => `shown=${list.items.length} total=${list.totalCount} omitted=${list.omittedCount}`;

const REDACTED_SECTION_LABELS: Record<string, { label: string; what: string } | undefined> = {
  files: { label: "Relevant files", what: "identities redacted" },
  symbols: { label: "Relevant symbols", what: "identities redacted" },
  sourceSlices: { label: "Source slices", what: "content redacted" },
  callRelationships: { label: "Call relationships", what: "identities redacted" },
  tests: { label: "Tests", what: "identities redacted" },
  evidenceNotes: { label: "Evidence notes", what: "counts only" }
};

/**
 * Literal, fixed-text lines for an external-local preview, generated from persisted safe counts only. Shared by the text
 * and HTML renderers so both show identical wording; no identity or source text can reach this function.
 */
export function redactedPreviewDisplayLines(preview: ContextPackGenerationRedactedPreviewV1): string[] {
  const lines = ["Task: title and summary redacted"];
  for (const section of preview.sections) {
    const entry = REDACTED_SECTION_LABELS[section.id];
    if (!entry) continue;
    const truncated = section.truncatedCount !== null ? `, ${section.truncatedCount} truncated by experiment policy` : "";
    lines.push(`${entry.label}: ${section.itemCount} ${section.itemCount === 1 ? "item" : "items"}${truncated} — ${entry.what}`);
  }
  return lines;
}

function redactedPreviewLines(preview: ContextPackGenerationRedactedPreviewV1): string[] {
  const lines = [`Pack preview: case=${preview.caseId} status=${preview.status} packAvailability=${preview.packAvailability ?? "unavailable"}`];
  for (const section of preview.sections) {
    lines.push(`  section ${section.id}: availability=${section.availability} items=${section.itemCount} estimatedTokens=${section.estimatedTokens}${section.reason ? ` reason=${section.reason}` : ""}`);
  }
  for (const [index, line] of redactedPreviewDisplayLines(preview).entries()) lines.push(`  ${index + 1}. ${line}`);
  return lines;
}

function previewLines(preview: ContextPackGenerationReportPreviewV1): string[] {
  if (preview.status === "redacted-external-local") return redactedPreviewLines(preview);
  const lines = [`Pack preview: case=${preview.caseId} status=${preview.status} packAvailability=${preview.packAvailability ?? "unavailable"}`];
  for (const section of preview.sections) {
    lines.push(`  section ${section.id}: availability=${section.availability} items=${section.itemCount} estimatedTokens=${section.estimatedTokens}${section.reason ? ` reason=${section.reason}` : ""}`);
  }
  if (preview.task === null) return lines;
  lines.push(`  1. Task: ${preview.task.title}`, `     ${preview.task.summary}`);
  lines.push(`  2. Relevant files (${omitted(preview.files!)})`);
  for (const file of preview.files!.items) lines.push(`     - ${file.path} rank=${file.rank} reason=${file.reason}`);
  lines.push(`  3. Relevant symbols (${omitted(preview.symbols!)})`);
  for (const symbol of preview.symbols!.items) lines.push(`     - ${symbol.name} file=${symbol.file ?? "unknown"} line=${symbol.line ?? "unknown"}`);
  lines.push(`  4. Source slices (${omitted(preview.sourceSlices!)})`);
  for (const slice of preview.sourceSlices!.items) {
    lines.push(
      `     - ${slice.file}:${slice.startLine}-${slice.endLine} boundaryKnown=${slice.boundaryKnown} policyTruncated=${slice.truncated} previewTruncated=${slice.previewTruncated} (showing ${slice.previewLineCount} of ${slice.lineCount} lines)`
    );
    for (const sourceLine of slice.previewText.split("\n")) lines.push(`         | ${sourceLine}`);
  }
  lines.push(`  5. Call relationships (${omitted(preview.callRelationships!)})`);
  for (const call of preview.callRelationships!.items) lines.push(`     - ${call.fromNodeId} calls ${call.toNodeId}`);
  lines.push(`  6. Tests (${omitted(preview.tests!)})`);
  for (const test of preview.tests!.items) lines.push(`     - ${test.path} how=${test.how}`);
  lines.push(`  7. Evidence notes (${omitted(preview.evidenceNotes!)})`);
  for (const note of preview.evidenceNotes!.items) lines.push(`     - ${note}`);
  return lines;
}

export function renderContextPackGenerationTextLines(section: ContextPackGenerationReportV1): string[] {
  const lines: string[] = [];
  lines.push(`Schema: ${section.schemaVersion}`);
  lines.push(`Experiment: ${section.experiment.pluginId} target=${section.experiment.target}`);
  lines.push(`Treatment order: ${section.treatmentOrder.join(", ")}`);
  lines.push(`Methodology: fileF1=${section.methodology.fileF1} symbolF1=${section.methodology.symbolF1} aggregation=${section.methodology.aggregation} comparison=${section.methodology.treatmentComparison} size=${section.methodology.sizeMeasure}`);

  lines.push("", "Per-Case Treatments");
  for (const entry of section.cases) {
    for (const treatment of entry.treatments) {
      lines.push(
        `- case=${entry.caseId} project=${entry.benchmarkProject} taskType=${entry.taskLocality ?? "unavailable"} treatment=${treatment.treatmentId} status=${treatment.executionStatus} availability=${treatment.availability ?? "unavailable"} fileF1=${formatRetrievalQueryStrategyMetric(treatment.fileF1)} symbolF1=${formatRetrievalQueryStrategyMetric(treatment.symbolF1)} factCoverage=${formatRetrievalQueryStrategyMetric(treatment.factCoverage)} estimatedTokens=${formatContextPackNumber(treatment.estimatedTokens)}`
      );
    }
    const c = entry.comparison;
    lines.push(
      `  paired case=${entry.caseId} fileF1Delta=${formatMean(c.fileF1Delta)} symbolF1Delta=${formatMean(c.symbolF1Delta)} factCoverageDelta=${formatMean(c.factCoverageDelta)} estimatedTokenDelta=${formatContextPackNumber(c.estimatedTokenDelta)} tokensSaved=${formatContextPackNumber(c.tokensSaved)} percentSaved=${formatMean(c.percentSaved)}`
    );
  }

  lines.push("", "Scope Aggregates");
  for (const scope of section.scopes) {
    lines.push(`Scope ${scope.scopeId}: cases=${scope.caseCount} included=${scope.includedCaseCount} excluded=${scope.excludedCaseCount} includedIds=${scope.includedCaseIds.join(", ") || "none"} excludedIds=${scope.excludedCaseIds.join(", ") || "none"}`);
    for (const summary of scope.treatmentSummaries) {
      const o = summary.objectives;
      lines.push(
        `- ${summary.treatmentId} completed=${summary.completedCaseCount} partial=${summary.partialCaseCount} failed=${summary.failedCaseCount} meanFileF1=${formatMean(o?.meanFileF1)} meanSymbolF1=${formatMean(o?.meanSymbolF1)} meanFactCoverage=${formatMean(o?.meanFactCoverage)} meanEstimatedTokens=${formatContextPackNumber(o?.meanEstimatedTokenCount)}`
      );
    }
    const d = scope.pairedDeltas;
    lines.push(
      `  paired meanFileF1Delta=${formatMean(d?.meanFileF1Delta)} meanSymbolF1Delta=${formatMean(d?.meanSymbolF1Delta)} meanFactCoverageDelta=${formatMean(d?.meanFactCoverageDelta)} meanEstimatedTokenDelta=${formatContextPackNumber(d?.meanEstimatedTokenDelta)} meanTokensSaved=${formatContextPackNumber(scope.tokenSavings?.meanTokensSaved)} percentSavedOfMeans=${formatMean(scope.tokenSavings?.percentSavedOfMeans)}`
    );
  }

  lines.push("", "Context Pack Preview (bounded for display; stored packs are unchanged)");
  for (const preview of section.previews) lines.push(...previewLines(preview));

  lines.push("", "Interpretation Limits");
  for (const limitation of section.limitations) lines.push(`- ${limitation}`);
  return lines;
}
