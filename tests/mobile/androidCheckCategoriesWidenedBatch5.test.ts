import { describe, expect, it } from "vitest";
import { ANDROID_CHECK_CATEGORIES } from "../../src/mobile/android/validation/checkResult.js";

// Regression coverage for the narrow Batch 4 -> Batch 5 inherited-contract
// correction (see agents.txt Batch 5 section 10.1): ANDROID_CHECK_CATEGORIES
// gained "android-target-immutability" so the required target-immutability
// check has its own category. Additive only — every prior category value
// remains present.
describe("ANDROID_CHECK_CATEGORIES widening — Batch 5 inherited-contract regression", () => {
  it("adds android-target-immutability while preserving all prior category values", () => {
    expect(ANDROID_CHECK_CATEGORIES).toContain("android-target-immutability");
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
    ]) {
      expect(ANDROID_CHECK_CATEGORIES).toContain(prior);
    }
    // v0.4.1 Batch 1 additively appended 15 advanced-security categories
    // (see tests/mobile/advancedSecurity/androidCheckCategoriesWidenedV041Batch1.test.ts)
    // — length grew from 10 to 25; updated rather than removed so any future
    // accidental duplicate/removal is still caught.
    expect(ANDROID_CHECK_CATEGORIES).toHaveLength(25);
  });
});
