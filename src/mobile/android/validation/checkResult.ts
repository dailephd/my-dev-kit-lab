import type { CommandExecutionResult, SecurityFinding } from "../../../securityValidation/types.js";
import type { MobileConfidence } from "../../types.js";
import { ANDROID_ADVANCED_CHECK_CATEGORIES } from "../advancedSecurity/ruleIds.js";
import type { CandidateEvidence } from "../advancedSecurity/candidateEvidence.js";

// ---------------------------------------------------------------------------
// v0.4.0 Batch 1 — Android check-result and skip-representation contracts.
//
// Reuses SecurityFinding and CommandExecutionResult from the existing
// security-validation types rather than duplicating a finding/command-result
// schema. Android needs a wider status vocabulary than SecurityCheckStatus
// ("passed"/"failed"/"skipped"/"warning") because static Android checks can
// be genuinely inconclusive or unsupported on a given project, and
// command-backed checks can error out before producing a verdict-relevant
// result — none of those outcomes may ever be normalized as "passed".
// ---------------------------------------------------------------------------

export const ANDROID_CHECK_STATUSES = [
  "passed",
  "failed",
  "skipped",
  "inconclusive",
  "unsupported",
  "not-run",
  "error",
] as const;
export type AndroidCheckStatus = (typeof ANDROID_CHECK_STATUSES)[number];

// Statuses that must never be treated as a passing result by a verdict
// calculator. Defined once here so later batches share one source of truth.
export const ANDROID_NON_PASSING_STATUSES: readonly AndroidCheckStatus[] = [
  "failed",
  "skipped",
  "inconclusive",
  "unsupported",
  "not-run",
  "error",
];

// v0.4.0 Batch 3 — added "android-intent-filters" (additive) so the intent-
// filter audit has its own category distinct from "android-components",
// which covers exported-component evidence generally.
// v0.4.0 Batch 5 — added "android-target-immutability" (additive) for the
// required target mutation/immutability check (agents.txt Batch 5 section
// 10.1).
// v0.4.1 Batch 1 — added the advanced-security check-category families
// (network/backup/release/secrets/signing/webview/file-provider/sensitive-
// storage/sensitive-logging/clipboard/firebase/optional-tool) required by
// later v0.4.1 batches. These categories are additive only: no check in this
// batch is registered against them yet (see advancedSecurity/ruleIds.ts).
export const ANDROID_CHECK_CATEGORIES = [
  "android-detection",
  "android-manifest",
  "android-gradle",
  "android-permissions",
  "android-components",
  "android-intent-filters",
  "android-deep-links",
  "android-release-metadata",
  "android-play-readiness",
  "android-target-immutability",
  ...ANDROID_ADVANCED_CHECK_CATEGORIES,
] as const;
export type AndroidCheckCategory = (typeof ANDROID_CHECK_CATEGORIES)[number];

export type AndroidCheckRequirementLevel = "required" | "optional";

export type AndroidCheckSkipInfo = {
  checkId: string;
  reason: string;
  requirementLevel: AndroidCheckRequirementLevel;
  missingCapability?: string;
  verdictImpact: string;
  recommendedNextAction: string;
};

export type AndroidCheckResult = {
  id: string;
  category: AndroidCheckCategory;
  title: string;
  status: AndroidCheckStatus;
  requirementLevel: AndroidCheckRequirementLevel;
  ran: boolean;
  skipped: boolean;
  skipInfo?: AndroidCheckSkipInfo;
  evidence: string[];
  findings: SecurityFinding[];
  warnings: string[];
  errors: string[];
  durationMs?: number;
  command?: CommandExecutionResult;
  sourcePaths: string[];
  confidence: MobileConfidence;
  environmentRequirements: string[];
  targetModificationObserved?: boolean;
  // v0.4.1 Batch 2 — optional review-oriented, non-confirmed evidence (Batch
  // 1's CandidateEvidence contract) produced by advanced-security checks.
  // Additive and optional: existing checks/tests that never populate it are
  // unaffected. Distinct from `findings` (SecurityFinding[]), which remains
  // reserved for confirmed, conservative findings.
  candidateEvidence?: CandidateEvidence[];
};

export function isPassingAndroidStatus(status: AndroidCheckStatus): boolean {
  return status === "passed";
}
