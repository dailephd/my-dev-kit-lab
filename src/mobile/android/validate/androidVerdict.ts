import type { ReleaseVerdict, SecurityFinding } from "../../../securityValidation/types.js";
import type { AndroidDetectionResult } from "../detection.js";
import type { AndroidCheckResult } from "../validation/checkResult.js";
import type { AndroidVerdictReason } from "../validation/result.js";
import type { AndroidPlayReadinessChecklist } from "./playReadinessChecklist.js";
import type { TargetMutationReport } from "../gradle/validate/targetMutation.js";

// ---------------------------------------------------------------------------
// v0.4.0 Batch 5 — initial Android verdict policy (agents.txt Batch 5
// section 12).
//
// Reuses the existing security-validation ReleaseVerdict vocabulary (all
// four machine values match or map directly — see result.ts's
// AndroidVerdictValue comment) rather than a parallel Android-only
// vocabulary. Precedence, evaluated in order, first match wins:
//   1. not-ready-security-blocker-remains
//   2. inconclusive-audit-environment-incomplete
//   3. ready-except-optional-manual-checks
//   4. ready-for-release-preparation
// A stronger negative verdict is never overwritten by a weaker positive one.
// ---------------------------------------------------------------------------

const AUDIT_FINDING_DRIVEN_CATEGORIES = new Set(["android-permissions", "android-components", "android-intent-filters", "android-deep-links"]);

const REQUIRED_CHECK_CATEGORIES = new Set([
  "android-detection",
  "android-manifest",
  "android-permissions",
  "android-components",
  "android-intent-filters",
  "android-deep-links",
  "android-gradle",
]);

export function androidVerdictToHumanLabel(verdict: ReleaseVerdict): string {
  switch (verdict) {
    case "ready-for-release-preparation":
      return "ready for release preparation";
    case "not-ready-security-blocker-remains":
      return "not ready: security blocker remains";
    case "ready-except-optional-manual-checks":
      return "ready except optional manual checks";
    case "inconclusive-audit-environment-incomplete":
      return "inconclusive: android environment incomplete";
  }
}

export type CalculateAndroidVerdictInput = {
  checks: AndroidCheckResult[];
  findings: SecurityFinding[];
  detection: AndroidDetectionResult;
  playReadiness: AndroidPlayReadinessChecklist;
  targetMutation: TargetMutationReport;
  multipleApplicationModules: boolean;
};

export type CalculateAndroidVerdictResult = {
  verdict: ReleaseVerdict;
  recommendedNextStep: string;
  reasons: AndroidVerdictReason[];
};

export function calculateAndroidVerdict(input: CalculateAndroidVerdictInput): CalculateAndroidVerdictResult {
  const { checks, findings, detection, playReadiness, targetMutation, multipleApplicationModules } = input;
  const reasons: AndroidVerdictReason[] = [];

  const blockerFindings = findings.filter((f) => f.severity === "blocker");
  const majorFindings = findings.filter((f) => f.severity === "major");
  const minorOrInformationalFindings = findings.filter((f) => f.severity === "minor" || f.severity === "informational");

  // Filtered by requirementLevel as well as category: optional Gradle
  // operation checks (e.g. android-gradle-unit-test-debug) share the
  // "android-gradle" category with the required static metadata check
  // (android-gradle-metadata) but must never be treated as a required check
  // — an optional operation's failure belongs in the advisory tier (section
  // 12.5), not the not-ready tier.
  const requiredChecks = checks.filter((c) => REQUIRED_CHECK_CATEGORIES.has(c.category) && c.requirementLevel === "required");
  // Audit-family checks (permissions/components/intent-filters/deep-links)
  // report status "failed" whenever ANY non-informational finding exists,
  // regardless of severity (see audit/checkResultBuilder.ts) — that binary
  // status is deliberately NOT used for the not-ready decision here, since a
  // single minor finding would otherwise be indistinguishable from a
  // blocker. Finding *severity* (checked separately above/below) is the
  // authoritative signal for those four categories; a "failed" status only
  // blocks the verdict for the non-audit required checks (detection,
  // manifest parsing, Gradle metadata), where it reflects a genuine
  // orchestration/parsing failure rather than a graded finding.
  const failedRequired = requiredChecks.filter((c) => c.status === "failed" && !AUDIT_FINDING_DRIVEN_CATEGORIES.has(c.category));
  const inconclusiveRequired = requiredChecks.filter((c) => c.status === "inconclusive" || c.status === "error");
  const unsupportedRequired = requiredChecks.filter((c) => c.status === "unsupported");
  const skippedOptional = checks.filter((c) => c.requirementLevel === "optional" && (c.status === "skipped" || c.status === "not-run"));
  const failedOptional = checks.filter((c) => c.requirementLevel === "optional" && c.status === "failed");

  // ---- 1. not-ready-security-blocker-remains ---------------------------------
  if (blockerFindings.length > 0) {
    for (const f of blockerFindings) {
      reasons.push({
        code: "android-blocker-finding",
        summary: `Blocker-severity finding: ${f.title}`,
        relatedFindingIds: [f.id],
        severityOrStatus: "blocker",
        impact: "blocking",
        recommendedAction: f.recommendation ?? "Resolve this finding before release preparation.",
      });
    }
    return { verdict: "not-ready-security-blocker-remains", recommendedNextStep: `Fix ${blockerFindings.length} blocker finding(s) before release.`, reasons };
  }

  if (majorFindings.length > 0) {
    for (const f of majorFindings) {
      reasons.push({
        code: "android-major-finding",
        summary: `Major-severity finding: ${f.title}`,
        relatedFindingIds: [f.id],
        severityOrStatus: "major",
        impact: "blocking",
        recommendedAction: f.recommendation ?? "Resolve or explicitly accept this finding before release preparation.",
      });
    }
    return { verdict: "not-ready-security-blocker-remains", recommendedNextStep: `Review ${majorFindings.length} major finding(s) before release.`, reasons };
  }

  if (targetMutation.comparable && targetMutation.unexpectedChanges.length > 0) {
    reasons.push({
      code: "android-unexpected-target-modification",
      summary: `Unexpected target change(s) observed: ${targetMutation.unexpectedChanges.join(", ")}`,
      severityOrStatus: "blocking",
      impact: "blocking",
      recommendedAction: "Investigate why validation modified tracked target files and re-run.",
    });
    return { verdict: "not-ready-security-blocker-remains", recommendedNextStep: "An unexpected tracked target-file modification occurred during validation. Investigate before release.", reasons };
  }

  if (failedRequired.length > 0) {
    for (const c of failedRequired) {
      reasons.push({
        code: "android-required-check-failed",
        summary: `Required check failed: ${c.title}`,
        relatedCheckId: c.id,
        severityOrStatus: c.status,
        impact: "blocking",
        recommendedAction: "Investigate the failure evidence for this check.",
      });
    }
    return { verdict: "not-ready-security-blocker-remains", recommendedNextStep: `Required check(s) failed: ${failedRequired.map((c) => c.title).join(", ")}.`, reasons };
  }

  // ---- 2. inconclusive-audit-environment-incomplete ---------------------------
  // Profile mismatch: the target was not detected as Android at all. This
  // must never read as "ready" — every required check above reports
  // "unsupported", not "passed" (agents.txt Batch 5 section 9.3).
  if (detection.projectKind === "non-android") {
    reasons.push({
      code: "android-profile-mismatch",
      summary: "The --profile android target was not detected as an Android Gradle project.",
      impact: "inconclusive",
      recommendedAction: "Re-run against an Android Gradle project, or select a different --profile for this target.",
    });
    return {
      verdict: "inconclusive-audit-environment-incomplete",
      recommendedNextStep: "This target does not appear to be an Android Gradle project. Android validation could not run.",
      reasons,
    };
  }

  if (detection.projectKind === "partial" || detection.projectKind === "unknown") {
    reasons.push({
      code: "android-partial-detection",
      summary: `Android project detection is partial or ambiguous (projectKind=${detection.projectKind}).`,
      severityOrStatus: detection.confidence,
      impact: "inconclusive",
      recommendedAction: "Confirm the target is a complete Android Gradle project and re-run detection.",
    });
  }
  if (inconclusiveRequired.length > 0) {
    for (const c of inconclusiveRequired) {
      reasons.push({
        code: "android-required-check-inconclusive",
        summary: `Required check is ${c.status}: ${c.title}`,
        relatedCheckId: c.id,
        severityOrStatus: c.status,
        impact: "inconclusive",
        recommendedAction: c.skipInfo?.recommendedNextAction ?? "Provide the missing evidence and re-run.",
      });
    }
  }
  if (unsupportedRequired.length > 0) {
    for (const c of unsupportedRequired) {
      reasons.push({
        code: "android-required-check-unsupported",
        summary: `Required check is unsupported: ${c.title}`,
        relatedCheckId: c.id,
        severityOrStatus: c.status,
        impact: "inconclusive",
        recommendedAction: c.skipInfo?.recommendedNextAction ?? "Provide the missing capability and re-run.",
      });
    }
  }
  if (multipleApplicationModules) {
    reasons.push({
      code: "android-multiple-application-modules",
      summary: "Multiple application modules were detected; a single release target could not be selected.",
      impact: "inconclusive",
      recommendedAction: "Validate each application module individually, or confirm which module is the release target.",
    });
  }

  if (
    (detection.projectKind === "partial" || detection.projectKind === "unknown") ||
    inconclusiveRequired.length > 0 ||
    unsupportedRequired.length > 0 ||
    multipleApplicationModules
  ) {
    return {
      verdict: "inconclusive-audit-environment-incomplete",
      recommendedNextStep: "Required Android evidence is incomplete. Address the reasons above and re-run android validation.",
      reasons,
    };
  }

  // ---- 3. ready-except-optional-manual-checks ---------------------------------
  if (minorOrInformationalFindings.length > 0) {
    for (const f of minorOrInformationalFindings) {
      reasons.push({
        code: "android-review-finding",
        summary: `${f.severity} finding: ${f.title}`,
        relatedFindingIds: [f.id],
        severityOrStatus: f.severity,
        impact: "advisory",
        recommendedAction: f.recommendation ?? "Review before release.",
      });
    }
  }
  if (skippedOptional.length > 0) {
    for (const c of skippedOptional) {
      reasons.push({
        code: "android-optional-check-not-run",
        summary: `Optional check was not run or skipped: ${c.title}`,
        relatedCheckId: c.id,
        severityOrStatus: c.status,
        impact: "advisory",
        recommendedAction: "Run explicitly via --android-gradle-operations if this evidence is needed.",
      });
    }
  }
  if (failedOptional.length > 0) {
    for (const c of failedOptional) {
      reasons.push({
        code: "android-optional-check-failed",
        summary: `Optional operation failed: ${c.title}`,
        relatedCheckId: c.id,
        severityOrStatus: c.status,
        impact: "advisory",
        recommendedAction: "Review the operation output; an optional build/test/lint failure is validation evidence, not a security finding.",
      });
    }
  }
  const manualPlayItems = playReadiness.items.filter((i) => i.status === "manual-check-required" || i.status === "unresolved" || i.status === "missing");
  if (playReadiness.applicable && manualPlayItems.length > 0) {
    reasons.push({
      code: "android-play-readiness-manual-items",
      summary: `${manualPlayItems.length} Play-readiness checklist item(s) require manual confirmation.`,
      impact: "advisory",
      recommendedAction: "Review the Play-readiness checklist section before publishing.",
    });
  }

  if (reasons.length > 0) {
    return {
      verdict: "ready-except-optional-manual-checks",
      recommendedNextStep: "No blocking or required-evidence gaps remain. Review the advisory items above (findings, skipped optional checks, and manual Play-readiness items) before release preparation.",
      reasons,
    };
  }

  // ---- 4. ready-for-release-preparation ----------------------------------------
  reasons.push({
    code: "android-ready",
    summary: "All required static Android checks completed with no blocking findings, no unexpected target modification, and no outstanding advisory items.",
    impact: "advisory",
    recommendedAction: "Proceed with release preparation. This does not certify Google Play compliance or publication readiness.",
  });
  return {
    verdict: "ready-for-release-preparation",
    recommendedNextStep: "All required static Android checks passed. Proceed with release preparation (this is not a Google Play compliance or publication-readiness claim).",
    reasons,
  };
}
