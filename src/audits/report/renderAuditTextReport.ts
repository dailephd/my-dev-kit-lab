import type { AuditIssue } from "../core/auditIssue.js";
import type { AuditSeverity } from "../core/auditTypes.js";
import type { AuditReportModel } from "./auditReportModel.js";
import { MAX_TEXT_RECOMMENDATIONS } from "./auditReportModel.js";
import { sanitizeAuditText } from "./sanitizeAuditText.js";

// ---------------------------------------------------------------------------
// v0.3.0 Batch 5 — human-readable text report renderer.
//
// Pure: takes an already-built AuditReportModel and renders terminal-
// friendly text. Sanitizes any text sourced from scanned project content
// (issue titles/descriptions/evidence excerpts, recommendedAction strings)
// via sanitizeAuditText() so a hostile source file cannot poison the report
// with ANSI escapes or a fake section header. Evidence excerpts are quoted
// with a leading "> " marker precisely so a fake "===" divider or a fake
// "[BLOCKER]"-looking line embedded in scanned content reads as quoted
// evidence, not as a real report section (see spec 3.9/tests/audits/
// auditReportSanitization.test.ts).
// ---------------------------------------------------------------------------

const SEVERITY_HEADING_ORDER: readonly AuditSeverity[] = ["blocker", "high", "medium", "low", "info"];
const MAX_EVIDENCE_PER_ISSUE = 2;
const MAX_EXCERPT_LENGTH = 300;

function divider(char = "=", width = 72): string {
  return char.repeat(width);
}

function sanitizeLine(raw: string): string {
  // Defensive bound even for non-excerpt text (titles/descriptions) --
  // sanitizeAuditText() strips control chars and only truncates past
  // maxLength, so ordinary short strings pass through unchanged. Also
  // collapses any embedded real newlines to a single space: these fields
  // (title/description/category/reason/message) are rendered as a single
  // "label: value" line, so a hostile source containing a literal newline
  // must not be allowed to inject what looks like a second, unindented
  // report line.
  return sanitizeAuditText(raw, 500).replace(/\r\n|\r|\n/g, " ");
}

// Renders a (possibly multi-line) evidence excerpt as one or more clearly
// quoted lines, each individually prefixed with "> " -- this is what stops a
// hostile excerpt containing an embedded newline plus a fake "===" divider
// or a fake "[BLOCKER] ..." header line from ever appearing as a bare,
// unindented line that could be mistaken for real report structure. Every
// physical line of the excerpt is quoted, not just the first.
function renderQuotedExcerpt(raw: string, indent: string): string[] {
  const sanitized = sanitizeAuditText(raw, MAX_EXCERPT_LENGTH);
  return sanitized.split(/\r\n|\r|\n/).map((line) => `${indent}> ${line}`);
}

export function renderAuditTextReport(model: AuditReportModel): string {
  const lines: string[] = [];

  lines.push("my-dev-kit-lab audit report");
  lines.push(divider());
  lines.push(`Schema version: ${model.schemaVersion}`);
  lines.push(`Generated: ${model.metadata.generatedAt}`);
  lines.push(`Report type: ${model.metadata.reportType} (audit type: ${model.metadata.auditType})`);
  lines.push(`Package: ${model.metadata.packageName ?? "(none)"}@${model.metadata.packageVersion ?? "?"}`);
  lines.push("");

  lines.push("Target");
  lines.push(divider("-"));
  lines.push(`  ${sanitizeLine(model.target.displayName)} (${model.target.rootPath})`);
  lines.push(`  kind=${model.target.targetKind} hasPackageJson=${model.target.hasPackageJson} hasGitRoot=${model.target.hasGitRoot}`);
  lines.push("");

  lines.push("Config");
  lines.push(divider("-"));
  lines.push(`  types=${model.config.types.join(",")} include=${model.config.include.join(",")}`);
  lines.push(`  formats=${model.config.formats.join(",")} failOn=${model.config.failOn} isDefaultRun=${model.config.isDefaultRun}`);
  lines.push(`  out=${model.config.out}`);
  lines.push("");

  lines.push("Detectors");
  lines.push(divider("-"));
  for (const d of model.detectors) {
    lines.push(`  [${d.status.padEnd(8)}] ${d.id} (${d.auditType}) issues=${d.issueCount}`);
  }
  lines.push("");

  lines.push("Inventory summary");
  lines.push(divider("-"));
  lines.push(
    `  total=${model.inventory.totalFileCount} scanned=${model.inventory.totalScannedFileCount} skipped=${model.inventory.skippedFileCount}`
  );
  lines.push(
    `  source=${model.inventory.filesByCategory.source} tests=${model.inventory.filesByCategory.tests} docs=${model.inventory.filesByCategory.docs} package=${model.inventory.filesByCategory.package} config=${model.inventory.filesByCategory.config} scripts=${model.inventory.filesByCategory.scripts} ci=${model.inventory.filesByCategory.ci} generated=${model.inventory.filesByCategory.generated} report=${model.inventory.filesByCategory.report} unknown=${model.inventory.filesByCategory.unknown}`
  );
  if (model.inventory.warnings.length > 0) {
    lines.push(`  warnings: ${model.inventory.warnings.length}`);
  }
  lines.push("");

  lines.push("Source-of-truth summary");
  lines.push(divider("-"));
  lines.push(`  package: ${model.sourceOfTruth.packageName ?? "(none)"}@${model.sourceOfTruth.packageVersion ?? "?"}`);
  lines.push(
    `  README present=${model.sourceOfTruth.hasReadme} CHANGELOG present=${model.sourceOfTruth.hasChangelog} docs files=${model.sourceOfTruth.docsFileCount}`
  );
  lines.push(
    `  CI workflows=${model.sourceOfTruth.ciWorkflowCount} node versions referenced=${model.sourceOfTruth.nodeVersionsReferenced.join(",") || "(none)"}`
  );
  if (model.sourceOfTruth.warnings.length > 0) {
    lines.push(`  warnings: ${model.sourceOfTruth.warnings.length}`);
  }
  lines.push("");

  lines.push("Issue summary");
  lines.push(divider("-"));
  lines.push(`  Total issues: ${model.summary.totalIssues}`);
  lines.push(
    `  By severity: blocker=${model.summary.issuesBySeverity.blocker} high=${model.summary.issuesBySeverity.high} medium=${model.summary.issuesBySeverity.medium} low=${model.summary.issuesBySeverity.low} info=${model.summary.issuesBySeverity.info}`
  );
  lines.push(
    `  By confidence: high=${model.summary.issuesByConfidence.high} medium=${model.summary.issuesByConfidence.medium} low=${model.summary.issuesByConfidence.low}`
  );
  lines.push(
    `  By false-positive risk: high=${model.summary.issuesByFalsePositiveRisk.high} medium=${model.summary.issuesByFalsePositiveRisk.medium} low=${model.summary.issuesByFalsePositiveRisk.low}`
  );
  lines.push(
    `  Release-blocking=${model.summary.releaseBlockingCount} Implementation-blocking=${model.summary.implementationBlockingCount} Auto-fix-eligible=${model.summary.autoFixEligibleCount}`
  );
  lines.push(
    `  Detectors: total=${model.summary.detectorCount} selected=${model.summary.selectedDetectorCount} skipped=${model.summary.skippedDetectorCount} errors=${model.summary.detectorErrorCount}`
  );
  lines.push(`  Highest severity: ${model.summary.highestSeverity ?? "(none)"}`);
  lines.push(`  Verdict: ${model.summary.finalVerdictLabel}`);
  lines.push("");

  if (model.recommendations.length > 0) {
    lines.push(`Top recommendations (showing up to ${MAX_TEXT_RECOMMENDATIONS} of ${model.recommendations.length})`);
    lines.push(divider("-"));
    for (const rec of model.recommendations.slice(0, MAX_TEXT_RECOMMENDATIONS)) {
      lines.push(`  - [${rec.highestSeverity}] ${sanitizeLine(rec.text)} (${rec.issueIds.length} issue(s), detector(s): ${rec.detectorIds.join(", ")})`);
    }
    lines.push("");
  }

  lines.push("Issues (grouped by severity)");
  lines.push(divider("-"));
  if (model.issues.length === 0) {
    lines.push("  (no issues in this run)");
  } else {
    for (const severity of SEVERITY_HEADING_ORDER) {
      const group = model.issues.filter((i) => i.severity === severity);
      if (group.length === 0) continue;
      lines.push(`  -- ${severity.toUpperCase()} (${group.length}) --`);
      for (const issue of group) {
        lines.push(...renderIssueBlock(issue));
      }
    }
  }
  lines.push("");

  lines.push("Skipped detectors");
  lines.push(divider("-"));
  if (model.skippedDetectors.length === 0) {
    lines.push("  (none)");
  } else {
    for (const s of model.skippedDetectors) {
      lines.push(`  [${s.id}] ${sanitizeLine(s.reason)}`);
    }
  }
  lines.push("");

  lines.push("Detector errors");
  lines.push(divider("-"));
  if (model.detectorErrors.length === 0) {
    lines.push("  (none)");
  } else {
    for (const e of model.detectorErrors) {
      lines.push(`  [${e.id}] (${e.category}) ${sanitizeLine(e.message)}`);
    }
  }
  lines.push("");

  lines.push("Exit result");
  lines.push(divider("-"));
  lines.push(`  code=${model.exit.code} failOnThreshold=${model.exit.failOnThreshold} breached=${model.exit.breached}`);
  lines.push(`  reason: ${sanitizeLine(model.exit.reason)}`);

  return lines.join("\n");
}

function renderIssueBlock(issue: AuditIssue): string[] {
  const lines: string[] = [];
  lines.push(`  * ${sanitizeLine(issue.title)}`);
  lines.push(`      severity=${issue.severity} confidence=${issue.confidence} category=${sanitizeLine(issue.category)}`);
  lines.push(`      detector=${issue.detectorId} id=${issue.id}`);
  for (const evidence of issue.evidence.slice(0, MAX_EVIDENCE_PER_ISSUE)) {
    if (evidence.excerpt) {
      lines.push(...renderQuotedExcerpt(evidence.excerpt, "      "));
    } else {
      lines.push(`      > ${sanitizeLine(evidence.message)}`);
    }
  }
  lines.push(`      recommendedAction: ${sanitizeLine(issue.recommendedAction)}`);
  return lines;
}
