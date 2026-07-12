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
  lines.push(
    `  languages: typescript=${model.inventory.filesByLanguage.typescript} javascript=${model.inventory.filesByLanguage.javascript} python=${model.inventory.filesByLanguage.python} java=${model.inventory.filesByLanguage.java} kotlin=${model.inventory.filesByLanguage.kotlin} json=${model.inventory.filesByLanguage.json} markdown=${model.inventory.filesByLanguage.markdown} yaml=${model.inventory.filesByLanguage.yaml} xml=${model.inventory.filesByLanguage.xml} toml=${model.inventory.filesByLanguage.toml} unknown=${model.inventory.filesByLanguage.unknown}`
  );
  lines.push(
    `  roles: source=${model.inventory.filesByRole.source} test=${model.inventory.filesByRole.test} docs=${model.inventory.filesByRole.docs} config=${model.inventory.filesByRole.config} package=${model.inventory.filesByRole.package} generated=${model.inventory.filesByRole.generated} build-output=${model.inventory.filesByRole["build-output"]} vendor=${model.inventory.filesByRole.vendor} report-output=${model.inventory.filesByRole["report-output"]} unknown=${model.inventory.filesByRole.unknown}`
  );
  if (model.inventory.warnings.length > 0) {
    lines.push(`  warnings: ${model.inventory.warnings.length}`);
  }
  lines.push("");

  lines.push("Source facts summary");
  lines.push(divider("-"));
  lines.push(`  analyzed=${model.sourceFacts.totalFilesAnalyzed}`);
  lines.push(
    `  parsed=${model.sourceFacts.filesByParseStatus.parsed} file-level-only=${model.sourceFacts.filesByParseStatus["file-level-only"]} unsupported=${model.sourceFacts.filesByParseStatus.unsupported} parse-error=${model.sourceFacts.filesByParseStatus["parse-error"]} skipped=${model.sourceFacts.filesByParseStatus.skipped}`
  );
  if (model.sourceFacts.analyzerDiagnosticCount > 0) {
    lines.push(`  analyzer diagnostics: ${model.sourceFacts.analyzerDiagnosticCount}`);
  }
  if (model.sourceFacts.filesWithDiagnosticsCount > 0) {
    lines.push(`  files with a per-file diagnostic: ${model.sourceFacts.filesWithDiagnosticsCount}`);
  }
  lines.push("");

  // v0.3.2 Batch 3 -- informational only. Presence booleans and a
  // best-effort project name/pytest-configuration flag, never a
  // release-readiness or dependency-health signal -- see
  // pythonProjectMetadata.ts's own header comment.
  lines.push("Python project metadata");
  lines.push(divider("-"));
  const pm = model.pythonProjectMetadata;
  lines.push(
    `  pyproject.toml=${pm.hasPyprojectToml} requirements.txt=${pm.hasRequirementsTxt} setup.py=${pm.hasSetupPy} setup.cfg=${pm.hasSetupCfg} tox.ini=${pm.hasToxIni} pytest.ini=${pm.hasPytestIni}`
  );
  lines.push(`  project name detected: ${pm.projectName ?? "(none)"}`);
  lines.push(`  pytest configuration detected: ${pm.hasPytestConfiguration}`);
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

  // v0.3.2 Batch 4 -- bounded summary only. Never dumps raw scanner
  // output/full finding text here (that lives in the original security
  // validation report at securitySummary.reportPaths) -- this section only
  // links to it and shows counts, matching the same "reference, don't
  // duplicate" convention docs/security section 5 of the task spec asks for.
  lines.push("Security validation summary");
  lines.push(divider("-"));
  if (!model.securitySummary.ran) {
    lines.push("  (not run -- add \"security\" to --types to include it, e.g. --types code-rot,security)");
  } else {
    const sec = model.securitySummary;
    lines.push(`  Verdict: ${sec.verdictLabel ?? "(unknown)"}`);
    lines.push(
      `  Checks: total=${sec.totalChecks} passed=${sec.checksPassed} warning=${sec.checksWarning} failed=${sec.checksFailed} skipped=${sec.checksSkipped}`
    );
    lines.push(
      `  Findings: blocker=${sec.findingCounts.blocker} major=${sec.findingCounts.major} minor=${sec.findingCounts.minor} informational=${sec.findingCounts.informational} (mapped to ${sec.mappedIssueCount} audit issue(s))`
    );
    if (sec.targetDescription) {
      lines.push(`  Target: ${sanitizeLine(sec.targetDescription)}`);
    }
    if (sec.recommendedNextStep) {
      lines.push(`  Next step: ${sanitizeLine(sec.recommendedNextStep)}`);
    }
    if (sec.reportPaths.text || sec.reportPaths.json) {
      lines.push(`  Full report: ${sec.reportPaths.text ?? "(none)"} / ${sec.reportPaths.json ?? "(none)"}`);
    }
  }
  lines.push("");

  // v0.4.2 Batch 3 -- bounded summary only, mirroring the "Security
  // validation summary" section above exactly. Confirmed mapped Android
  // findings are NOT re-listed here -- they already appear in the "Issues"
  // section below like any other AuditIssue (see spec section 12: "the
  // existing generic issues section remains the detailed presentation for
  // confirmed mapped Android findings"). CandidateEvidence bodies never
  // appear here either -- only counts, with a pointer to the full Android
  // report for detail.
  lines.push("Android security validation summary");
  lines.push(divider("-"));
  if (!model.androidSecurity.summary.requested) {
    lines.push("  (not requested -- add --android alongside --types security to include it)");
  } else {
    const android = model.androidSecurity.summary;
    const candidates = model.androidSecurity.candidates;
    const applicabilityNote = android.applicable === false ? " (target is not an Android project)" : "";
    lines.push(`  Status: ${android.status}${applicabilityNote}`);
    lines.push(`  Verdict: ${android.verdict ?? "(unknown)"}`);
    lines.push(
      `  Checks: total=${android.totalChecks} passed=${android.passedChecks} withFindings=${android.checksWithFindings} candidateOnly=${android.candidateOnlyChecks} skipped=${android.skippedChecks} inconclusive=${android.inconclusiveChecks} failed=${android.failedChecks}`
    );
    lines.push(`  Findings: confirmed=${android.confirmedFindingCount} mappedIssues=${android.mappedIssueCount}`);
    lines.push(
      `  Candidates (review evidence, not confirmed vulnerabilities): total=${candidates.totalCount} checksWithCandidates=${candidates.checksWithCandidates}`
    );
    if (android.warnings.length > 0) {
      lines.push(`  Warnings: ${android.warnings.length}`);
    }
    if (android.errors.length > 0) {
      lines.push(`  Errors: ${android.errors.length}`);
      for (const e of android.errors.slice(0, 5)) {
        lines.push(`    ${sanitizeLine(e)}`);
      }
    }
    if (android.reportPaths.text || android.reportPaths.json) {
      lines.push(`  Full report: ${android.reportPaths.text ?? "(none)"} / ${android.reportPaths.json ?? "(none)"}`);
    }
    lines.push("  Static analysis only -- does not prove runtime behavior, APK/AAB validity, Play compliance, or pentest results.");
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
    // v0.3.1 Batch 5 -- an evidence entry's `message` (the human-readable
    // "why") and `excerpt` (a quoted snippet/reference list) are
    // independent fields on the same entry -- render both when both are
    // present. Previously an `excerpt` silently suppressed `message`
    // entirely, which dropped the only readable explanation for
    // source-facts-derived findings (e.g. duplicateImplementationDetector's
    // "Source facts: an exported ... was parsed in N distinct files.") and
    // left only a bare file-path excerpt in text output.
    lines.push(`      > ${sanitizeLine(evidence.message)}`);
    if (evidence.excerpt) {
      lines.push(...renderQuotedExcerpt(evidence.excerpt, "      "));
    }
  }
  lines.push(`      recommendedAction: ${sanitizeLine(issue.recommendedAction)}`);
  return lines;
}
