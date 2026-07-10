import { describe, expect, it } from "vitest";
import type { AndroidCheckSkipInfo } from "../../src/mobile/android/validation/checkResult.js";

// ANDROID-B1-07: Skipped Android checks retain the skip reason, requirement
// level, environment limitation, verdict impact, and recommended next
// action.
describe("android check skip info contract — ANDROID-B1-07", () => {
  it("retains all required skip fields for a required-but-unavailable check", () => {
    const skipInfo: AndroidCheckSkipInfo = {
      checkId: "android-manifest-permission-audit",
      reason: "No AndroidManifest.xml found in any detected module",
      requirementLevel: "required",
      missingCapability: "android-manifest",
      verdictImpact: "verdict is inconclusive until a manifest is found",
      recommendedNextAction: "Confirm the target is an Android Gradle project and re-run detection",
    };

    expect(skipInfo.checkId).toBe("android-manifest-permission-audit");
    expect(skipInfo.reason.length).toBeGreaterThan(0);
    expect(skipInfo.requirementLevel).toBe("required");
    expect(skipInfo.missingCapability).toBe("android-manifest");
    expect(skipInfo.verdictImpact.length).toBeGreaterThan(0);
    expect(skipInfo.recommendedNextAction.length).toBeGreaterThan(0);
  });

  it("allows an optional check to be skipped without a missing-capability reason", () => {
    const skipInfo: AndroidCheckSkipInfo = {
      checkId: "android-play-readiness-checklist",
      reason: "Play readiness checklist is not implemented yet",
      requirementLevel: "optional",
      verdictImpact: "informational only",
      recommendedNextAction: "Revisit once the Play readiness batch is implemented",
    };

    expect(skipInfo.missingCapability).toBeUndefined();
    expect(skipInfo.requirementLevel).toBe("optional");
  });
});
