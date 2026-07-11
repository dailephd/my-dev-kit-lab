import { describe, expect, it } from "vitest";
import { ANDROID_CHECK_CATEGORIES } from "../../../src/mobile/android/validation/checkResult.js";
import { ANDROID_ADVANCED_CHECK_CATEGORIES } from "../../../src/mobile/android/advancedSecurity/ruleIds.js";

// ANDROID-V041-B1-02 — additive check categories: v0.4.1 Batch 1 widens
// ANDROID_CHECK_CATEGORIES with the new advanced-security families while
// every v0.4.0 category value remains present unchanged.
describe("ANDROID_CHECK_CATEGORIES widening — v0.4.1 Batch 1 inherited-contract regression", () => {
  it("preserves every v0.4.0 category value", () => {
    for (const prior of [
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
    ]) {
      expect(ANDROID_CHECK_CATEGORIES).toContain(prior);
    }
  });

  it("adds every new v0.4.1 advanced-security category", () => {
    for (const category of ANDROID_ADVANCED_CHECK_CATEGORIES) {
      expect(ANDROID_CHECK_CATEGORIES).toContain(category);
    }
  });

  it("has no duplicate category values after widening", () => {
    expect(new Set(ANDROID_CHECK_CATEGORIES).size).toBe(ANDROID_CHECK_CATEGORIES.length);
  });
});
