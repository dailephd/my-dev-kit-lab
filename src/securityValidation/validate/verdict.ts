import type { ReleaseVerdict, SecurityCheckResult, SecurityFinding } from "../types.js";

// ---------------------------------------------------------------------------
// Verdict calculation
//
// Rules (evaluated in order, first match wins):
//   1. Any blocker finding                          → not-ready-security-blocker-remains
//   2. Any mandatory check "failed"                 → not-ready-security-blocker-remains
//   3. Too many mandatory checks skipped (>= 4)    → inconclusive-audit-environment-incomplete
//   4. Any major finding                            → not-ready-security-blocker-remains
//   5. Any optional check skipped                  → ready-except-optional-manual-checks
//   6. Otherwise                                    → ready-for-release-preparation
// ---------------------------------------------------------------------------

// Checks that must not be skipped for a clean verdict.
const MANDATORY_CHECK_IDS = new Set([
  "npm-audit-full",
  "npm-audit-runtime",
  "npm-pack-dry-run",
  "source-files-not-modified",
  "writes-limited-to-output",
]);

export function calculateVerdict(
  checks: SecurityCheckResult[],
  findings: SecurityFinding[]
): { verdict: ReleaseVerdict; recommendedNextStep: string } {
  const blockerFindings = findings.filter((f) => f.severity === "blocker");
  const majorFindings = findings.filter((f) => f.severity === "major");
  const failedMandatory = checks.filter(
    (c) => MANDATORY_CHECK_IDS.has(c.id) && c.status === "failed"
  );
  const skippedMandatory = checks.filter(
    (c) => MANDATORY_CHECK_IDS.has(c.id) && c.status === "skipped"
  );
  const skippedOptional = checks.filter(
    (c) => !MANDATORY_CHECK_IDS.has(c.id) && c.status === "skipped"
  );

  if (blockerFindings.length > 0) {
    return {
      verdict: "not-ready-security-blocker-remains",
      recommendedNextStep: `Fix ${blockerFindings.length} blocker finding(s) before release: ${blockerFindings.map((f) => f.title).join("; ")}`,
    };
  }

  if (failedMandatory.length > 0) {
    return {
      verdict: "not-ready-security-blocker-remains",
      recommendedNextStep: `Mandatory check(s) failed: ${failedMandatory.map((c) => c.name).join(", ")}. Investigate and re-run security:validate.`,
    };
  }

  if (skippedMandatory.length >= 4) {
    return {
      verdict: "inconclusive-audit-environment-incomplete",
      recommendedNextStep: `Too many mandatory checks were skipped (${skippedMandatory.length}). Ensure npm, npm audit, and package tools are available.`,
    };
  }

  if (majorFindings.length > 0) {
    return {
      verdict: "not-ready-security-blocker-remains",
      recommendedNextStep: `Fix or review ${majorFindings.length} major finding(s) before release: ${majorFindings.map((f) => f.title).join("; ")}`,
    };
  }

  if (skippedOptional.length > 0) {
    const names = skippedOptional.map((c) => c.name).join(", ");
    return {
      verdict: "ready-except-optional-manual-checks",
      recommendedNextStep: `Optional check(s) were skipped due to unavailable tools: ${names}. Run manually if possible before publishing.`,
    };
  }

  return {
    verdict: "ready-for-release-preparation",
    recommendedNextStep:
      "All mandatory checks passed. Proceed with version bump, changelog, and npm publish checklist.",
  };
}

export function verdictToHumanLabel(verdict: ReleaseVerdict): string {
  switch (verdict) {
    case "ready-for-release-preparation":
      return "ready for release preparation";
    case "not-ready-security-blocker-remains":
      return "not ready: security blocker remains";
    case "ready-except-optional-manual-checks":
      return "ready except optional manual checks";
    case "inconclusive-audit-environment-incomplete":
      return "inconclusive: audit environment incomplete";
  }
}
