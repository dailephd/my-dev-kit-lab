import { describe, expect, it } from "vitest";
import {
  ANDROID_CHECK_STATUSES,
  ANDROID_NON_PASSING_STATUSES,
  isPassingAndroidStatus,
  type AndroidCheckResult,
  type AndroidCheckSkipInfo,
} from "../../src/mobile/android/validation/checkResult.js";

// ANDROID-B1-06: Android check results distinguish passed, failed, skipped,
// inconclusive, unsupported, not-run, and error states. Skipped/unsupported/
// not-run/inconclusive must never be normalized as passed.
describe("android check status vocabulary — ANDROID-B1-06", () => {
  it("defines exactly the seven required statuses", () => {
    expect(ANDROID_CHECK_STATUSES).toEqual([
      "passed",
      "failed",
      "skipped",
      "inconclusive",
      "unsupported",
      "not-run",
      "error",
    ]);
  });

  it("only treats 'passed' as a passing status", () => {
    for (const status of ANDROID_CHECK_STATUSES) {
      expect(isPassingAndroidStatus(status)).toBe(status === "passed");
    }
  });

  it("never classifies a non-passing status as passing — critical invariant", () => {
    for (const status of ANDROID_NON_PASSING_STATUSES) {
      expect(isPassingAndroidStatus(status)).toBe(false);
    }
    expect(ANDROID_NON_PASSING_STATUSES).toHaveLength(ANDROID_CHECK_STATUSES.length - 1);
  });

  it("represents a skipped optional check without status 'passed'", () => {
    const skipInfo: AndroidCheckSkipInfo = {
      checkId: "android-gradle-task-validation",
      reason: "Android SDK not available in this environment",
      requirementLevel: "optional",
      missingCapability: "android-sdk",
      verdictImpact: "does not block release verdict",
      recommendedNextAction: "Install Android SDK command-line tools and re-run with --checks android-gradle-task-validation",
    };
    const check: AndroidCheckResult = {
      id: skipInfo.checkId,
      category: "android-gradle",
      title: "Optional Gradle task validation",
      status: "skipped",
      requirementLevel: "optional",
      ran: false,
      skipped: true,
      skipInfo,
      evidence: [],
      findings: [],
      warnings: [],
      errors: [],
      sourcePaths: [],
      confidence: "unknown",
      environmentRequirements: ["android-sdk", "gradle"],
    };

    expect(check.status).not.toBe("passed");
    expect(check.skipped).toBe(true);
    expect(check.skipInfo?.requirementLevel).toBe("optional");
  });
});
