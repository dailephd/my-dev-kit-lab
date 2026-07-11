import { describe, expect, it } from "vitest";
import { ANDROID_PROJECT_KINDS } from "../../src/mobile/android/detection.js";

// Regression coverage for the narrow Batch 1 -> Batch 2 inherited-contract
// correction: ANDROID_PROJECT_KINDS was widened additively to support
// project-level classification outcomes (multi-module, mixed, partial,
// non-android) required by Batch 2 section 7.8. The original three Batch 1
// values must remain present and unchanged in meaning.
describe("ANDROID_PROJECT_KINDS widening — inherited-contract regression", () => {
  it("still contains the original Batch 1 values", () => {
    expect(ANDROID_PROJECT_KINDS).toContain("application");
    expect(ANDROID_PROJECT_KINDS).toContain("library");
    expect(ANDROID_PROJECT_KINDS).toContain("unknown");
  });

  it("adds the Batch 2 project-level classification values", () => {
    expect(ANDROID_PROJECT_KINDS).toContain("multi-module");
    expect(ANDROID_PROJECT_KINDS).toContain("mixed");
    expect(ANDROID_PROJECT_KINDS).toContain("partial");
    expect(ANDROID_PROJECT_KINDS).toContain("non-android");
  });

  it("has exactly seven values (no accidental duplicates)", () => {
    expect(ANDROID_PROJECT_KINDS).toHaveLength(7);
    expect(new Set(ANDROID_PROJECT_KINDS).size).toBe(7);
  });
});
