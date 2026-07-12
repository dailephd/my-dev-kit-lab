import type { SecurityFinding, SecuritySeverity } from "../../securityValidation/types.js";
import type { AuditEvidence, AuditIssue } from "../core/auditIssue.js";
import { makeAuditEvidence } from "../core/auditIssue.js";
import type { AuditConfidence, AuditFalsePositiveRisk, AuditSeverity } from "../core/auditTypes.js";

// ---------------------------------------------------------------------------
// v0.3.2 Batch 4 — maps a structured SecurityFinding (already produced by the
// existing securityValidation framework — see src/securityValidation/types.ts)
// into an AuditIssue. Pure, no I/O, no re-running of any check: this module
// only translates one already-computed result shape into another. Skipped
// optional checks never reach this function at all (see
// securityAuditAdapter.ts) — only findings attached to executed checks are
// mapped, so "skipped" never silently becomes an issue or a passed result.
// ---------------------------------------------------------------------------

export const SECURITY_AUDIT_DETECTOR_ID = "security-validation-adapter";

// SecuritySeverity -> AuditSeverity. Conservative mapping: "major" (a
// mandatory-check-adjacent severity in the security-validation verdict
// policy, see verdict.ts's calculateVerdict) maps to "high", never "medium",
// so a security major finding is never understated relative to a code-rot
// "high". "skipped" is not a real finding severity in practice (skippedCheck()
// in runSecurityValidation.ts sets it on the SecurityCheckResult, not on a
// SecurityFinding) but is mapped defensively to "info" for type completeness.
const SEVERITY_MAP: Record<SecuritySeverity, AuditSeverity> = {
  blocker: "blocker",
  major: "high",
  minor: "medium",
  informational: "info",
  skipped: "info",
};

// Security findings originate from already-executed, structured scanners/
// checks (npm audit, CodeQL, Semgrep, package-content inspection) rather than
// from a per-finding confidence value — SecurityFinding carries no confidence
// field of its own. "medium" is a conservative default that neither
// overstates a scanner's certainty (npm audit CVE matches can be version-range
// false positives) nor discounts it as unreliable.
const DEFAULT_CONFIDENCE: AuditConfidence = "medium";
const DEFAULT_FALSE_POSITIVE_RISK: AuditFalsePositiveRisk = "medium";

// Exported so other SecurityFinding-consuming mappers (e.g. the Android
// audit-adapter mapper, v0.4.2 Batch 1) reuse the same conservative
// severity policy instead of defining a second one.
export function mapSecuritySeverityToAuditSeverity(severity: SecuritySeverity): AuditSeverity {
  return SEVERITY_MAP[severity];
}

// Mirrors verdict.ts's calculateVerdict: blocker and major findings are what
// drive a "not-ready-security-blocker-remains" verdict — minor/informational
// findings never block release or implementation on their own. Exported for
// reuse by other SecurityFinding-consuming mappers.
export function isBlockingSecuritySeverity(severity: SecuritySeverity): boolean {
  return severity === "blocker" || severity === "major";
}

export function mapSecurityFindingToAuditIssue(finding: SecurityFinding): AuditIssue {
  const severity = mapSecuritySeverityToAuditSeverity(finding.severity);
  const isBlockingSeverity = isBlockingSecuritySeverity(finding.severity);

  const evidence: AuditEvidence[] = finding.evidence
    ? [
        makeAuditEvidence({
          kind: "observation",
          message: `Security validation (${finding.category}): ${finding.title}`,
          excerpt: finding.evidence,
          source: `security-validation:${finding.category}`,
          confidence: DEFAULT_CONFIDENCE,
        }),
      ]
    : [];

  return {
    id: `security:${finding.id}`,
    auditType: "security",
    detectorId: SECURITY_AUDIT_DETECTOR_ID,
    title: finding.title,
    description: finding.description,
    severity,
    confidence: DEFAULT_CONFIDENCE,
    falsePositiveRisk: DEFAULT_FALSE_POSITIVE_RISK,
    category: finding.category,
    evidence,
    affectedFiles: finding.affectedFiles ?? [],
    recommendedAction: finding.recommendation ?? "Review the security validation report for remediation guidance.",
    suggestedFixStrategy: finding.recommendation ?? "See the linked security validation report for details.",
    validationCommands: ["npm run security:validate"],
    releaseBlocking: isBlockingSeverity,
    implementationBlocking: isBlockingSeverity,
    autoFixEligible: false,
  };
}
