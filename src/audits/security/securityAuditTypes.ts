import type { ReleaseVerdict } from "../../securityValidation/types.js";
import type { VerdictReasonSummary } from "../../securityValidation/validate/verdict.js";
import type { CandidateConfidence, CandidateResolutionState } from "../../mobile/android/advancedSecurity/candidateEvidence.js";
import type { AndroidVerdictValue } from "../../mobile/android/validation/result.js";

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

// ---------------------------------------------------------------------------
// v0.4.2 Batch 2 — programmatic Android integration request/result surface.
//
// The Android request is deliberately internal/programmatic-only in Batch 2
// (no CLI flag exists yet — see agents.txt Batch 2 scope). `enabled: true` is
// the only literal value on purpose: there is nothing to "disable" once a
// caller opts in, and an absent `android` field on the adapter's own options
// is what represents "not requested", not a boolean `false` on this object.
// ---------------------------------------------------------------------------

export type AndroidAuditRequest = {
  enabled: true;
};

// Mirrors SecurityAuditReportSummary's own `ran`-first, always-present
// convention: a status literal rather than inferring "did it run" from
// nullable fields, so callers/tests can switch on one value instead of
// reconstructing a state machine from several optional fields.
export const ANDROID_AUDIT_STATUSES = ["not-requested", "not-applicable", "completed", "failed"] as const;
export type AndroidAuditStatus = (typeof ANDROID_AUDIT_STATUSES)[number];

export type AndroidAuditCandidateSummary = {
  totalCount: number;
  checksWithCandidates: number;
  // Every MobileConfidence/CandidateResolutionState key is always present
  // (zeroed when absent) rather than a sparse object, so equal input always
  // serializes identically regardless of which confidence/resolution values
  // happened to appear in a given run — deterministic key ordering matters
  // more here than a smaller payload.
  byConfidence: Record<CandidateConfidence, number>;
  byResolutionState: Record<CandidateResolutionState, number>;
  // Keyed by the candidate's own AndroidAdvancedCheckCategory value (kept as
  // `string` here to avoid this report-surface type taking on a compile-time
  // dependency on the full Android category union). Keys are inserted in
  // sorted order for determinism.
  byCategory: Record<string, number>;
};

export const EMPTY_ANDROID_AUDIT_CANDIDATE_SUMMARY: AndroidAuditCandidateSummary = {
  totalCount: 0,
  checksWithCandidates: 0,
  byConfidence: { unknown: 0, low: 0, medium: 0, high: 0 },
  byResolutionState: { resolved: 0, unresolved: 0, missing: 0, malformed: 0, unsupported: 0, "not-applicable": 0 },
  byCategory: {},
};

export type AndroidAuditSummary = {
  // False when Android integration was not requested for this run — every
  // other field is a null/zero/not-requested placeholder in that case,
  // mirroring SecurityAuditReportSummary.ran.
  requested: boolean;
  // null only when not requested; false for a real, completed non-Android
  // target — never a fake "true" just because validation didn't throw.
  applicable: boolean | null;
  status: AndroidAuditStatus;
  verdict: AndroidVerdictValue | null;
  totalChecks: number;
  passedChecks: number;
  checksWithFindings: number;
  candidateOnlyChecks: number;
  skippedChecks: number;
  inconclusiveChecks: number;
  failedChecks: number;
  confirmedFindingCount: number;
  mappedIssueCount: number;
  candidateEvidenceCount: number;
  // Always 0 in Batch 2 — no Gradle/external-tool programmatic passthrough
  // exists yet (deferred; see agents.txt Batch 2 section 9). Present now so
  // Batch 3 does not need another additive field just to populate them.
  requestedGradleOperationCount: number;
  executedGradleOperationCount: number;
  requestedExternalToolCount: number;
  executedExternalToolCount: number;
  skippedExternalToolCount: number;
  reportPaths: SecurityAuditReportPaths;
  warnings: string[];
  errors: string[];
  candidateSummary: AndroidAuditCandidateSummary;
};

export const ANDROID_AUDIT_NOT_REQUESTED_SUMMARY: AndroidAuditSummary = {
  requested: false,
  applicable: null,
  status: "not-requested",
  verdict: null,
  totalChecks: 0,
  passedChecks: 0,
  checksWithFindings: 0,
  candidateOnlyChecks: 0,
  skippedChecks: 0,
  inconclusiveChecks: 0,
  failedChecks: 0,
  confirmedFindingCount: 0,
  mappedIssueCount: 0,
  candidateEvidenceCount: 0,
  requestedGradleOperationCount: 0,
  executedGradleOperationCount: 0,
  requestedExternalToolCount: 0,
  executedExternalToolCount: 0,
  skippedExternalToolCount: 0,
  reportPaths: { text: null, json: null },
  warnings: [],
  errors: [],
  candidateSummary: EMPTY_ANDROID_AUDIT_CANDIDATE_SUMMARY,
};
