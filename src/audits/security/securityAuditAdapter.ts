import path from "node:path";
import { runSecurityValidation } from "../../securityValidation/validate/runSecurityValidation.js";
import { reportFilenamePrefix } from "../../securityValidation/validate/resolveTarget.js";
import { buildSecurityReportFromSummary } from "../../securityValidation/report/buildSecurityReport.js";
import { writeSecurityReportFiles } from "../../securityValidation/report/writeSecurityReportFiles.js";
import { DEFAULT_SECURITY_CHECKS, DEFAULT_SECURITY_PROFILE } from "../../securityValidation/validate/cliOptions.js";
import { verdictToHumanLabel } from "../../securityValidation/validate/verdict.js";
import type { AuditConfig } from "../core/auditConfig.js";
import type { AuditIssue } from "../core/auditIssue.js";
import { mapSecurityFindingToAuditIssue } from "./mapSecurityFindingToAuditIssue.js";
import { runAndroidAuditIntegration, type RunAndroidValidation } from "./androidAuditIntegration.js";
import {
  ANDROID_AUDIT_NOT_REQUESTED_SUMMARY,
  type AndroidAuditRequest,
  type AndroidAuditSummary,
  type SecurityAuditReportSummary,
} from "./securityAuditTypes.js";

// ---------------------------------------------------------------------------
// v0.3.2 Batch 4 — security-validation audit adapter.
//
// The only owner of "how does `npm run audit -- --types security` run
// security validation". Calls runSecurityValidation() directly (the same
// structured entrypoint scripts/security/validate.ts calls) — never shells
// out to `npm run security:validate`, never parses console text. Reuses the
// existing check-selection defaults (DEFAULT_SECURITY_CHECKS,
// DEFAULT_SECURITY_PROFILE) so an `audit --types security` run exercises the
// same check set a plain `security:validate` (no --checks/--profile) run
// would, and writes the *same* original report family under
// reports/security/ using the *same* renderers and filename convention —
// this is intentionally not a separate "audit-security" report family.
// ---------------------------------------------------------------------------

export type RunSecurityAuditAdapterOptions = {
  toolRoot: string;
  config: AuditConfig;
  // v0.4.2 Batch 2 — internal/programmatic-only Android integration request.
  // No CLI flag sets this yet (deferred to a later batch); omitted means
  // exactly the pre-Batch-2 adapter behavior, byte-for-byte.
  android?: AndroidAuditRequest;
};

// v0.4.2 Batch 2 — narrow internal test-injection seam. Default (omitted)
// uses the real Android validator; existing callers that never pass a second
// argument are completely unaffected. Not exported from the package's public
// surface (src/index.ts) — internal to the audits/security module only.
export type RunSecurityAuditAdapterDependencies = {
  runAndroidValidation?: RunAndroidValidation;
};

export type SecurityAuditAdapterResult = {
  issues: AuditIssue[];
  summary: SecurityAuditReportSummary;
  android: AndroidAuditSummary;
};

export async function runSecurityAuditAdapter(
  options: RunSecurityAuditAdapterOptions,
  dependencies: RunSecurityAuditAdapterDependencies = {}
): Promise<SecurityAuditAdapterResult> {
  const { toolRoot, config } = options;

  const summary = await runSecurityValidation({
    cwd: toolRoot,
    targetPath: config.targetPathArg,
  });

  // Only real findings on executed checks become AuditIssue entries. A
  // skipped optional tool never has findings attached to it (see
  // skippedCheck() in runSecurityValidation.ts), so it can never silently
  // masquerade as an issue or as a passed check here.
  const issues = summary.findings.map(mapSecurityFindingToAuditIssue);

  const report = buildSecurityReportFromSummary(summary, {
    profile: DEFAULT_SECURITY_PROFILE,
    selectedChecks: [...DEFAULT_SECURITY_CHECKS],
    formats: ["text", "json"],
  });

  const reportDir = path.join(toolRoot, "reports", "security");
  const prefix = reportFilenamePrefix({
    isSelf: summary.isSelf,
    packageName: summary.packageName,
    packageVersion: summary.packageVersion,
    targetRoot: summary.targetRoot,
  });
  const runSuffix = buildRunScopedReportSuffix(summary.startedAt, summary.finishedAt);
  const { textPath, jsonPath } = writeSecurityReportFiles({
    outDir: reportDir,
    prefix,
    report,
    formats: ["text", "json"],
    reportPathSuffix: runSuffix,
  });

  const findingCounts = {
    blocker: summary.findings.filter((f) => f.severity === "blocker").length,
    major: summary.findings.filter((f) => f.severity === "major").length,
    minor: summary.findings.filter((f) => f.severity === "minor").length,
    informational: summary.findings.filter((f) => f.severity === "informational").length,
  };

  const securitySummary: SecurityAuditReportSummary = {
    ran: true,
    verdict: summary.verdict,
    verdictLabel: verdictToHumanLabel(summary.verdict),
    recommendedNextStep: summary.recommendedNextStep,
    targetDescription: summary.targetDescription,
    isSelf: summary.isSelf,
    totalChecks: summary.checks.length,
    checksPassed: summary.checks.filter((c) => c.status === "passed").length,
    checksWarning: summary.checks.filter((c) => c.status === "warning").length,
    checksFailed: summary.checks.filter((c) => c.status === "failed").length,
    checksSkipped: summary.checks.filter((c) => c.status === "skipped").length,
    findingCounts,
    mappedIssueCount: issues.length,
    verdictReasonSummary: summary.verdictReasonSummary ?? null,
    reportPaths: { text: textPath, json: jsonPath },
  };

  // v0.4.2 Batch 2 — Android integration is strictly additive: existing
  // non-Android issues/summary above are computed identically whether or not
  // Android is requested, and Android issues are always appended after them,
  // never interleaved or reordered.
  let androidIssues: AuditIssue[] = [];
  let androidSummary: AndroidAuditSummary = ANDROID_AUDIT_NOT_REQUESTED_SUMMARY;
  if (options.android?.enabled) {
    const androidResult = await runAndroidAuditIntegration({
      toolRoot,
      targetPathArg: config.targetPathArg,
      request: options.android,
      runAndroidValidation: dependencies.runAndroidValidation,
    });
    androidIssues = androidResult.issues;
    androidSummary = androidResult.summary;
  }

  return { issues: [...issues, ...androidIssues], summary: securitySummary, android: androidSummary };
}

function buildRunScopedReportSuffix(startedAt: string, finishedAt: string): string {
  return `${sanitizeTimestamp(startedAt)}-${sanitizeTimestamp(finishedAt)}-${process.pid}`;
}

function sanitizeTimestamp(value: string): string {
  return value.replace(/[^0-9]/g, "").slice(0, 14) || "run";
}
