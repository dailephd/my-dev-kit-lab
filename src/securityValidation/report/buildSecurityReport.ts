import type { SecurityValidationSummary } from "../types.js";
import type { SecurityReport } from "./securityReportTypes.js";

// ---------------------------------------------------------------------------
// v0.3.2 Batch 4 — extracted from scripts/security/validate.ts so the audit
// security adapter (src/audits/security/securityAuditAdapter.ts) can build
// the same SecurityReport shape from a SecurityValidationSummary without
// duplicating the object-assembly glue. Pure: no I/O, no check execution —
// this only reshapes an already-computed summary into the SecurityReport
// input the existing renderTextReport()/renderJsonReport() renderers expect.
// scripts/security/validate.ts's own report content/behavior is unchanged by
// this extraction (same fields, same values, just built by a shared
// function instead of an inline object literal).
// ---------------------------------------------------------------------------

export type BuildSecurityReportOptions = {
  profile?: string;
  selectedChecks?: string[];
  failOnThreshold?: string;
  formats?: string[];
  failOnBreached?: boolean;
};

export function buildSecurityReportFromSummary(
  summary: SecurityValidationSummary,
  options: BuildSecurityReportOptions = {}
): SecurityReport {
  return {
    metadata: {
      toolRoot: summary.toolRoot,
      toolPackageName: summary.toolPackageName,
      toolPackageVersion: summary.toolPackageVersion,
      targetRoot: summary.targetRoot,
      targetDescription: summary.targetDescription,
      packageName: summary.packageName,
      packageVersion: summary.packageVersion,
      branch: summary.auditedBranch,
      commit: summary.auditedCommit,
      isSelf: summary.isSelf,
      generatedAt: summary.finishedAt,
      totalDurationMs: new Date(summary.finishedAt).getTime() - new Date(summary.startedAt).getTime(),
      profile: options.profile,
      selectedChecks: options.selectedChecks,
      failOnThreshold: options.failOnThreshold,
      formats: options.formats,
      failOnBreached: options.failOnBreached,
      isFullReleaseGate: summary.isFullReleaseGate,
    },
    sections: [],
    allChecks: summary.checks,
    allFindings: summary.findings,
    verdict: summary.verdict,
    recommendedNextStep: summary.recommendedNextStep,
    attackResults: summary.attackResults,
    verdictReasonSummary: summary.verdictReasonSummary,
  };
}
