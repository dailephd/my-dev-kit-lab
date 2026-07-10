import { stripUnsafeControlChars } from "../../../securityValidation/attackScenarios/exploitEvidence.js";
import type { AndroidReportModel } from "./model.js";

// ---------------------------------------------------------------------------
// v0.4.0 Batch 5 — Android text report rendering (agents.txt Batch 5 section
// 15.4). Mirrors the section structure and defensive text-sanitization
// convention of src/securityValidation/report/renderSecurityReport.ts
// (stripUnsafeControlChars guards against ANSI/control-byte report
// poisoning from scanned manifest/Gradle content).
// ---------------------------------------------------------------------------

function divider(char = "-", width = 72): string {
  return char.repeat(width);
}

function sanitize(raw: string): string {
  return stripUnsafeControlChars(raw);
}

function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  return `${(ms / 1000).toFixed(1)}s`;
}

export function renderAndroidTextReport(model: AndroidReportModel): string {
  const lines: string[] = [];

  // 1. Summary
  lines.push(divider("="));
  lines.push("ANDROID SECURITY-VALIDATION SUMMARY");
  lines.push(divider("="));
  lines.push(sanitize(model.executiveSummary));
  lines.push(`Profile        : ${model.metadata.profile}`);
  lines.push(`Target         : ${model.metadata.target.local.targetRoot}`);
  lines.push(`Tool           : ${model.metadata.tool.toolPackageName}@${model.metadata.tool.toolPackageVersion}`);
  lines.push(`Generated      : ${model.metadata.generatedAt}`);
  lines.push(`Duration       : ${formatDuration(model.metadata.totalDurationMs)}`);
  lines.push("");

  // 2-3. Verdict and reasons
  lines.push(divider());
  lines.push("VERDICT");
  lines.push(divider());
  lines.push(`Verdict: ${model.verdict} (${model.verdictHumanLabel})`);
  lines.push(`Next step: ${sanitize(model.recommendedNextStep)}`);
  if (model.verdictReasons.length > 0) {
    lines.push("");
    lines.push("Verdict reasons:");
    for (const r of model.verdictReasons) {
      lines.push(`  [${r.impact}] ${r.code}: ${sanitize(r.summary)}`);
      lines.push(`    -> ${sanitize(r.recommendedAction)}`);
    }
  }
  lines.push("");

  // 4. Target identity
  lines.push(divider());
  lines.push("TARGET IDENTITY");
  lines.push(divider());
  lines.push(`Target root    : ${model.metadata.target.local.targetRoot}`);
  lines.push(`Tool root      : ${model.metadata.target.local.toolRoot}`);
  lines.push(`Package        : ${model.metadata.target.local.packageName ?? "(unknown)"}`);
  lines.push(`Git branch     : ${model.metadata.target.local.branch ?? "(unavailable)"}`);
  lines.push(`Git commit     : ${model.metadata.target.local.commit ?? "(unavailable)"}`);
  lines.push("");

  // 5-6. Classification
  lines.push(divider());
  lines.push("ANDROID PROJECT CLASSIFICATION");
  lines.push(divider());
  lines.push(`${model.detectionSummary.title}: ${model.detectionSummary.summary}`);
  lines.push(`${model.androidProjectSummary.title}: ${model.androidProjectSummary.summary}`);
  lines.push(`${model.uiToolkitSummary.title}: ${model.uiToolkitSummary.summary}`);
  lines.push("");

  // 7. Module summary
  lines.push(divider());
  lines.push("MODULE SUMMARY");
  lines.push(divider());
  if (model.moduleSummary.length === 0) {
    lines.push("(no modules detected)");
  } else {
    for (const m of model.moduleSummary) {
      lines.push(`  ${m.path.padEnd(30)} kind=${m.kind.padEnd(12)} uiToolkit=${m.uiToolkit ?? "uncertain"}`);
    }
  }
  lines.push("");

  // 8. Environment and execution summary
  lines.push(divider());
  lines.push("ENVIRONMENT AND EXECUTION SUMMARY");
  lines.push(divider());
  lines.push(`Requested Gradle operations: ${model.metadata.requestedGradleOperations.length > 0 ? model.metadata.requestedGradleOperations.join(", ") : "(none — static-only validation, no Gradle process executed)"}`);
  if (model.environmentLimitations.length > 0) {
    for (const note of model.environmentLimitations) lines.push(`  - ${sanitize(note)}`);
  }
  lines.push("");

  // 9-13. Manifest / permissions / components / intent-filters / deep-links
  lines.push(divider());
  lines.push("MANIFEST SUMMARY");
  lines.push(divider());
  lines.push(sanitize(model.manifestSummary.summary));
  lines.push("");

  lines.push(divider());
  lines.push("PERMISSIONS SUMMARY");
  lines.push(divider());
  lines.push(sanitize(model.permissionsSummary.summary));
  lines.push("");

  lines.push(divider());
  lines.push("EXPORTED COMPONENT SUMMARY");
  lines.push(divider());
  lines.push(sanitize(model.componentSummary.summary));
  lines.push("");

  lines.push(divider());
  lines.push("INTENT-FILTER SUMMARY");
  lines.push(divider());
  lines.push(sanitize(model.intentFilterSummary.summary));
  lines.push("");

  lines.push(divider());
  lines.push("DEEP-LINK SUMMARY");
  lines.push(divider());
  lines.push(sanitize(model.deepLinkSummary.summary));
  lines.push("");

  // 14. Static Gradle metadata
  lines.push(divider());
  lines.push("STATIC GRADLE METADATA");
  lines.push(divider());
  lines.push(sanitize(model.gradleMetadataSummary.summary));
  if (model.gradleCheckSummary) lines.push(sanitize(model.gradleCheckSummary.summary));
  lines.push("");

  // 15. Optional Gradle operation results
  lines.push(divider());
  lines.push("OPTIONAL GRADLE OPERATION RESULTS");
  lines.push(divider());
  if (model.gradleOperationResults.length === 0) {
    lines.push("No optional Gradle operations were requested — zero Gradle processes executed.");
  } else {
    for (const op of model.gradleOperationResults) {
      lines.push(`  ${op.id} — status=${op.status} ran=${op.ran}`);
      if (op.command) {
        lines.push(`    command: ${sanitize(op.command.command)} ${op.command.args.map(sanitize).join(" ")}`);
        lines.push(`    cwd: ${op.command.cwd}  exitCode: ${op.command.exitCode ?? "null"}  timedOut: ${op.command.timedOut}`);
      }
      if (op.durationMs !== undefined) lines.push(`    duration: ${formatDuration(op.durationMs)}`);
      if (op.skipInfo) lines.push(`    skip reason: ${sanitize(op.skipInfo.reason)}`);
      for (const w of op.warnings) lines.push(`    warning: ${sanitize(w)}`);
    }
  }
  lines.push("");

  // 16. Release metadata
  lines.push(divider());
  lines.push("RELEASE METADATA");
  lines.push(divider());
  lines.push(sanitize(model.releaseMetadataSummary.summary));
  lines.push("");

  // 17. Play-readiness checklist
  lines.push(divider());
  lines.push("PLAY-READINESS CHECKLIST PLACEHOLDERS");
  lines.push(divider());
  lines.push(sanitize(model.playReadinessSummary.summary));
  for (const item of model.playReadinessItems) {
    lines.push(`  [${item.status}] ${item.title}: ${sanitize(item.detail)}`);
  }
  lines.push("");

  // 18. Findings grouped by severity
  lines.push(divider());
  lines.push("FINDINGS BY SEVERITY");
  lines.push(divider());
  const severityOrder = ["blocker", "major", "minor", "informational"];
  let anyFindings = false;
  for (const severity of severityOrder) {
    const findings = model.findingsBySeverity[severity];
    if (!findings || findings.length === 0) continue;
    anyFindings = true;
    lines.push(`${severity.toUpperCase()} (${findings.length}):`);
    for (const f of findings) {
      lines.push(`  [${f.id}] ${sanitize(f.title)}`);
      lines.push(`    category: ${f.category}`);
      if (f.affectedFiles && f.affectedFiles.length > 0) lines.push(`    path: ${f.affectedFiles.join(", ")}`);
      lines.push(`    evidence: ${sanitize(f.evidence ?? "(none)")}`);
      lines.push(`    ${sanitize(f.description)}`);
      if (f.recommendation) lines.push(`    recommendation: ${sanitize(f.recommendation)}`);
    }
  }
  if (!anyFindings) lines.push("(no findings)");
  lines.push("");

  // 19. Skipped/unsupported/not-run/inconclusive checks
  lines.push(divider());
  lines.push("SKIPPED, UNSUPPORTED, NOT-RUN, AND INCONCLUSIVE CHECKS");
  lines.push(divider());
  const nonPassing = model.checks.filter((c) => c.status !== "passed");
  if (nonPassing.length === 0) {
    lines.push("(all checks passed)");
  } else {
    for (const c of nonPassing) {
      lines.push(`  [${c.status}] ${c.id} — ${sanitize(c.title)}`);
      if (c.skipInfo) lines.push(`    reason: ${sanitize(c.skipInfo.reason)}`);
    }
  }
  lines.push("");

  // 20. Target mutation evidence
  lines.push(divider());
  lines.push("TARGET MUTATION EVIDENCE");
  lines.push(divider());
  lines.push(sanitize(model.targetMutationSummary.summary));
  lines.push("");

  // 21. Static-analysis limitations
  lines.push(divider());
  lines.push("STATIC-ANALYSIS LIMITATIONS");
  lines.push(divider());
  for (const limitation of model.staticAnalysisLimitations) {
    lines.push(`  - ${limitation}`);
  }
  lines.push("");

  // 22. Recommended next step
  lines.push(divider());
  lines.push("RECOMMENDED NEXT STEP");
  lines.push(divider());
  lines.push(sanitize(model.recommendedNextStep));

  return lines.join("\n");
}
