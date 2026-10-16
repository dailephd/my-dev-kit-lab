import { escapeHtml } from "./htmlSafety.js";
import type {
  InvalidOutputStratum,
  PromptTemplateComparisonReportV1,
  SideRate,
  TaskSuccessStratum
} from "./promptTemplateComparisonModel.js";

// Deterministic JSON/text/HTML renderers. Output is a pure function of the report model: no clock, no
// machine-local path, no raw provider response. All HTML text is escaped; the document has no links to
// external resources and no scripts.

export function renderPromptTemplateComparisonJson(report: PromptTemplateComparisonReportV1): string {
  return `${JSON.stringify(report, null, 2)}\n`;
}

function pct(value: number | null): string {
  return value === null ? "unavailable" : `${value.toFixed(2)}%`;
}
function pp(value: number | null): string {
  return value === null ? "unavailable" : `${value >= 0 ? "+" : ""}${value.toFixed(2)} percentage points`;
}
function rateText(rate: SideRate): string {
  return rate.availability === "available" ? `${rate.numerator}/${rate.denominator} = ${pct(rate.ratePercent)}` : `${rate.numerator}/${rate.denominator} = UNAVAILABLE (${rate.reason})`;
}
function reasons(record: Record<string, number>): string {
  const entries = Object.entries(record);
  return entries.length === 0 ? "none" : entries.map(([key, count]) => `${key}=${count}`).join(", ");
}
function successText(basis: TaskSuccessStratum["initial"]): string {
  return `baseline ${basis.baselineSuccessCount}/${basis.denominator}, candidate ${basis.candidateSuccessCount}/${basis.denominator} (both ${basis.bothSucceeded}, only baseline ${basis.onlyBaselineSucceeded}, only candidate ${basis.onlyCandidateSucceeded}, neither ${basis.neitherSucceeded})`;
}

export function renderPromptTemplateComparisonText(report: PromptTemplateComparisonReportV1): string {
  const lines: string[] = [];
  lines.push("Prompt Template Comparison");
  lines.push(`Schema: ${report.schemaVersion}`);
  lines.push(`Comparison status: ${report.comparison.status}`);
  lines.push(`Winner: none declared`);
  lines.push(`Behavioral improvement: ${report.behavioralImprovement.status} - ${report.behavioralImprovement.reason}`);
  lines.push("");
  lines.push("Runs");
  for (const [name, side] of [["Baseline", report.baseline], ["Candidate", report.candidate]] as const) {
    lines.push(`- ${name}: run=${side.runId ?? "unavailable"} provider=${side.providerId ?? "unavailable"} template=${side.templateId ?? "unverified"} basis=${side.promptBasis} contractDigest=${side.promptContractDigest ?? "n/a"} identity=${side.identityDigest ?? "unverified"}`);
  }
  lines.push("");
  lines.push("Comparability criteria");
  if (report.criteria.length === 0) lines.push("- (not evaluated)");
  for (const criterion of report.criteria) lines.push(`- ${criterion.id}: ${criterion.status} - ${criterion.detail}`);
  if (report.comparison.incomparabilityReasons.length > 0) {
    lines.push("");
    lines.push("Incomparability reasons");
    for (const item of report.comparison.incomparabilityReasons) lines.push(`- ${item}`);
  }
  lines.push("");
  lines.push("Matched cohort");
  lines.push(`- Provider: ${report.cohort.provider ?? "unavailable"}`);
  lines.push(`- Matched units: ${report.cohort.matchedUnitCount}`);
  lines.push(`- Eligible matched units: ${report.cohort.eligibleMatchedUnitCount}`);
  lines.push(`- Excluded units: ${report.cohort.excludedUnitCount} (${reasons(report.cohort.exclusionReasonCounts)})`);
  lines.push(`- Unknown or unavailable units: ${report.cohort.unknownOrUnavailableUnitCount}`);
  for (const unmatched of report.cohort.unmatchedCases) lines.push(`- Unmatched case ${unmatched.caseId}: ${unmatched.reason}`);
  lines.push("");
  lines.push(`Invalid-output rate (${report.invalidOutput.basis}): ${report.invalidOutput.metric}`);
  const printStratum = (stratum: InvalidOutputStratum): void => {
    lines.push(`- ${stratum.stratum}: eligible units ${stratum.eligibleUnitCount}`);
    lines.push(`    baseline  ${rateText(stratum.baseline)}; invalid by reason: ${reasons(stratum.baseline.invalidByReason)}`);
    lines.push(`    candidate ${rateText(stratum.candidate)}; invalid by reason: ${reasons(stratum.candidate.invalidByReason)}`);
    lines.push(`    difference (baseline minus candidate): ${pp(stratum.percentagePointDifference)}`);
  };
  if (report.invalidOutput.strata.length === 0) lines.push("- unavailable: no comparable cohort");
  for (const stratum of report.invalidOutput.strata) printStratum(stratum);
  if (report.invalidOutput.overall) printStratum(report.invalidOutput.overall);
  for (const repair of report.invalidOutput.repairAttemptSummary) {
    lines.push(`- repair attempt ${repair.attemptNumber} (allowance ${repair.repairAllowance ?? "unknown"}): baseline ${repair.baselineInvalid}/${repair.baselineEligible}, candidate ${repair.candidateInvalid}/${repair.candidateEligible}; ${repair.note}`);
  }
  lines.push("");
  lines.push("Task success (reported separately from response validity)");
  if (report.taskSuccess.strata.length === 0) lines.push("- unavailable: no comparable cohort");
  const printTask = (stratum: TaskSuccessStratum): void => {
    lines.push(`- ${stratum.stratum}: matched units ${stratum.matchedUnitCount}, verdict unavailable ${stratum.unavailableUnitCount}`);
    lines.push(`    initial attempt: ${successText(stratum.initial)}`);
    lines.push(`    final outcome:   ${successText(stratum.final)}`);
  };
  for (const stratum of report.taskSuccess.strata) printTask(stratum);
  if (report.taskSuccess.overall) printTask(report.taskSuccess.overall);
  lines.push("");
  lines.push("Limitations");
  for (const item of report.limitations) lines.push(`- ${item}`);
  if (report.warnings.length > 0) {
    lines.push("");
    lines.push("Warnings");
    for (const item of report.warnings) lines.push(`- ${item}`);
  }
  return `${lines.join("\n")}\n`;
}

function row(cells: string[]): string {
  return `<tr>${cells.map((cell) => `<td>${escapeHtml(cell)}</td>`).join("")}</tr>`;
}
function table(caption: string, headers: string[], rows: string[][]): string {
  return `<div class="table-wrap" role="region" aria-label="${escapeHtml(caption)}" tabindex="0"><table><caption>${escapeHtml(caption)}</caption><thead><tr>${headers
    .map((header) => `<th scope="col">${escapeHtml(header)}</th>`)
    .join("")}</tr></thead><tbody>${rows.map(row).join("")}</tbody></table></div>`;
}

export function renderPromptTemplateComparisonHtml(report: PromptTemplateComparisonReportV1): string {
  const strataRows = [...report.invalidOutput.strata, ...(report.invalidOutput.overall ? [report.invalidOutput.overall] : [])].map((stratum) => [
    stratum.stratum,
    String(stratum.eligibleUnitCount),
    rateText(stratum.baseline),
    rateText(stratum.candidate),
    pp(stratum.percentagePointDifference)
  ]);
  const taskRows = [...report.taskSuccess.strata, ...(report.taskSuccess.overall ? [report.taskSuccess.overall] : [])].map((stratum) => [
    stratum.stratum,
    String(stratum.matchedUnitCount),
    String(stratum.unavailableUnitCount),
    successText(stratum.initial),
    successText(stratum.final)
  ]);
  const list = (items: string[]): string => (items.length === 0 ? "<p>None.</p>" : `<ul>${items.map((item) => `<li>${escapeHtml(item)}</li>`).join("")}</ul>`);
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Prompt Template Comparison</title>
  <style>
    :root { color-scheme: light; font-family: Arial, Helvetica, sans-serif; }
    body { margin: 0; color: #18212b; background: #f6f8fb; }
    main { max-width: 1120px; margin: 0 auto; padding: 28px; }
    section { background: #fff; border: 1px solid #d7e0ea; border-radius: 8px; padding: 18px; margin-bottom: 16px; }
    .table-wrap { overflow-x: auto; }
    table { width: 100%; border-collapse: collapse; }
    th, td { border: 1px solid #d9e1ea; padding: 8px 10px; text-align: left; vertical-align: top; }
    th { background: #edf2f7; }
    caption { text-align: left; font-weight: 700; padding: 4px 0; }
    .badge { display: inline-block; border-radius: 999px; padding: 3px 9px; font-weight: 700; background: #e8eef7; }
    .notice { border-left: 4px solid #a06a00; padding-left: 10px; }
  </style>
</head>
<body>
<main>
  <h1>Prompt Template Comparison</h1>
  <p>Schema <code>${escapeHtml(report.schemaVersion)}</code>. Comparison status: <span class="badge">${escapeHtml(report.comparison.status)}</span>. No winner is declared.</p>
  <p class="notice">Behavioral improvement: <strong>${escapeHtml(report.behavioralImprovement.status)}</strong>. ${escapeHtml(report.behavioralImprovement.reason)}</p>
  <section>
    <h2>Runs</h2>
    ${table("Baseline and candidate", ["Role", "Run", "Provider", "Template", "Identity basis", "Contract digest"], [
      ["baseline", report.baseline.runId ?? "unavailable", report.baseline.providerId ?? "unavailable", report.baseline.templateId ?? "unverified", report.baseline.promptBasis, report.baseline.promptContractDigest ?? "n/a"],
      ["candidate", report.candidate.runId ?? "unavailable", report.candidate.providerId ?? "unavailable", report.candidate.templateId ?? "unverified", report.candidate.promptBasis, report.candidate.promptContractDigest ?? "n/a"]
    ])}
  </section>
  <section>
    <h2>Comparability</h2>
    ${report.criteria.length ? table("Comparability criteria", ["Criterion", "Status", "Detail"], report.criteria.map((c) => [c.id, c.status, c.detail])) : "<p>Not evaluated.</p>"}
    ${report.comparison.incomparabilityReasons.length ? `<h3>Incomparability reasons</h3>${list(report.comparison.incomparabilityReasons)}` : ""}
  </section>
  <section>
    <h2>Matched cohort</h2>
    ${table("Cohort counts", ["Measure", "Value"], [
      ["Provider", report.cohort.provider ?? "unavailable"],
      ["Matched units", String(report.cohort.matchedUnitCount)],
      ["Eligible matched units", String(report.cohort.eligibleMatchedUnitCount)],
      ["Excluded units", String(report.cohort.excludedUnitCount)],
      ["Exclusion reasons", reasons(report.cohort.exclusionReasonCounts)],
      ["Unknown or unavailable units", String(report.cohort.unknownOrUnavailableUnitCount)]
    ])}
    ${report.cohort.unmatchedCases.length ? list(report.cohort.unmatchedCases.map((u) => `${u.caseId}: ${u.reason}`)) : ""}
  </section>
  <section>
    <h2>Invalid-output rate</h2>
    <p>${escapeHtml(report.invalidOutput.metric)} (${escapeHtml(report.invalidOutput.basis)}). Difference is baseline minus candidate; positive means the candidate has a lower observed rate.</p>
    ${strataRows.length ? table("Invalid-output rates", ["Stratum", "Eligible units", "Baseline", "Candidate", "Difference"], strataRows) : "<p>Unavailable: no comparable cohort.</p>"}
    ${report.invalidOutput.repairAttemptSummary.length ? list(report.invalidOutput.repairAttemptSummary.map((r) => `Repair attempt ${r.attemptNumber}: baseline ${r.baselineInvalid}/${r.baselineEligible}, candidate ${r.candidateInvalid}/${r.candidateEligible}. ${r.note}`)) : ""}
  </section>
  <section>
    <h2>Task success</h2>
    <p>Reported separately from response validity and read from persisted verdicts.</p>
    ${taskRows.length ? table("Task success", ["Stratum", "Matched units", "Verdict unavailable", "Initial attempt", "Final outcome"], taskRows) : "<p>Unavailable: no comparable cohort.</p>"}
  </section>
  <section>
    <h2>Limitations</h2>
    ${list(report.limitations)}
    ${report.warnings.length ? `<h3>Warnings</h3>${list(report.warnings)}` : ""}
  </section>
</main>
</body>
</html>
`;
}
