import { describe, expect, it } from "vitest";
import { SENSITIVE_DATA_CATEGORIES, isSensitiveDataCategory } from "../../../src/mobile/android/advancedSecurity/sensitiveCategories.js";

// ANDROID-V041-B1-08 — sensitive category boundaries.
describe("SENSITIVE_DATA_CATEGORIES", () => {
  it("does not include a Firebase-API-key-specific category", () => {
    // A bare Firebase API key must not be classifiable as a dedicated
    // private-secret category by default (agents.txt Batch 1 section 7.6) —
    // confirmed by asserting no category name mentions "firebase" at all.
    for (const category of SENSITIVE_DATA_CATEGORIES) {
      expect(category.toLowerCase()).not.toContain("firebase");
    }
  });

  it("has an unknown-sensitive-value fallback distinct from private-secret categories", () => {
    expect(SENSITIVE_DATA_CATEGORIES).toContain("unknown-sensitive-value");
    expect(SENSITIVE_DATA_CATEGORIES).toContain("cloud-secret-key");
  });

  it("validates category membership without throwing on unknown strings", () => {
    expect(isSensitiveDataCategory("firebase-api-key")).toBe(false);
    expect(isSensitiveDataCategory("unknown-sensitive-value")).toBe(true);
    expect(isSensitiveDataCategory("")).toBe(false);
  });

  it("contains only unique values", () => {
    expect(new Set(SENSITIVE_DATA_CATEGORIES).size).toBe(SENSITIVE_DATA_CATEGORIES.length);
  });
});
