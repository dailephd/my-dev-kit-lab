import type { AuditIssue } from "./auditIssue.js";
import type { AuditFailOnThreshold, AuditSeverity } from "./auditTypes.js";

// ---------------------------------------------------------------------------
// v0.3.0 Batch 1 — audit exit code policy.
//
// 0 = no issue met the --fail-on threshold (and no config/target/runtime
//     error occurred).
// 1 = at least one issue met or exceeded the --fail-on threshold.
// 2 = invalid config, invalid target, or an audit runtime failure. This
//     code is never returned by calculateAuditExitCode() below (a pure,
//     issue-driven function) -- it is the caller's (scripts/audits/
//     runAudit.ts) responsibility to catch parse/config/target errors and
//     exit with AUDIT_EXIT_CODES.FATAL_ERROR directly, mirroring how
//     scripts/security/validate.ts handles its own parse/target try/catch.
// ---------------------------------------------------------------------------

export const AUDIT_EXIT_CODES = {
  SUCCESS: 0,
  THRESHOLD_BREACHED: 1,
  FATAL_ERROR: 2,
} as const;

// "info" is a valid issue severity but is intentionally below every
// selectable --fail-on threshold (including "low") -- it can never breach.
const SEVERITY_RANK: Record<AuditSeverity, number> = {
  info: 0,
  low: 1,
  medium: 2,
  high: 3,
  blocker: 4,
};

// "none" ranks above every severity so it can never be breached.
const THRESHOLD_RANK: Record<AuditFailOnThreshold, number> = {
  low: 1,
  medium: 2,
  high: 3,
  blocker: 4,
  none: Number.POSITIVE_INFINITY,
};

export function issueBreachesFailOnThreshold(severity: AuditSeverity, failOn: AuditFailOnThreshold): boolean {
  if (failOn === "none") return false;
  return SEVERITY_RANK[severity] >= THRESHOLD_RANK[failOn];
}

// v0.3.0 Batch 5 — additive export. Report-building code (src/audits/report/
// auditReportModel.ts) needs the same severity ranking to compute a
// "highest severity present" summary field, and must not hardcode a second
// copy of this table (see Batch 5 spec 3.2). Signature/behavior of the two
// functions above is unchanged.
export function getHighestSeverity(issues: readonly AuditIssue[]): AuditSeverity | null {
  if (issues.length === 0) return null;
  let highest: AuditSeverity = issues[0].severity;
  for (const issue of issues) {
    if (SEVERITY_RANK[issue.severity] > SEVERITY_RANK[highest]) {
      highest = issue.severity;
    }
  }
  return highest;
}

export type AuditExitDecision = {
  exitCode: number;
  reason: string;
};

// Pure function: given a final issue list and the configured --fail-on
// threshold, decides between SUCCESS and THRESHOLD_BREACHED. Never returns
// FATAL_ERROR -- see file header.
export function calculateAuditExitCode(issues: readonly AuditIssue[], failOn: AuditFailOnThreshold): AuditExitDecision {
  if (failOn === "none") {
    return { exitCode: AUDIT_EXIT_CODES.SUCCESS, reason: "--fail-on none: findings never block the command." };
  }

  const breaching = issues.filter((issue) => issueBreachesFailOnThreshold(issue.severity, failOn));
  if (breaching.length > 0) {
    return {
      exitCode: AUDIT_EXIT_CODES.THRESHOLD_BREACHED,
      reason: `${breaching.length} issue(s) met or exceeded the --fail-on ${failOn} threshold.`,
    };
  }

  return {
    exitCode: AUDIT_EXIT_CODES.SUCCESS,
    reason: `No issues met the --fail-on ${failOn} threshold.`,
  };
}
