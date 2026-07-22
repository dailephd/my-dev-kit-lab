import type { PluginExperimentReport } from "./experimentReportModel.js";
import type {
  ContextStrategyComparisonV043ReportV1,
  ContextStrategyComparisonV043StrategyReportV1,
  V043BoundedReportListV1,
  V043ReportCountMetricV1,
  V043ReportRatioMetricV1,
} from "./contextStrategyComparisonV043ReportModel.js";

function sanitizeScalar(value: unknown): string {
  const text = String(value);
  let result = "";
  for (const ch of text) {
    const code = ch.codePointAt(0) ?? 0;
    if (code === 13 || code === 10 || code === 9) {
      result += " ";
      continue;
    }
    if (code <= 8) continue;
    if (code === 11 || code === 12) continue;
    if (code >= 14 && code <= 31) continue;
    if (code === 127) continue;
    result += ch;
  }
  return result;
}

function fieldLine(label: string, value: unknown): string {
  if (value === null || value === undefined) return `${label}: unavailable`;
  return `${label}: ${sanitizeScalar(value)}`;
}

function pushSection(lines: string[], title: string): void {
  lines.push(title);
}

function pushDashList(lines: string[], items: string[]): void {
  if (items.length === 0) {
    lines.push("- none");
    return;
  }
  for (const item of items) {
    lines.push(`- ${sanitizeScalar(item)}`);
  }
}

function pushBoundedList<T>(lines: string[], list: V043BoundedReportListV1<T>, renderItem: (item: T) => string): void {
  lines.push(`Displayed: ${list.displayedCount} of ${list.totalCount}`);
  lines.push(`Omitted: ${list.omittedCount}`);
  if (list.totalCount === 0) {
    lines.push("- none");
    return;
  }
  for (const item of list.items) {
    lines.push(`- ${sanitizeScalar(renderItem(item))}`);
  }
}

function pushRatioMetric(lines: string[], label: string, metric: V043ReportRatioMetricV1): void {
  lines.push(label);
  lines.push(`Availability: ${metric.availability}`);
  if (metric.availability === "available") {
    lines.push(`Numerator: ${metric.numerator}`);
    lines.push(`Denominator: ${metric.denominator}`);
    lines.push(`Rate: ${metric.rate}`);
    lines.push(`Percentage: ${String((metric.rate as number) * 100)}%`);
  } else {
    lines.push(`Reason: ${sanitizeScalar(metric.reason ?? "")}`);
  }
  lines.push("Matched Expectation IDs:");
  pushBoundedList(lines, metric.matchedExpectationIds, (id) => id);
  lines.push("Missing Expectation IDs:");
  pushBoundedList(lines, metric.missingExpectationIds, (id) => id);
}

function pushCountMetric(lines: string[], label: string, metric: V043ReportCountMetricV1): void {
  lines.push(label);
  lines.push(`Availability: ${metric.availability}`);
  if (metric.availability === "available") {
    lines.push(`Count: ${metric.count}`);
  } else {
    lines.push(`Reason: ${sanitizeScalar(metric.reason ?? "")}`);
  }
  lines.push("Evidence Keys:");
  pushBoundedList(lines, metric.evidenceKeys, (key) => key);
}

function renderStrategy(lines: string[], strategy: ContextStrategyComparisonV043StrategyReportV1, index: number): void {
  pushSection(lines, `Strategy ${index + 1}: ${strategy.strategyId}`);

  pushSection(lines, "Artifacts");
  pushBoundedList(lines, strategy.artifacts, (artifact) =>
    `${artifact.sourceInstance} [${artifact.artifactKind}] path=${artifact.sourcePath} schema=${artifact.schemaVersion}`
  );

  pushSection(lines, "Execution");
  lines.push(fieldLine("Status", strategy.execution.status));
  lines.push("Issues:");
  pushBoundedList(lines, strategy.execution.issues, (issue) => `${issue.code} ${issue.fieldPath ?? ""} ${issue.message}`);

  pushSection(lines, "Evaluation Metrics");
  lines.push(fieldLine("Status", strategy.evaluation.status));
  lines.push(fieldLine("Reason", strategy.evaluation.reason));
  lines.push("Warnings:");
  pushBoundedList(lines, strategy.evaluation.warnings, (warning) => warning);
  if (strategy.evaluation.metrics) {
    const metrics = strategy.evaluation.metrics;
    pushRatioMetric(lines, "Required Evidence Recall", metrics.requiredEvidenceRecall);
    pushRatioMetric(lines, "Allowed Evidence Coverage", metrics.allowedEvidenceCoverage);
    pushRatioMetric(lines, "Forbidden Evidence Inclusion", metrics.forbiddenEvidenceInclusion);
    pushCountMetric(lines, "Irrelevant File Inclusion", metrics.irrelevantFileInclusion);
    pushCountMetric(lines, "Irrelevant Instruction Inclusion", metrics.irrelevantInstructionInclusion);
    pushRatioMetric(lines, "Required Provenance Recall", metrics.requiredProvenanceRecall);
    pushCountMetric(lines, "Considered But Unselected Reads", metrics.consideredButUnselectedReads);
    pushCountMetric(lines, "Unnecessary Reads", metrics.unnecessaryReads);
    pushCountMetric(lines, "Target Immutability (Evaluation)", metrics.targetImmutability);
  }

  pushSection(lines, "Expectation Matches");
  pushBoundedList(lines, strategy.evaluation.expectationMatches, (match) =>
    `${match.expectationId} inclusion=${match.inclusion} outcome=${match.outcome} sourceArtifact=${match.sourceArtifact} targetKey=${match.targetKey}`
  );

  pushSection(lines, "Observed Evidence");
  pushBoundedList(lines, strategy.evaluation.observedEvidence, (evidence) =>
    `${evidence.sourceArtifact}.${evidence.sourceInstance} category=${evidence.category} targetKey=${evidence.targetKey} field=${evidence.sourceFieldPath}`
  );

  pushSection(lines, "State Comparisons");
  if (strategy.evaluation.metrics) {
    pushBoundedList(lines, strategy.evaluation.metrics.stateComparisons, (comparison) =>
      `${comparison.sourceArtifact}.${comparison.sourceInstance} expectationFieldPath=${comparison.expectationFieldPath} artifactFieldPath=${comparison.artifactFieldPath ?? "null"} availability=${comparison.availability} expected=${JSON.stringify(comparison.expected)} actual=${JSON.stringify(comparison.actual)} matched=${comparison.matched}`
    );
  } else {
    lines.push("Displayed: 0 of 0");
    lines.push("Omitted: 0");
    lines.push("- none");
  }

  pushSection(lines, "Responsibility Mapping");
  if (strategy.evaluation.metrics) {
    pushBoundedList(lines, strategy.evaluation.metrics.responsibilityMappingCompleteness, (mapping) =>
      `${mapping.sourceArtifact}.${mapping.sourceInstance} requested=${mapping.requested} operational=${mapping.operational} mapped=${mapping.mappedCount} partiallyMapped=${mapping.partiallyMappedCount} unmapped=${mapping.unmappedCount} notApplicable=${mapping.notApplicableCount} denominator=${mapping.denominator} mappedRate=${mapping.mappedRate}`
    );
  } else {
    lines.push("Displayed: 0 of 0");
    lines.push("Omitted: 0");
    lines.push("- none");
  }

  pushSection(lines, "Context Size");
  if (strategy.evaluation.metrics) {
    const size = strategy.evaluation.metrics.contextSize;
    lines.push(fieldLine("Total Character Count", size.totalCharacterCount));
    lines.push(fieldLine("Total Estimated Token Count (estimate)", size.totalEstimatedTokenCount));
    lines.push(fieldLine("Token Estimate Formula", size.tokenEstimateFormula));
    pushBoundedList(lines, size.sources, (source) =>
      `${source.sourceInstance} kind=${source.sourceKind} characters=${source.characterCount} estimatedTokens=${source.estimatedTokenCount}`
    );
  } else {
    lines.push("Displayed: 0 of 0");
    lines.push("Omitted: 0");
    lines.push("- none");
  }

  pushSection(lines, "Target Immutability");
  pushBoundedList(lines, strategy.assurance.runRecords, (record) => {
    if (record.targetImmutabilityAvailability === "unavailable") {
      return `run=${record.runNumber} availability=unavailable reason=${record.targetImmutabilityReason ?? ""}`;
    }
    return `run=${record.runNumber} availability=available status=${record.targetImmutabilityStatus} newMutationCount=${record.newMutationCount} mutations=${record.mutations.totalCount}`;
  });

  pushSection(lines, "Repeated-Run Determinism");
  const determinism = strategy.assurance.determinism;
  lines.push(fieldLine("Availability", determinism.availability));
  lines.push(fieldLine("Repeat Count", determinism.repeatCount));
  if (determinism.availability === "available") {
    lines.push(fieldLine("Deterministic", determinism.deterministic));
    lines.push(fieldLine("Baseline SHA-256", determinism.baselineSha256));
    lines.push("Run Digests:");
    pushBoundedList(lines, determinism.runDigests, (digest) => `run=${digest.runNumber} sha256=${digest.sha256}`);
    lines.push(`Mismatch Run Numbers: ${determinism.mismatchRunNumbers.join(", ") || "none"}`);
  } else {
    lines.push(fieldLine("Reason", determinism.reason));
  }

  pushSection(lines, "Run Assurance");
  lines.push(fieldLine("Status", strategy.assurance.status));
  lines.push(fieldLine("Repeat Count", strategy.assurance.repeatCount));
  lines.push("Issues:");
  pushBoundedList(lines, strategy.assurance.issues, (issue) =>
    `${issue.code} run=${issue.runNumber ?? ""} field=${issue.fieldPath ?? ""} ${issue.message}`
  );
}

function renderV043Section(lines: string[], section: ContextStrategyComparisonV043ReportV1 | null): void {
  if (section === null) {
    lines.push("Not applicable to this plugin.");
    return;
  }
  if (section.summary.strategyCount === 0) {
    lines.push("No v0.4.3 stage-context strategies were selected.");
    return;
  }
  lines.push(fieldLine("Strategy Count", section.summary.strategyCount));
  lines.push(fieldLine("Completed Executions", section.summary.completedExecutionCount));
  lines.push(fieldLine("Invalid-Input Executions", section.summary.invalidInputExecutionCount));
  lines.push(fieldLine("Failed Executions", section.summary.failedExecutionCount));
  lines.push(fieldLine("Completed Evaluations", section.summary.completedEvaluationCount));
  lines.push(fieldLine("Not-Applicable Evaluations", section.summary.notApplicableEvaluationCount));
  lines.push(fieldLine("Failed Evaluations", section.summary.failedEvaluationCount));
  lines.push(fieldLine("Passed Assurance", section.summary.passedAssuranceCount));
  lines.push(fieldLine("Failed Assurance", section.summary.failedAssuranceCount));
  lines.push(fieldLine("Not-Applicable Assurance", section.summary.notApplicableAssuranceCount));
  lines.push(fieldLine("Interpretation Summary", section.interpretation.summary));
  lines.push("Limitations:");
  pushDashList(lines, section.interpretation.limitations);
  for (let index = 0; index < section.strategies.length; index += 1) {
    renderStrategy(lines, section.strategies[index], index);
  }
}

export function renderPluginExperimentReportText(report: PluginExperimentReport): string {
  const lines: string[] = [];

  pushSection(lines, "Plugin Experiment Report");

  pushSection(lines, "Report Metadata");
  lines.push(fieldLine("Generated At", report.metadata.generatedAt));
  lines.push(fieldLine("Run ID", report.metadata.runId));
  lines.push(fieldLine("Started At", report.metadata.startedAt));
  lines.push(fieldLine("Completed At", report.metadata.completedAt));
  lines.push(fieldLine("Status", report.metadata.status));
  lines.push(fieldLine("Output Root", report.metadata.outputRoot));

  pushSection(lines, "Plugin And Target");
  lines.push(fieldLine("Plugin ID", report.plugin.id));
  lines.push(fieldLine("Plugin Name", report.plugin.name));
  lines.push(fieldLine("Plugin Schema Version", report.plugin.schemaVersion));
  lines.push(fieldLine("Mode", report.target.mode));
  lines.push(fieldLine("Tool Root", report.target.toolRoot));
  lines.push(fieldLine("Target Root", report.target.targetRoot));

  pushSection(lines, "Interpretation");
  lines.push(fieldLine("Summary", report.interpretation.summary));
  lines.push(fieldLine("Recommended Next Step", report.interpretation.recommendedNextStep));

  pushSection(lines, "Variants");
  pushDashList(
    lines,
    report.variants.map(
      (variant) =>
        `${variant.name} (${variant.id}) completed=${variant.completedOutcomes} partial=${variant.partialOutcomes} failed=${variant.failedOutcomes} skipped=${variant.skippedOutcomes}`
    )
  );

  pushSection(lines, "Cases");
  pushDashList(
    lines,
    report.cases.map(
      (experimentCase) =>
        `${experimentCase.name} (${experimentCase.id}) status=${experimentCase.status} completed=${experimentCase.completedOutcomes} partial=${experimentCase.partialOutcomes} failed=${experimentCase.failedOutcomes} skipped=${experimentCase.skippedOutcomes}`
    )
  );

  pushSection(lines, "Metrics");
  pushDashList(
    lines,
    report.metrics.map(
      (metric) => `${metric.name} (${metric.id}) value=${metric.value ?? "unavailable"} unit=${metric.unit ?? ""}`
    )
  );

  pushSection(lines, "V0.4.3 Stage-Context Evidence");
  renderV043Section(lines, report.contextStrategyComparisonV043);

  pushSection(lines, "Warnings, Skips, And Failures");
  pushDashList(
    lines,
    report.findings.map(
      (finding) => `${finding.severity} ${finding.code} ${finding.message} variant=${finding.variantId ?? ""} case=${finding.caseId ?? ""}`
    )
  );

  pushSection(lines, "Artifacts");
  pushDashList(
    lines,
    report.artifacts.map((artifact) => `${artifact.label} (${artifact.id}) kind=${artifact.kind} path=${artifact.path ?? ""}`)
  );

  return `${lines.join("\n")}\n`;
}
