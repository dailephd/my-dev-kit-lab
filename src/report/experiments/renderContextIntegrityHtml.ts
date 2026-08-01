// v0.4.5 Batch 5: bounded HTML rendering of ContextIntegrityReportV1. Reuses the existing
// escape/table conventions from renderContextStrategyComparisonV043Html.ts (no external
// framework, no script that mutates source data, no ranking/winner presentation). The
// failed-run and corrected-replay fixtures are visually distinguished by their end-to-end
// category label alone -- never as a competitive strategy comparison.
import type { ContextIntegrityReportAgreementV1, ContextIntegrityReportV1 } from "./contextIntegrityReportModel.js";

function escapeHtml(value: unknown): string {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function table(headers: string[], rows: string[][]): string {
  return `<table><thead><tr>${headers.map((h) => `<th>${escapeHtml(h)}</th>`).join("")}</tr></thead><tbody>${rows
    .map((row) => `<tr>${row.map((cell) => `<td>${escapeHtml(cell)}</td>`).join("")}</tr>`)
    .join("")}</tbody></table>`;
}

function renderAgreementSection(label: string, agreement: ContextIntegrityReportAgreementV1): string {
  const rows = agreement.contradictions.items.map((c) => [c.code, c.fieldPath, c.expected ?? "", c.observed ?? "", c.reason]);
  return `<section><h3>${escapeHtml(label)}</h3>${table(
    ["Availability", "Outcome", "Reason"],
    [[agreement.availability, agreement.outcome, agreement.reason ?? ""]]
  )}${
    agreement.contradictions.totalCount > 0
      ? `<p class="muted">Contradictions displayed ${agreement.contradictions.displayedCount} of ${agreement.contradictions.totalCount} (omitted ${agreement.contradictions.omittedCount}).</p>${table(
          ["Code", "Field path", "Expected", "Observed", "Reason"],
          rows
        )}`
      : ""
  }</section>`;
}

export function renderContextIntegrityHtml(report: ContextIntegrityReportV1): string {
  const endToEndLabel = report.endToEnd?.category ?? "unavailable";
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<title>Context-integrity report: ${escapeHtml(report.fixture.fixtureId)}</title>
<style>
body { font-family: system-ui, sans-serif; margin: 2rem; color: #1a1a1a; }
table { border-collapse: collapse; margin: 0.5rem 0 1rem; width: 100%; }
th, td { border: 1px solid #ccc; padding: 0.35rem 0.5rem; text-align: left; font-size: 0.9rem; }
.muted { color: #666; font-size: 0.85rem; }
.badge { display: inline-block; padding: 0.15rem 0.5rem; border-radius: 0.25rem; font-weight: 600; }
.badge-full-agreement { background: #d7f5dd; color: #1b6b32; }
.badge-contradiction-present { background: #fbdada; color: #8f1d1d; }
.badge-insufficient-evidence, .badge-unsupported-legacy-evidence { background: #eee; color: #444; }
section { margin-bottom: 1.5rem; }
</style>
</head>
<body>
<h1>Context-integrity report: ${escapeHtml(report.fixture.fixtureId)} (${escapeHtml(report.fixture.kind)})</h1>
<p>End-to-end result: <span class="badge badge-${escapeHtml(endToEndLabel)}">${escapeHtml(endToEndLabel)}</span></p>
${report.fixture.correctedReplayLimitation ? `<p class="muted"><strong>Limitation:</strong> ${escapeHtml(report.fixture.correctedReplayLimitation)}</p>` : ""}

<section><h2>Fixture and provenance</h2>${table(
    ["Field", "Value"],
    [
      ["my-dev-kit commit", report.fixture.myDevKitCommit ?? ""],
      ["orchestrator commit", report.fixture.orchestratorCommit ?? ""],
      ["Target repository identity", report.fixture.targetRepositoryIdentity ?? ""],
      ["Active index identity", report.fixture.activeIndexIdentity ?? ""],
      ["Tracked artifacts", String(report.fixture.trackedArtifactCount)],
      ["Derived artifacts", String(report.fixture.derivedArtifactCount)],
      ["Byte-exact artifacts", String(report.fixture.byteExactArtifactCount)],
      ["Hash verification", report.fixture.hashVerification.ok ? "PASS" : "FAIL"]
    ]
  )}</section>

<section><h2>Producer allocation and omissions</h2>${table(
    ["Field", "Value"],
    [
      ["Role adequacy status", report.producerIdentity.roleAdequacyStatus ?? "(unavailable)"],
      ["Groups evaluated", String(report.allocation.groupCount)],
      ["Total required omitted", String(report.allocation.totalRequiredOmitted ?? "(unavailable)")],
      ["Total optional omitted", String(report.allocation.totalOptionalOmitted ?? "(unavailable)")],
      ["Groups with required omission", report.allocation.groupsWithRequiredOmission.join(", ") || "(none)"],
      ["Groups with optional-only omission", report.allocation.groupsWithOptionalOnlyOmission.join(", ") || "(none)"],
      ["Truncation state", report.truncation.state],
      ["requiredEvidenceLost", String(report.truncation.requiredEvidenceLost)]
    ]
  )}</section>

<section><h2>Condition coverage</h2>${table(
    ["Field", "Value"],
    [
      ["Availability", report.conditionCoverage.availability],
      ["Required conditions total", String(report.conditionCoverage.requiredConditionsTotal ?? "(unavailable)")],
      ["Required conditions satisfied", String(report.conditionCoverage.requiredConditionsSatisfied ?? "(unavailable)")],
      ["Required conditions missing", report.conditionCoverage.requiredConditionsMissing.join(", ") || "(none)"],
      ["Required conditions lost", report.conditionCoverage.requiredConditionsLost.join(", ") || "(none)"],
      ["Last-witness-loss count", String(report.conditionCoverage.lastWitnessLossCount ?? "(unavailable)")]
    ]
  )}</section>

${renderAgreementSection("Producer-condition agreement", report.producerConditionAgreement)}
${renderAgreementSection("requiredEvidenceLost agreement", report.requiredEvidenceLossAgreement)}
${renderAgreementSection("Producer/readiness relationship", report.producerReadinessAgreement)}
<p class="muted">Note: the orchestrator does not expose a literal upstream <code>promptMode</code> field. <code>stageMayRenderNormalPrompt</code> (derived from structured blocked-stage evidence) is the bounded substitute used below.</p>
${renderAgreementSection("Readiness/prompt agreement", report.readinessPromptAgreement)}
${renderAgreementSection("Readiness/expected-judge agreement", report.readinessExpectedJudgeAgreement)}
${renderAgreementSection("Expected/actual-judge agreement", report.expectedActualJudgeAgreement)}
${renderAgreementSection("Judge/correction agreement", report.judgeCorrectionAgreement)}
${renderAgreementSection("Judge/final-eligibility agreement", report.judgeFinalEligibilityAgreement)}
${renderAgreementSection("Eligibility/final-artifact agreement", report.eligibilityFinalArtifactAgreement)}
${renderAgreementSection("Lifecycle-integrity agreement", report.lifecycleIntegrityAgreement)}

<section><h2>Determinism and immutability</h2>${table(
    ["Field", "Value"],
    [
      ["Determinism availability", report.determinism.availability],
      ["Repeat count", String(report.determinism.repeatCount)],
      ["Deterministic", String(report.determinism.deterministic)],
      ["Fixture self-immutable", String(report.immutability.fixtureSelfImmutable)]
    ]
  )}</section>

<section><h2>Limitations</h2>${
    report.limitations.notes.length > 0 ? `<ul>${report.limitations.notes.map((n) => `<li>${escapeHtml(n)}</li>`).join("")}</ul>` : "<p>(none)</p>"
  }</section>
</body>
</html>
`;
}
