import type { ReleaseVerdict, SecurityCheckResult, SecurityFinding, SecuritySeverity } from "../types.js";
import { VERDICT_IMPACTS } from "../types.js";

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

// ---------------------------------------------------------------------------
// v0.2.2 Batch 5 — fail-on severity threshold
//
// --fail-on uses a separate vocabulary (blocker/high/medium/low) from
// SecuritySeverity (blocker/major/minor/informational/skipped) — Batch 1
// deliberately kept these distinct. This maps one onto the other so a
// --fail-on breach can be detected without renaming any existing severity.
// Mapping (conservative — never understates a blocker-level finding):
//   blocker fail-on -> only "blocker" severity findings breach it
//   high    fail-on -> "blocker" or "major" ("major" is treated as "high")
//   medium  fail-on -> "blocker", "major", or "minor" ("minor" -> "medium")
//   low     fail-on -> "blocker", "major", "minor", or "informational"
// "skipped" severity never breaches any threshold — a skipped optional tool
// is not a finding.
// ---------------------------------------------------------------------------

const SEVERITY_THRESHOLD_RANK: Record<SecuritySeverity, number> = {
  blocker: 4,
  major: 3,
  minor: 2,
  informational: 1,
  skipped: 0,
};

const FAIL_ON_THRESHOLD_RANK: Record<"blocker" | "high" | "medium" | "low", number> = {
  blocker: 4,
  high: 3,
  medium: 2,
  low: 1,
};

export function severityMeetsFailOnThreshold(
  severity: SecuritySeverity,
  threshold: "blocker" | "high" | "medium" | "low"
): boolean {
  return SEVERITY_THRESHOLD_RANK[severity] >= FAIL_ON_THRESHOLD_RANK[threshold];
}

// True when at least one finding's severity breaches the given --fail-on
// threshold. Callers should OR this with the existing verdict-based exit
// decision, never use it to replace/weaken that decision — this only adds
// stricter exit-1 triggers for --fail-on medium/low (which the default
// verdict policy doesn't already cover via its blocker/major rules); for
// --fail-on blocker/high it is always a no-op given the existing policy.
export function findingsBreachFailOnThreshold(
  findings: readonly SecurityFinding[],
  threshold: "blocker" | "high" | "medium" | "low"
): boolean {
  return findings.some((f) => severityMeetsFailOnThreshold(f.severity, threshold));
}

// ---------------------------------------------------------------------------
// v0.2.2 Batch 5 — verdict-reason categorization
//
// A second, additive classification axis (separate from SecurityCheckCategory
// and SecuritySeverity) that explains *why* a check contributed to the
// verdict: was it a classic scanner finding, an adversarial-scenario
// failure, an optional skipped tool, missing required evidence, or a
// blocker — and if a blocker, is it about the target project, the
// lab/report-generation framework itself, or general release readiness?
// Used only for report summary/reasoning; does not change calculateVerdict().
// ---------------------------------------------------------------------------

export type VerdictReasonCategory =
  | "release-blocker"
  | "target-project-blocker"
  | "tool-framework-blocker"
  | "environment-inconclusive"
  | "optional-skipped-tool"
  | "adversarial-scenario-skipped"
  | "scanner-finding"
  | "adversarial-scenario-failure"
  | "required-evidence-missing"
  | "informational-evidence";

export const VERDICT_REASON_CATEGORIES: readonly VerdictReasonCategory[] = [
  "release-blocker",
  "target-project-blocker",
  "tool-framework-blocker",
  "environment-inconclusive",
  "optional-skipped-tool",
  "adversarial-scenario-skipped",
  "scanner-finding",
  "adversarial-scenario-failure",
  "required-evidence-missing",
  "informational-evidence",
];

// v0.2.2 Batch 6: scenario blocker-impact classification now comes directly
// from SecurityCheckResult.verdictImpact (carried through from the
// originating AttackScenario's static declaration — see attackScenario.ts /
// attackResult.ts). verdict.ts no longer owns a separate scenario-id map, so
// there is nothing to keep in sync when a new scenario is registered — as
// long as the scenario declares verdictImpact, categorization is correct
// automatically. Checks with no verdictImpact but a scenario-shaped id
// (placeholder/error results, or a scenario that doesn't declare one) fall
// back to the generic "adversarial-scenario-failure"/"-skipped" buckets.
//
// A check is "scenario-shaped" if it carries a verdictImpact OR its id
// matches the synthetic placeholder/error patterns produced by
// attackRunner.ts for unregistered checks or runner crashes (those never
// carry verdictImpact since there's no real AttackScenario object).
function isAttackScenarioCheckId(id: string): boolean {
  return id.endsWith("-no-scenarios-registered") || id.endsWith("-attack-runner-error");
}

// Categorizes a single check for verdict-reasoning purposes. Returns null
// for passed/warning checks — those don't need a blocker-reasoning bucket.
export function categorizeCheck(check: SecurityCheckResult): VerdictReasonCategory | null {
  const scenario = isAttackScenarioCheckId(check.id) || check.verdictImpact !== undefined;

  if (check.status === "skipped") {
    if (scenario) return "adversarial-scenario-skipped";
    if (MANDATORY_CHECK_IDS.has(check.id)) return "required-evidence-missing";
    return "optional-skipped-tool";
  }

  if (check.status === "failed") {
    if (check.verdictImpact && (VERDICT_IMPACTS as readonly string[]).includes(check.verdictImpact)) {
      return check.verdictImpact;
    }
    if (scenario) return "adversarial-scenario-failure";
    if (check.severity === "informational") return "informational-evidence";
    return "scanner-finding";
  }

  return null;
}

export type VerdictReasonSummary = {
  releaseBlockerCount: number;
  targetProjectBlockerCount: number;
  toolFrameworkBlockerCount: number;
  environmentInconclusiveCount: number;
  optionalSkippedToolCount: number;
  adversarialScenarioSkippedCount: number;
  scannerFindingCount: number;
  adversarialScenarioFailureCount: number;
  requiredEvidenceMissingCount: number;
  informationalEvidenceCount: number;
};

// Aggregates categorizeCheck() across all checks, plus a direct informational
// finding count (informational findings don't get their own check-level
// bucket since a check can carry multiple findings of mixed severity).
export function summarizeVerdictReasoning(
  checks: readonly SecurityCheckResult[],
  findings: readonly SecurityFinding[]
): VerdictReasonSummary {
  const summary: VerdictReasonSummary = {
    releaseBlockerCount: 0,
    targetProjectBlockerCount: 0,
    toolFrameworkBlockerCount: 0,
    environmentInconclusiveCount: 0,
    optionalSkippedToolCount: 0,
    adversarialScenarioSkippedCount: 0,
    scannerFindingCount: 0,
    adversarialScenarioFailureCount: 0,
    requiredEvidenceMissingCount: 0,
    informationalEvidenceCount: 0,
  };

  for (const check of checks) {
    const category = categorizeCheck(check);
    switch (category) {
      case "release-blocker":
        summary.releaseBlockerCount++;
        break;
      case "target-project-blocker":
        summary.targetProjectBlockerCount++;
        break;
      case "tool-framework-blocker":
        summary.toolFrameworkBlockerCount++;
        break;
      case "environment-inconclusive":
        summary.environmentInconclusiveCount++;
        break;
      case "optional-skipped-tool":
        summary.optionalSkippedToolCount++;
        break;
      case "adversarial-scenario-skipped":
        summary.adversarialScenarioSkippedCount++;
        break;
      case "scanner-finding":
        summary.scannerFindingCount++;
        break;
      case "adversarial-scenario-failure":
        summary.adversarialScenarioFailureCount++;
        break;
      case "required-evidence-missing":
        summary.requiredEvidenceMissingCount++;
        break;
      case "informational-evidence":
      case null:
        break;
    }
  }

  summary.informationalEvidenceCount = findings.filter((f) => f.severity === "informational").length;

  return summary;
}
