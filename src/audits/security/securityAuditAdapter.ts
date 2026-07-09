import fs from "node:fs";
import path from "node:path";
import { runSecurityValidation } from "../../securityValidation/validate/runSecurityValidation.js";
import { reportFilenamePrefix } from "../../securityValidation/validate/resolveTarget.js";
import { renderJsonReport, renderTextReport } from "../../securityValidation/report/renderSecurityReport.js";
import { buildSecurityReportFromSummary } from "../../securityValidation/report/buildSecurityReport.js";
import { DEFAULT_SECURITY_CHECKS, DEFAULT_SECURITY_PROFILE } from "../../securityValidation/validate/cliOptions.js";
import { verdictToHumanLabel } from "../../securityValidation/validate/verdict.js";
import type { AuditConfig } from "../core/auditConfig.js";
import type { AuditIssue } from "../core/auditIssue.js";
import { mapSecurityFindingToAuditIssue } from "./mapSecurityFindingToAuditIssue.js";
import type { SecurityAuditReportSummary } from "./securityAuditTypes.js";

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
};

export type SecurityAuditAdapterResult = {
  issues: AuditIssue[];
  summary: SecurityAuditReportSummary;
};

export async function runSecurityAuditAdapter(
  options: RunSecurityAuditAdapterOptions
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

  // Always under my-dev-kit-lab's own reports/ tree (toolRoot), never under
  // the audited target's root — matches the target-safety guarantee
  // AuditTarget.safeReportOutputRoot already documents for code-rot reports.
  const reportDir = path.join(toolRoot, "reports", "security");
  if (!fs.existsSync(reportDir)) {
    fs.mkdirSync(reportDir, { recursive: true });
  }
  const prefix = reportFilenamePrefix({
    isSelf: summary.isSelf,
    packageName: summary.packageName,
    packageVersion: summary.packageVersion,
    targetRoot: summary.targetRoot,
  });
  const textPath = path.join(reportDir, `${prefix}-security-validation.txt`);
  const jsonPath = path.join(reportDir, `${prefix}-security-validation.json`);
  fs.writeFileSync(textPath, renderTextReport(report), "utf8");
  fs.writeFileSync(jsonPath, renderJsonReport(report), "utf8");

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

  return { issues, summary: securitySummary };
}
