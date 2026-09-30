import type { ContextWindowScalingReportV1 } from "./contextWindowScalingReportModel.js";

// Render-time formatting only; the JSON report keeps exact unrounded values.
// Rule: percent values use 2 decimals plus "%", correctness scores use 4 decimals, null is "unavailable".
export function formatContextWindowScalingPercent(value: number | null): string {
  return value === null ? "unavailable" : `${value.toFixed(2)}%`;
}

export function formatContextWindowScalingScore(value: number | null): string {
  return value === null ? "unavailable" : value.toFixed(4);
}

export function formatContextWindowScalingCount(value: number | null): string {
  return value === null ? "unavailable" : String(value);
}

function clean(value: unknown): string {
  return String(value).replace(/[\u0000-\u001f\u007f]/g, " ");
}

function row(parts: Array<[string, unknown]>): string {
  return `- ${parts.map(([label, value]) => `${label}: ${clean(value)}`).join(" | ")}`;
}

/** Lines for the "Context Window Scaling" section; every value comes from the report model. */
export function renderContextWindowScalingTextLines(section: ContextWindowScalingReportV1): string[] {
  const lines: string[] = [];
  lines.push(`Schema: ${clean(section.schemaVersion)}`);
  lines.push(`Budgets (estimated context tokens): ${section.budgets.join(", ")}`);
  lines.push(`Treatments: ${section.treatments.join(", ")}`);
  lines.push(`Token Count Method: ${clean(section.tokenCountMethod ?? "unavailable")}`);

  lines.push("Run Summary:");
  const summary = section.runSummary;
  for (const [label, value] of Object.entries(summary)) {
    lines.push(`${label}: ${value}`);
  }

  lines.push("Budget Summary (one row per budget and treatment):");
  for (const s of section.budgetTreatmentSummaries) {
    lines.push(
      row([
        ["Budget", s.contextBudgetTokens],
        ["Treatment", s.variantId],
        ["Cells", s.totalCellCount],
        ["Fits", s.fitCount],
        ["Too Large", s.contextTooLargeCount],
        ["Context Unavailable", s.contextUnavailableCount],
        ["Success", s.successfulCellCount],
        ["Not Successful", s.notSuccessfulCellCount],
        ["Success Unavailable", s.successEvidenceUnavailableCount],
        ["Success Rate", formatContextWindowScalingPercent(s.successRatePercent)],
        ["Correctness Available", s.correctnessAvailableCount],
        ["Mean Correctness", formatContextWindowScalingScore(s.meanCorrectnessScore)],
        ["Mean Utilization", formatContextWindowScalingPercent(s.meanContextBudgetUtilizationPercent)],
        ["Min Utilization", formatContextWindowScalingPercent(s.minContextBudgetUtilizationPercent)],
        ["Max Utilization", formatContextWindowScalingPercent(s.maxContextBudgetUtilizationPercent)],
      ])
    );
  }

  lines.push("Case Context Evidence (one row per case and treatment; context does not vary by budget):");
  for (const c of section.caseTreatmentContexts) {
    lines.push(
      row([
        ["Case", c.caseId],
        ["Treatment", c.variantId],
        ["Context", c.contextStatus],
        ["Characters", formatContextWindowScalingCount(c.characterCount)],
        ["Estimated Tokens", formatContextWindowScalingCount(c.estimatedTokens)],
        ["Token Method", c.tokenCountMethod ?? "unavailable"],
        ["Observed Files", formatContextWindowScalingCount(c.observedFileCount)],
        ["Relevant File Evidence", c.relevantFileStatus],
        ["Expected Relevant Files", c.expectedRelevantFileCount],
        ["Observed Expected Files", formatContextWindowScalingCount(c.observedExpectedFileCount)],
        ["Omitted Relevant Files", formatContextWindowScalingCount(c.omittedRelevantFileCount)],
      ])
    );
  }

  lines.push("Omitted Relevant Files (benchmark-expected files not observed in the treatment context):");
  lines.push(
    row([
      ["Evidence Available", section.relevantFileSummary.relevantFileEvidenceAvailableCount],
      ["Unavailable", section.relevantFileSummary.relevantFileEvidenceUnavailableCount],
      ["Not Applicable", section.relevantFileSummary.relevantFileEvidenceNotApplicableCount],
      ["Total Omitted", section.relevantFileSummary.totalOmittedRelevantFileCount],
    ])
  );
  for (const c of section.caseTreatmentContexts) {
    if (c.relevantFileStatus === "available" && (c.omittedRelevantFileCount ?? 0) > 0) {
      const list = c.omittedRelevantFiles;
      lines.push(
        `${clean(c.caseId)} / ${c.variantId}: omitted ${list.totalCount}; displayed ${list.displayedCount} of ${list.totalCount}; omitted from display ${list.omittedCount}; truncated ${list.truncated ? "yes" : "no"}`
      );
      for (const file of list.items) {
        lines.push(`  - ${clean(file)}`);
      }
    } else if (c.relevantFileStatus !== "available" && c.relevantFileReason) {
      lines.push(`${clean(c.caseId)} / ${c.variantId}: ${c.relevantFileStatus} (${clean(c.relevantFileReason)})`);
    }
  }

  lines.push("Per-Case Budget Matrix (one row per case, treatment, and budget):");
  for (const cell of section.caseBudgetCells) {
    lines.push(
      row([
        ["Case", cell.caseId],
        ["Treatment", cell.variantId],
        ["Budget", cell.contextBudgetTokens],
        ["Estimated Context Tokens", formatContextWindowScalingCount(cell.contextEstimatedTokens)],
        ["Fit", cell.contextFitStatus],
        ["Utilization", formatContextWindowScalingPercent(cell.contextBudgetUtilizationPercent)],
        ["Evaluation", cell.evaluationStatus],
        ["Correctness", cell.correctness.availability],
        ["Correctness Score", formatContextWindowScalingScore(cell.correctness.score)],
        ["Correctness Pass", cell.correctness.pass === null ? "unavailable" : cell.correctness.pass],
        ["Success Evidence", cell.successEvidence.status],
        ["Success", cell.successEvidence.success === null ? "unavailable" : cell.successEvidence.success],
        ["Success Reason", cell.successEvidence.reason],
      ])
    );
  }

  lines.push("Interpretation And Limitations:");
  for (const item of section.interpretation) {
    lines.push(`- ${clean(item)}`);
  }
  return lines;
}
