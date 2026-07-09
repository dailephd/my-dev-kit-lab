import type { ReleaseVerdict } from "../../securityValidation/types.js";
import type { VerdictReasonSummary } from "../../securityValidation/validate/verdict.js";

// ---------------------------------------------------------------------------
// v0.3.2 Batch 4 — security audit adapter report surface.
//
// Same "condensed, always-present, additive top-level report field" shape as
// SourceFactsReportSummary/PythonProjectMetadataSnapshot (see
// auditReportModel.ts) — never undefined on AuditReportModel, so JSON/text
// consumers don't need an `if (securitySummary)` guard. `ran` is what
// distinguishes "security type wasn't selected for this run" from "it ran
// and found nothing" — all other fields are null/zeroed when `ran` is false.
// ---------------------------------------------------------------------------

export type SecurityAuditFindingCounts = {
  blocker: number;
  major: number;
  minor: number;
  informational: number;
};

export type SecurityAuditReportPaths = {
  text: string | null;
  json: string | null;
};

export type SecurityAuditReportSummary = {
  // False when `--types` did not include "security" for this run — every
  // other field is a null/zero placeholder in that case, never a fake
  // "passed" result.
  ran: boolean;
  verdict: ReleaseVerdict | null;
  verdictLabel: string | null;
  recommendedNextStep: string | null;
  targetDescription: string | null;
  isSelf: boolean | null;
  totalChecks: number;
  checksPassed: number;
  checksWarning: number;
  checksFailed: number;
  checksSkipped: number;
  findingCounts: SecurityAuditFindingCounts;
  // Count of SecurityFinding entries mapped into AuditIssue[] for this run
  // (equal to findingCounts summed) — kept as its own field so report
  // renderers don't need to re-sum findingCounts themselves.
  mappedIssueCount: number;
  verdictReasonSummary: VerdictReasonSummary | null;
  // Paths to the original, full security-validation reports generated under
  // reports/security/ — the audit report links to these rather than
  // duplicating their contents.
  reportPaths: SecurityAuditReportPaths;
};

export const SECURITY_AUDIT_NOT_RUN_SUMMARY: SecurityAuditReportSummary = {
  ran: false,
  verdict: null,
  verdictLabel: null,
  recommendedNextStep: null,
  targetDescription: null,
  isSelf: null,
  totalChecks: 0,
  checksPassed: 0,
  checksWarning: 0,
  checksFailed: 0,
  checksSkipped: 0,
  findingCounts: { blocker: 0, major: 0, minor: 0, informational: 0 },
  mappedIssueCount: 0,
  verdictReasonSummary: null,
  reportPaths: { text: null, json: null },
};
