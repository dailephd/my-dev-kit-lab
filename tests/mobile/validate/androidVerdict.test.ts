import { describe, expect, it } from "vitest";
import { calculateAndroidVerdict, androidVerdictToHumanLabel } from "../../../src/mobile/android/validate/androidVerdict.js";
import type { AndroidCheckResult } from "../../../src/mobile/android/validation/checkResult.js";
import type { AndroidDetectionResult } from "../../../src/mobile/android/detection.js";
import type { SecurityFinding } from "../../../src/securityValidation/types.js";
import type { AndroidPlayReadinessChecklist } from "../../../src/mobile/android/validate/playReadinessChecklist.js";
import type { TargetMutationReport } from "../../../src/mobile/android/gradle/validate/targetMutation.js";

function baseCheck(overrides: Partial<AndroidCheckResult> = {}): AndroidCheckResult {
  return {
    id: "android-permissions-audit",
    category: "android-permissions",
    title: "Android permission audit",
    status: "passed",
    requirementLevel: "required",
    ran: true,
    skipped: false,
    evidence: [],
    findings: [],
    warnings: [],
    errors: [],
    sourcePaths: [],
    confidence: "high",
    environmentRequirements: [],
    ...overrides,
  };
}

function baseDetection(overrides: Partial<AndroidDetectionResult> = {}): AndroidDetectionResult {
  return {
    detected: true,
    confidence: "high",
    evidence: [],
    projectKind: "application",
    uiToolkit: "compose",
    hasGradleWrapper: true,
    gradleSettingsFiles: [],
    rootBuildFiles: [],
    versionCatalogFiles: [],
    modules: [],
    applicationModules: ["app"],
    libraryModules: [],
    manifestPaths: [],
    javaSourceRoots: [],
    kotlinSourceRoots: [],
    unitTestSourceRoots: [],
    instrumentedTestSourceRoots: [],
    partialOrUnsupportedStructure: false,
    warnings: [],
    ...overrides,
  };
}

function comparableCleanMutation(): TargetMutationReport {
  return { comparable: true, expectedGeneratedChanges: [], unexpectedChanges: [], preExistingChangeCount: 0 };
}

function notApplicableChecklist(): AndroidPlayReadinessChecklist {
  return { applicable: false, note: "n/a", items: [] };
}

function finding(overrides: Partial<SecurityFinding> = {}): SecurityFinding {
  return {
    id: "f1",
    title: "Test finding",
    severity: "informational",
    category: "static-scan",
    description: "desc",
    releaseImpact: "none",
    ...overrides,
  };
}

// ANDROID-B5-25: Ready verdict.
describe("calculateAndroidVerdict — ready — ANDROID-B5-25", () => {
  it("returns ready-for-release-preparation when all required checks pass with no findings and no manual items", () => {
    const result = calculateAndroidVerdict({
      checks: [baseCheck()],
      findings: [],
      detection: baseDetection(),
      playReadiness: notApplicableChecklist(),
      targetMutation: comparableCleanMutation(),
      multipleApplicationModules: false,
    });
    expect(result.verdict).toBe("ready-for-release-preparation");
    expect(result.reasons.length).toBeGreaterThan(0);
  });
});

// ANDROID-B5-26: Ready-except-manual verdict.
describe("calculateAndroidVerdict — ready except manual — ANDROID-B5-26", () => {
  it("returns ready-except-optional-manual-checks when only minor/informational findings remain", () => {
    const result = calculateAndroidVerdict({
      checks: [baseCheck()],
      findings: [finding({ severity: "minor" })],
      detection: baseDetection(),
      playReadiness: notApplicableChecklist(),
      targetMutation: comparableCleanMutation(),
      multipleApplicationModules: false,
    });
    expect(result.verdict).toBe("ready-except-optional-manual-checks");
  });

  it("returns ready-except-optional-manual-checks when an optional check was skipped", () => {
    const result = calculateAndroidVerdict({
      checks: [baseCheck(), baseCheck({ id: "android-gradle-tasks", category: "android-gradle", requirementLevel: "optional", status: "skipped", skipInfo: { checkId: "x", reason: "not enabled", requirementLevel: "optional", verdictImpact: "n/a", recommendedNextAction: "n/a" } })],
      findings: [],
      detection: baseDetection(),
      playReadiness: notApplicableChecklist(),
      targetMutation: comparableCleanMutation(),
      multipleApplicationModules: false,
    });
    expect(result.verdict).toBe("ready-except-optional-manual-checks");
  });

  it("does not become ready-except-manual merely because unrequested optional operations were never run", () => {
    // Only required checks present (no optional gradle-operation entries at
    // all, matching the default static-only path) — must still reach ready.
    const result = calculateAndroidVerdict({
      checks: [baseCheck()],
      findings: [],
      detection: baseDetection(),
      playReadiness: notApplicableChecklist(),
      targetMutation: comparableCleanMutation(),
      multipleApplicationModules: false,
    });
    expect(result.verdict).toBe("ready-for-release-preparation");
  });
});

// ANDROID-B5-27: Inconclusive verdict.
describe("calculateAndroidVerdict — inconclusive — ANDROID-B5-27", () => {
  it("returns inconclusive for partial detection", () => {
    const result = calculateAndroidVerdict({
      checks: [baseCheck()],
      findings: [],
      detection: baseDetection({ projectKind: "partial" }),
      playReadiness: notApplicableChecklist(),
      targetMutation: comparableCleanMutation(),
      multipleApplicationModules: false,
    });
    expect(result.verdict).toBe("inconclusive-audit-environment-incomplete");
  });

  it("returns inconclusive when a required check is inconclusive/error", () => {
    const result = calculateAndroidVerdict({
      checks: [baseCheck({ status: "inconclusive" })],
      findings: [],
      detection: baseDetection(),
      playReadiness: notApplicableChecklist(),
      targetMutation: comparableCleanMutation(),
      multipleApplicationModules: false,
    });
    expect(result.verdict).toBe("inconclusive-audit-environment-incomplete");
  });

  it("returns inconclusive when multiple application modules prevent selecting a release target", () => {
    const result = calculateAndroidVerdict({
      checks: [baseCheck()],
      findings: [],
      detection: baseDetection({ applicationModules: ["app", "app2"] }),
      playReadiness: notApplicableChecklist(),
      targetMutation: comparableCleanMutation(),
      multipleApplicationModules: true,
    });
    expect(result.verdict).toBe("inconclusive-audit-environment-incomplete");
  });

  it("returns inconclusive with a profile-mismatch reason for a non-Android target", () => {
    const result = calculateAndroidVerdict({
      checks: [baseCheck({ status: "unsupported" })],
      findings: [],
      detection: baseDetection({ projectKind: "non-android", detected: false, applicationModules: [] }),
      playReadiness: notApplicableChecklist(),
      targetMutation: comparableCleanMutation(),
      multipleApplicationModules: false,
    });
    expect(result.verdict).toBe("inconclusive-audit-environment-incomplete");
    expect(result.reasons.some((r) => r.code === "android-profile-mismatch")).toBe(true);
  });
});

// ANDROID-B5-28: Not-ready verdict.
describe("calculateAndroidVerdict — not ready — ANDROID-B5-28", () => {
  it("returns not-ready for a blocker finding", () => {
    const result = calculateAndroidVerdict({
      checks: [baseCheck()],
      findings: [finding({ severity: "blocker" })],
      detection: baseDetection(),
      playReadiness: notApplicableChecklist(),
      targetMutation: comparableCleanMutation(),
      multipleApplicationModules: false,
    });
    expect(result.verdict).toBe("not-ready-security-blocker-remains");
  });

  it("returns not-ready for a major finding", () => {
    const result = calculateAndroidVerdict({
      checks: [baseCheck()],
      findings: [finding({ severity: "major" })],
      detection: baseDetection(),
      playReadiness: notApplicableChecklist(),
      targetMutation: comparableCleanMutation(),
      multipleApplicationModules: false,
    });
    expect(result.verdict).toBe("not-ready-security-blocker-remains");
  });

  it("returns not-ready for an unexpected tracked target modification", () => {
    const result = calculateAndroidVerdict({
      checks: [baseCheck()],
      findings: [],
      detection: baseDetection(),
      playReadiness: notApplicableChecklist(),
      targetMutation: { comparable: true, expectedGeneratedChanges: [], unexpectedChanges: ["app/src/main/AndroidManifest.xml"], preExistingChangeCount: 0 },
      multipleApplicationModules: false,
    });
    expect(result.verdict).toBe("not-ready-security-blocker-remains");
  });

  it("does not treat a minor-severity-driven check 'failed' status as a blocker", () => {
    // An audit check with status "failed" purely because of a minor finding
    // must not itself trigger not-ready — only the finding severity matters.
    const result = calculateAndroidVerdict({
      checks: [baseCheck({ status: "failed" })],
      findings: [finding({ severity: "minor" })],
      detection: baseDetection(),
      playReadiness: notApplicableChecklist(),
      targetMutation: comparableCleanMutation(),
      multipleApplicationModules: false,
    });
    expect(result.verdict).not.toBe("not-ready-security-blocker-remains");
  });
});

// ANDROID-B5-29: Verdict precedence.
describe("calculateAndroidVerdict — precedence — ANDROID-B5-29", () => {
  it("not-ready overrides inconclusive when both conditions are present", () => {
    const result = calculateAndroidVerdict({
      checks: [baseCheck({ status: "inconclusive" })],
      findings: [finding({ severity: "blocker" })],
      detection: baseDetection({ projectKind: "partial" }),
      playReadiness: notApplicableChecklist(),
      targetMutation: comparableCleanMutation(),
      multipleApplicationModules: false,
    });
    expect(result.verdict).toBe("not-ready-security-blocker-remains");
  });

  it("inconclusive overrides ready-except-manual when both conditions are present", () => {
    const result = calculateAndroidVerdict({
      checks: [baseCheck({ status: "inconclusive" })],
      findings: [finding({ severity: "minor" })],
      detection: baseDetection(),
      playReadiness: notApplicableChecklist(),
      targetMutation: comparableCleanMutation(),
      multipleApplicationModules: false,
    });
    expect(result.verdict).toBe("inconclusive-audit-environment-incomplete");
  });
});

// ANDROID-B5-30: Verdict reasons.
describe("calculateAndroidVerdict — reasons — ANDROID-B5-30", () => {
  it("every verdict includes at least one deterministic reason with a recommended action", () => {
    const result = calculateAndroidVerdict({
      checks: [baseCheck()],
      findings: [],
      detection: baseDetection(),
      playReadiness: notApplicableChecklist(),
      targetMutation: comparableCleanMutation(),
      multipleApplicationModules: false,
    });
    expect(result.reasons.length).toBeGreaterThan(0);
    for (const reason of result.reasons) {
      expect(reason.code.length).toBeGreaterThan(0);
      expect(reason.recommendedAction.length).toBeGreaterThan(0);
      expect(["blocking", "inconclusive", "advisory"]).toContain(reason.impact);
    }
  });

  it("links a finding-based reason to the related finding id", () => {
    const result = calculateAndroidVerdict({
      checks: [baseCheck()],
      findings: [finding({ id: "specific-finding-id", severity: "blocker" })],
      detection: baseDetection(),
      playReadiness: notApplicableChecklist(),
      targetMutation: comparableCleanMutation(),
      multipleApplicationModules: false,
    });
    expect(result.reasons.some((r) => r.relatedFindingIds?.includes("specific-finding-id"))).toBe(true);
  });
});

describe("androidVerdictToHumanLabel", () => {
  it("uses Android-specific wording for the inconclusive label", () => {
    expect(androidVerdictToHumanLabel("inconclusive-audit-environment-incomplete")).toBe("inconclusive: android environment incomplete");
  });

  it("does not claim Google Play readiness for the ready label", () => {
    expect(androidVerdictToHumanLabel("ready-for-release-preparation")).not.toMatch(/play|publish/i);
  });
});
