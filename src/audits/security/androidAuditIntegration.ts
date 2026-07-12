import path from "node:path";
import { validateAndroidTarget, type ValidateAndroidTargetOptions } from "../../mobile/android/validate/validateAndroidTarget.js";
import { toAndroidReportModel } from "../../mobile/android/report/model.js";
import { writeAndroidReportFiles } from "../../mobile/android/report/writeAndroidReportFiles.js";
import { reportFilenamePrefix } from "../../securityValidation/validate/resolveTarget.js";
import type { AndroidCheckResult } from "../../mobile/android/validation/checkResult.js";
import type { CandidateEvidence } from "../../mobile/android/advancedSecurity/candidateEvidence.js";
import type { AuditIssue } from "../core/auditIssue.js";
import { mapAndroidSecurityFindingToAuditIssue } from "./mapAndroidSecurityFindingToAuditIssue.js";
import {
  ANDROID_AUDIT_NOT_REQUESTED_SUMMARY,
  EMPTY_ANDROID_AUDIT_CANDIDATE_SUMMARY,
  type AndroidAuditCandidateSummary,
  type AndroidAuditRequest,
  type AndroidAuditSummary,
} from "./securityAuditTypes.js";

// ---------------------------------------------------------------------------
// v0.4.2 Batch 2 — programmatic Android integration for the existing general
// security audit adapter.
//
// Calls validateAndroidTarget() directly (the exact same programmatic
// entrypoint scripts/security/validate.ts already calls for `--profile
// android`) — never the CLI, never a subprocess, never re-parsed console
// text. Reuses toAndroidReportModel/writeAndroidReportFiles as-is so the
// Android report this integration produces is byte-identical in shape to the
// standalone report; only its location (a contained `android/` child
// directory under the same reports/security root, not a parallel `reports/
// android` product) differs from the standalone CLI's default.
//
// Confirmed findings are mapped through the Batch 1 mapper
// (mapAndroidSecurityFindingToAuditIssue) — this module never constructs an
// AuditIssue itself and never touches CandidateEvidence beyond counting it.
// ---------------------------------------------------------------------------

export type RunAndroidValidation = (options: ValidateAndroidTargetOptions) => ReturnType<typeof validateAndroidTarget>;

export type AndroidAuditIntegrationOptions = {
  toolRoot: string;
  targetPathArg?: string;
  request: AndroidAuditRequest;
  runAndroidValidation?: RunAndroidValidation;
};

export type AndroidAuditIntegrationResult = {
  issues: AuditIssue[];
  summary: AndroidAuditSummary;
};

const ANDROID_REPORT_SUBDIR = "android";
// Bounded, redacted — never the thrown value's stack, never raw child-process
// output (there is none at this boundary; validateAndroidTarget itself never
// spawns a process unless Gradle/external-tool options are requested, which
// Batch 2 never supplies).
const MAX_ANDROID_ERROR_MESSAGE_LENGTH = 500;

function boundErrorMessage(message: string): string {
  return message.length <= MAX_ANDROID_ERROR_MESSAGE_LENGTH
    ? message
    : `${message.slice(0, MAX_ANDROID_ERROR_MESSAGE_LENGTH)}... [truncated, ${message.length} chars total]`;
}

function failedSummary(errorMessage: string): AndroidAuditSummary {
  return {
    ...ANDROID_AUDIT_NOT_REQUESTED_SUMMARY,
    requested: true,
    applicable: null,
    status: "failed",
    errors: [boundErrorMessage(errorMessage)],
  };
}

// Exact-duplicate dedupe by AuditIssue id only, first occurrence wins —
// mirrors validateAndroidTarget's own findingsById convention. Iterates
// checks in their own fixed order (never re-sorted) and each check's own
// findings in their own order — never the top-level, already-flattened
// result.findings, which has lost per-check identity this mapper needs as
// context. Exported standalone so aggregation correctness (ordering,
// dedup, provenance) can be tested against small literal AndroidCheckResult
// fixtures without needing a full AndroidValidationResult.
export function aggregateAndroidIssues(
  checks: AndroidCheckResult[],
  reportReference: { text: string | null; json: string | null }
): AuditIssue[] {
  const issuesById = new Map<string, AuditIssue>();
  for (const check of checks) {
    for (const finding of check.findings) {
      const issue = mapAndroidSecurityFindingToAuditIssue(finding, {
        checkId: check.id,
        checkCategory: check.category,
        checkConfidence: check.confidence,
        reportReference,
      });
      if (!issuesById.has(issue.id)) {
        issuesById.set(issue.id, issue);
      }
    }
  }
  return [...issuesById.values()];
}

export function buildCandidateSummary(checks: AndroidCheckResult[]): AndroidAuditCandidateSummary {
  const byConfidence = { ...EMPTY_ANDROID_AUDIT_CANDIDATE_SUMMARY.byConfidence };
  const byResolutionState = { ...EMPTY_ANDROID_AUDIT_CANDIDATE_SUMMARY.byResolutionState };
  const byCategory: Record<string, number> = {};
  let totalCount = 0;
  let checksWithCandidates = 0;

  for (const check of checks) {
    const candidates: CandidateEvidence[] = check.candidateEvidence ?? [];
    if (candidates.length === 0) continue;
    checksWithCandidates += 1;
    for (const candidate of candidates) {
      totalCount += 1;
      byConfidence[candidate.confidence] += 1;
      byResolutionState[candidate.resolutionState] += 1;
      byCategory[candidate.category] = (byCategory[candidate.category] ?? 0) + 1;
    }
  }

  // Deterministic key order regardless of check/candidate traversal order.
  const sortedByCategory = Object.fromEntries(Object.entries(byCategory).sort(([a], [b]) => a.localeCompare(b)));

  return { totalCount, checksWithCandidates, byConfidence, byResolutionState, byCategory: sortedByCategory };
}

export async function runAndroidAuditIntegration(options: AndroidAuditIntegrationOptions): Promise<AndroidAuditIntegrationResult> {
  const runAndroidValidation = options.runAndroidValidation ?? validateAndroidTarget;

  let result;
  try {
    result = await runAndroidValidation({
      toolRoot: options.toolRoot,
      targetPath: options.targetPathArg,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return { issues: [], summary: failedSummary(`Android validation failed to run: ${message}`) };
  }

  const isApplicable = result.detection.projectKind !== "non-android";

  const reportModel = toAndroidReportModel(result, { profile: "android" });
  const reportDir = path.join(options.toolRoot, "reports", "security", ANDROID_REPORT_SUBDIR);
  const prefix = reportFilenamePrefix({
    isSelf: result.target.local.isSelf,
    packageName: result.target.local.packageName,
    packageVersion: result.target.local.packageVersion,
    targetRoot: result.target.local.targetRoot,
  });

  let reportPaths: { text: string | null; json: string | null };
  let writeErrors: string[] = [];
  try {
    const written = writeAndroidReportFiles({ outDir: reportDir, prefix, report: reportModel, formats: ["text", "json"] });
    reportPaths = { text: written.textPath, json: written.jsonPath };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    reportPaths = { text: null, json: null };
    writeErrors = [boundErrorMessage(`Failed to write Android report files: ${message}`)];
  }

  const issues = aggregateAndroidIssues(result.checks, reportPaths);

  const passedChecks = result.checks.filter((c) => c.status === "passed").length;
  const skippedChecks = result.checks.filter((c) => c.status === "skipped").length;
  const inconclusiveChecks = result.checks.filter((c) => c.status === "inconclusive").length;
  const failedChecks = result.checks.filter((c) => c.status === "failed" || c.status === "error").length;
  const checksWithFindings = result.checks.filter((c) => c.findings.length > 0).length;
  const candidateOnlyChecks = result.checks.filter((c) => c.findings.length === 0 && (c.candidateEvidence?.length ?? 0) > 0).length;
  const candidateEvidenceCount = result.checks.reduce((sum, c) => sum + (c.candidateEvidence?.length ?? 0), 0);

  const summary: AndroidAuditSummary = {
    requested: true,
    applicable: isApplicable,
    status: "completed",
    verdict: result.verdict,
    totalChecks: result.checks.length,
    passedChecks,
    checksWithFindings,
    candidateOnlyChecks,
    skippedChecks,
    inconclusiveChecks,
    failedChecks,
    confirmedFindingCount: result.findings.length,
    mappedIssueCount: issues.length,
    candidateEvidenceCount,
    // No Gradle/external-tool programmatic passthrough exists yet in Batch 2
    // (see securityAuditTypes.ts's AndroidAuditSummary comment) — the default
    // request always executes zero of either.
    requestedGradleOperationCount: 0,
    executedGradleOperationCount: 0,
    requestedExternalToolCount: 0,
    executedExternalToolCount: 0,
    skippedExternalToolCount: 0,
    reportPaths,
    warnings: result.warnings,
    errors: [...result.errors, ...writeErrors],
    candidateSummary: buildCandidateSummary(result.checks),
  };

  return { issues, summary };
}
