import type { SecurityFinding } from "../../securityValidation/types.js";
import type { MobileConfidence } from "../../mobile/types.js";
import type { AuditEvidence, AuditIssue } from "../core/auditIssue.js";
import { makeAuditEvidence } from "../core/auditIssue.js";
import type { AuditConfidence, AuditFalsePositiveRisk } from "../core/auditTypes.js";
import { isBlockingSecuritySeverity, mapSecuritySeverityToAuditSeverity } from "./mapSecurityFindingToAuditIssue.js";
import type { SecurityAuditReportPaths } from "./securityAuditTypes.js";

// ---------------------------------------------------------------------------
// v0.4.2 Batch 1 — pure Android SecurityFinding -> AuditIssue mapper.
//
// Android checks already reuse SecurityFinding as-is (see
// src/mobile/android/audit/androidFinding.ts's own header comment) — there is
// no parallel "AndroidSecurityFinding" type. What Android findings lose by
// reusing the generic SecurityFinding shape is per-family taxonomy: every
// Android finding's own `category` is the single shared value "static-scan"
// (a SecurityCheckCategory), while the *specific* Android family (backup,
// secrets, webview, ...) only lives on the owning AndroidCheckResult.category.
// This mapper therefore takes a small AndroidAuditMappingContext alongside
// the finding — supplied by the (future Batch 2) caller that already has the
// owning AndroidCheckResult in hand — rather than trying to recover that
// context by parsing the finding's own opaque id/evidence text.
//
// Reuses mapSecurityFindingToAuditIssue's severity/blocking policy exactly
// (SecuritySeverity is the same shared type for Android and non-Android
// findings) instead of defining a second severity table. Pure, no I/O, no
// mutation, no CandidateEvidence handling — CandidateEvidence is a distinct
// type (see src/mobile/android/advancedSecurity/candidateEvidence.ts) and
// cannot be passed here at all: this function's parameter type is
// SecurityFinding, not CandidateEvidence.
// ---------------------------------------------------------------------------

export const ANDROID_SECURITY_AUDIT_DETECTOR_ID = "android-security-validation-adapter";

const DEFAULT_CONFIDENCE: AuditConfidence = "medium";
const DEFAULT_FALSE_POSITIVE_RISK: AuditFalsePositiveRisk = "medium";

// MobileConfidence carries an extra "unknown" state SecurityFinding-derived
// AuditConfidence has no equivalent for; mapped to the same conservative
// "medium" default the generic security mapper uses when no per-finding
// confidence exists at all, rather than inventing a fourth AuditConfidence
// value.
function mapCheckConfidenceToAuditConfidence(confidence: MobileConfidence | undefined): AuditConfidence {
  if (confidence === "high" || confidence === "medium" || confidence === "low") return confidence;
  return DEFAULT_CONFIDENCE;
}

// Minimal context a caller must supply alongside a confirmed Android
// SecurityFinding — every field here is required by later v0.4.2 batches
// (Batch 2's programmatic adapter invocation) to preserve Android provenance
// that the bare SecurityFinding cannot carry on its own.
export type AndroidAuditMappingContext = {
  // The owning AndroidCheckResult.id, e.g. "android-backup-configuration-audit".
  checkId: string;
  // The owning AndroidCheckResult.category, e.g. "android-backup-configuration".
  // Kept as `string` here (rather than importing AndroidCheckCategory) so this
  // pure mapper does not take on a compile-time dependency on the full Android
  // check-category union; callers already have a real AndroidCheckCategory
  // value and TypeScript accepts it as a string.
  checkCategory: string;
  // The owning AndroidCheckResult.confidence, when available.
  checkConfidence?: MobileConfidence;
  // Set only for findings produced by an optional external-tool check
  // (semgrep/osv/android-lint/dependency-check), preserving tool provenance.
  externalToolId?: string;
  // Paths to the original, full Android security-validation report (the same
  // shape the existing generic security adapter already uses for its own
  // report reference) — preserves provenance without embedding the complete
  // Android report inside every mapped issue. Absent/null when the caller has
  // not yet written a report (e.g. this pure mapper called outside the
  // adapter, as in unit tests).
  reportReference?: SecurityAuditReportPaths;
};

// makeAndroidFinding (src/mobile/android/audit/androidFinding.ts) is the sole
// place Android findings compose their `evidence` string, always in the exact
// form `location=<relativePath>(:<line>)?` (optionally followed by further
// ` | `-joined detail segments). Extracting the line from that well-known,
// single-producer format is not fabricating a source position — it is
// reading a real value the same codebase already wrote, deterministically.
// Guarded so a value is only trusted when its path matches the finding's own
// affectedFiles[0]; anything else is left absent rather than guessed.
const LOCATION_EVIDENCE_PATTERN = /(?:^|\s\|\s)location=([^\s|]+)/;

function extractAndroidFindingLine(finding: SecurityFinding): number | undefined {
  if (!finding.evidence) return undefined;
  const relativePath = finding.affectedFiles?.[0];
  if (!relativePath) return undefined;
  const match = LOCATION_EVIDENCE_PATTERN.exec(finding.evidence);
  if (!match) return undefined;
  const [locationPath, lineText] = match[1].split(":");
  if (locationPath !== relativePath || lineText === undefined) return undefined;
  const line = Number(lineText);
  return Number.isInteger(line) && line > 0 ? line : undefined;
}

export function mapAndroidSecurityFindingToAuditIssue(
  finding: SecurityFinding,
  context: AndroidAuditMappingContext
): AuditIssue {
  const severity = mapSecuritySeverityToAuditSeverity(finding.severity);
  const isBlockingSeverity = isBlockingSecuritySeverity(finding.severity);
  const relativePath = finding.affectedFiles?.[0];
  const line = extractAndroidFindingLine(finding);

  const provenanceSuffix = context.externalToolId ? `, tool=${context.externalToolId}` : "";
  const evidence: AuditEvidence[] = finding.evidence
    ? [
        makeAuditEvidence({
          kind: "observation",
          message: `Android security validation (${context.checkId}${provenanceSuffix}): ${finding.title}`,
          excerpt: finding.evidence,
          filePath: relativePath,
          line,
          source: `android-security-validation:${context.checkId}`,
          confidence: mapCheckConfidenceToAuditConfidence(context.checkConfidence),
        }),
      ]
    : [];

  const reportPath = context.reportReference?.json ?? context.reportReference?.text ?? undefined;
  if (reportPath) {
    evidence.push(
      makeAuditEvidence({
        kind: "reference",
        message: "Original Android security-validation report",
        filePath: reportPath,
        source: "android-security-validation:report",
        confidence: DEFAULT_CONFIDENCE,
      })
    );
  }

  return {
    id: `android:${context.checkId}:${finding.id}`,
    auditType: "security",
    detectorId: ANDROID_SECURITY_AUDIT_DETECTOR_ID,
    title: finding.title,
    description: finding.description,
    severity,
    confidence: mapCheckConfidenceToAuditConfidence(context.checkConfidence),
    falsePositiveRisk: DEFAULT_FALSE_POSITIVE_RISK,
    // Deliberately the Android-specific check category (e.g.
    // "android-backup-configuration"), not finding.category — every Android
    // finding's own `category` is the single shared "static-scan" value, so
    // reusing it here would make every mapped Android issue's category
    // uselessly uniform. See module header comment.
    category: context.checkCategory,
    evidence,
    affectedFiles: finding.affectedFiles ?? [],
    recommendedAction: finding.recommendation ?? "Review the Android security validation report for remediation guidance.",
    suggestedFixStrategy: finding.recommendation ?? "See the linked Android security validation report for details.",
    validationCommands: ["npm run security:validate -- --profile android"],
    releaseBlocking: isBlockingSeverity,
    implementationBlocking: isBlockingSeverity,
    autoFixEligible: false,
  };
}
