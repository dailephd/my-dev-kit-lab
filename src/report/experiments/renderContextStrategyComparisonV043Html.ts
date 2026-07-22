import type {
  ContextStrategyComparisonV043ReportV1,
  ContextStrategyComparisonV043StrategyReportV1,
  V043BoundedReportListV1,
  V043ReportCountMetricV1,
  V043ReportRatioMetricV1,
} from "./contextStrategyComparisonV043ReportModel.js";

function escapeHtml(value: unknown): string {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function table(headers: string[], rows: string[][]): string {
  return `<table><thead><tr>${headers.map((header) => `<th>${escapeHtml(header)}</th>`).join("")}</tr></thead><tbody>${rows
    .map((row) => `<tr>${row.map((cell) => `<td>${escapeHtml(cell)}</td>`).join("")}</tr>`)
    .join("")}</tbody></table>`;
}

function boundedListNote(list: V043BoundedReportListV1<unknown>): string {
  return `<p class="muted">Displayed ${list.displayedCount} of ${list.totalCount} (omitted ${list.omittedCount}).</p>`;
}

function renderRatioMetricTable(label: string, metric: V043ReportRatioMetricV1): string {
  if (metric.availability !== "available") {
    return `<h4>${escapeHtml(label)}</h4>${table(
      ["Availability", "Reason"],
      [[metric.availability, metric.reason ?? ""]]
    )}`;
  }
  return `<h4>${escapeHtml(label)}</h4>${table(
    ["Availability", "Numerator", "Denominator", "Rate", "Percentage"],
    [
      [
        metric.availability,
        String(metric.numerator),
        String(metric.denominator),
        String(metric.rate),
        `${String((metric.rate as number) * 100)}%`,
      ],
    ]
  )}`;
}

function renderCountMetricTable(label: string, metric: V043ReportCountMetricV1): string {
  if (metric.availability !== "available") {
    return `<h4>${escapeHtml(label)}</h4>${table(
      ["Availability", "Reason"],
      [[metric.availability, metric.reason ?? ""]]
    )}`;
  }
  return `<h4>${escapeHtml(label)}</h4>${table(["Availability", "Count"], [[metric.availability, String(metric.count)]])}`;
}

function renderStrategySection(strategy: ContextStrategyComparisonV043StrategyReportV1, index: number): string {
  const artifactRows = strategy.artifacts.items.map((artifact) => [
    artifact.sourceInstance,
    artifact.artifactKind,
    artifact.sourcePath,
    artifact.schemaVersion,
    artifact.role ?? "",
  ]);

  const executionIssueRows = strategy.execution.issues.items.map((issue) => [
    issue.code,
    issue.fieldPath ?? "",
    issue.message,
  ]);

  const expectationMatchRows = strategy.evaluation.expectationMatches.items.map((match) => [
    match.expectationId,
    match.inclusion,
    match.sourceArtifact,
    match.category,
    match.targetKey,
    match.outcome,
  ]);

  const observedEvidenceRows = strategy.evaluation.observedEvidence.items.map((evidence) => [
    evidence.sourceArtifact,
    evidence.sourceInstance,
    evidence.category,
    evidence.targetKey,
    evidence.sourceFieldPath,
  ]);

  const metricsHtml = strategy.evaluation.metrics
    ? `
    ${renderRatioMetricTable("Required Evidence Recall", strategy.evaluation.metrics.requiredEvidenceRecall)}
    ${renderRatioMetricTable("Allowed Evidence Coverage", strategy.evaluation.metrics.allowedEvidenceCoverage)}
    ${renderRatioMetricTable("Forbidden Evidence Inclusion", strategy.evaluation.metrics.forbiddenEvidenceInclusion)}
    ${renderCountMetricTable("Irrelevant File Inclusion", strategy.evaluation.metrics.irrelevantFileInclusion)}
    ${renderCountMetricTable("Irrelevant Instruction Inclusion", strategy.evaluation.metrics.irrelevantInstructionInclusion)}
    ${renderRatioMetricTable("Required Provenance Recall", strategy.evaluation.metrics.requiredProvenanceRecall)}
    ${renderCountMetricTable("Considered But Unselected Reads", strategy.evaluation.metrics.consideredButUnselectedReads)}
    ${renderCountMetricTable("Unnecessary Reads", strategy.evaluation.metrics.unnecessaryReads)}
    ${renderCountMetricTable("Target Immutability (Evaluation)", strategy.evaluation.metrics.targetImmutability)}
    <h4>Responsibility Mapping</h4>
    ${boundedListNote(strategy.evaluation.metrics.responsibilityMappingCompleteness)}
    ${table(
      ["Source", "Instance", "Requested", "Operational", "Mapped", "Partially Mapped", "Unmapped", "Not Applicable", "Denominator", "Mapped Rate"],
      strategy.evaluation.metrics.responsibilityMappingCompleteness.items.map((mapping) => [
        mapping.sourceArtifact,
        mapping.sourceInstance,
        String(mapping.requested),
        String(mapping.operational),
        String(mapping.mappedCount),
        String(mapping.partiallyMappedCount),
        String(mapping.unmappedCount),
        String(mapping.notApplicableCount),
        String(mapping.denominator),
        String(mapping.mappedRate),
      ])
    )}
    <h4>State Comparisons</h4>
    ${boundedListNote(strategy.evaluation.metrics.stateComparisons)}
    ${table(
      ["Source", "Instance", "Expectation Field", "Artifact Field", "Availability", "Expected", "Actual", "Matched"],
      strategy.evaluation.metrics.stateComparisons.items.map((comparison) => [
        comparison.sourceArtifact,
        comparison.sourceInstance,
        comparison.expectationFieldPath,
        comparison.artifactFieldPath ?? "",
        comparison.availability,
        JSON.stringify(comparison.expected),
        JSON.stringify(comparison.actual),
        String(comparison.matched),
      ])
    )}
    <h4>Context Size</h4>
    ${table(
      ["Total Characters", "Total Estimated Tokens", "Formula"],
      [[
        String(strategy.evaluation.metrics.contextSize.totalCharacterCount),
        String(strategy.evaluation.metrics.contextSize.totalEstimatedTokenCount),
        strategy.evaluation.metrics.contextSize.tokenEstimateFormula,
      ]]
    )}
    ${boundedListNote(strategy.evaluation.metrics.contextSize.sources)}
    ${table(
      ["Instance", "Kind", "Characters", "Estimated Tokens"],
      strategy.evaluation.metrics.contextSize.sources.items.map((source) => [
        source.sourceInstance,
        source.sourceKind,
        String(source.characterCount),
        String(source.estimatedTokenCount),
      ])
    )}`
    : "<p>Metrics unavailable.</p>";

  const targetImmutabilityRows = strategy.assurance.runRecords.items.map((record) => [
    String(record.runNumber),
    record.targetImmutabilityAvailability,
    record.targetImmutabilityStatus ?? "",
    record.newMutationCount === null ? "unavailable" : String(record.newMutationCount),
    record.targetImmutabilityReason ?? "",
  ]);

  const mutationRows = strategy.assurance.runRecords.items.flatMap((record) =>
    record.mutations.items.map((mutation) => [
      String(record.runNumber),
      mutation.id,
      mutation.kind,
      mutation.fieldPath,
      JSON.stringify(mutation.before),
      JSON.stringify(mutation.after),
    ])
  );

  const determinism = strategy.assurance.determinism;
  const determinismRows =
    determinism.availability === "available"
      ? [
          [
            determinism.availability,
            String(determinism.repeatCount),
            String(determinism.deterministic),
            determinism.baselineSha256 ?? "",
            determinism.mismatchRunNumbers.join(", "),
          ],
        ]
      : [[determinism.availability, String(determinism.repeatCount), "", "", determinism.reason ?? ""]];

  const assuranceIssueRows = strategy.assurance.issues.items.map((issue) => [
    issue.code,
    issue.runNumber === null ? "" : String(issue.runNumber),
    issue.fieldPath ?? "",
    issue.message,
  ]);

  return `
  <section>
    <h3>Strategy ${index + 1}: ${escapeHtml(strategy.strategyId)}</h3>

    <h4>Artifacts</h4>
    ${boundedListNote(strategy.artifacts)}
    ${table(["Instance", "Kind", "Path", "Schema", "Role"], artifactRows)}

    <h4>Execution</h4>
    ${table(["Status"], [[strategy.execution.status]])}
    ${boundedListNote(strategy.execution.issues)}
    ${table(["Code", "Field Path", "Message"], executionIssueRows)}

    <h4>Evaluation</h4>
    ${table(["Status", "Reason"], [[strategy.evaluation.status, strategy.evaluation.reason ?? ""]])}
    ${metricsHtml}

    <h4>Expectation Matches</h4>
    ${boundedListNote(strategy.evaluation.expectationMatches)}
    ${table(["Expectation ID", "Inclusion", "Source Artifact", "Category", "Target Key", "Outcome"], expectationMatchRows)}

    <h4>Observed Evidence</h4>
    ${boundedListNote(strategy.evaluation.observedEvidence)}
    ${table(["Source Artifact", "Instance", "Category", "Target Key", "Source Field Path"], observedEvidenceRows)}

    <h4>Target Immutability</h4>
    ${boundedListNote(strategy.assurance.runRecords)}
    ${table(["Run", "Availability", "Status", "New Mutation Count", "Reason"], targetImmutabilityRows)}
    ${table(["Run", "Mutation ID", "Kind", "Field Path", "Before", "After"], mutationRows)}

    <h4>Repeated-Run Determinism</h4>
    ${table(["Availability", "Repeat Count", "Deterministic", "Baseline SHA-256", "Mismatch Run Numbers / Reason"], determinismRows)}
    ${determinism.availability === "available" ? boundedListNote(determinism.runDigests) : ""}
    ${
      determinism.availability === "available"
        ? table(
            ["Run", "SHA-256"],
            determinism.runDigests.items.map((digest) => [String(digest.runNumber), digest.sha256])
          )
        : ""
    }

    <h4>Run Assurance</h4>
    ${table(["Status", "Repeat Count"], [[strategy.assurance.status, String(strategy.assurance.repeatCount)]])}
    ${boundedListNote(strategy.assurance.issues)}
    ${table(["Code", "Run", "Field Path", "Message"], assuranceIssueRows)}
  </section>`;
}

export function renderContextStrategyComparisonV043Html(
  report: ContextStrategyComparisonV043ReportV1 | null
): string {
  if (report === null) {
    return `<section><h2>V0.4.3 Stage-Context Evidence</h2><p>Not applicable to this plugin.</p></section>`;
  }
  if (report.summary.strategyCount === 0) {
    return `<section><h2>V0.4.3 Stage-Context Evidence</h2><p>No v0.4.3 stage-context strategies were selected.</p></section>`;
  }

  const summaryRows = [
    [
      String(report.summary.strategyCount),
      String(report.summary.completedExecutionCount),
      String(report.summary.invalidInputExecutionCount),
      String(report.summary.failedExecutionCount),
      String(report.summary.completedEvaluationCount),
      String(report.summary.notApplicableEvaluationCount),
      String(report.summary.failedEvaluationCount),
      String(report.summary.passedAssuranceCount),
      String(report.summary.failedAssuranceCount),
      String(report.summary.notApplicableAssuranceCount),
    ],
  ];

  return `
<section>
  <h2>V0.4.3 Stage-Context Evidence</h2>
  ${table(
    [
      "Strategies",
      "Completed Executions",
      "Invalid-Input Executions",
      "Failed Executions",
      "Completed Evaluations",
      "Not-Applicable Evaluations",
      "Failed Evaluations",
      "Passed Assurance",
      "Failed Assurance",
      "Not-Applicable Assurance",
    ],
    summaryRows
  )}
  <p>${escapeHtml(report.interpretation.summary)}</p>
  <ul>
    ${report.interpretation.limitations.map((limitation) => `<li>${escapeHtml(limitation)}</li>`).join("")}
  </ul>
  ${report.strategies.map((strategy, index) => renderStrategySection(strategy, index)).join("")}
</section>`;
}
