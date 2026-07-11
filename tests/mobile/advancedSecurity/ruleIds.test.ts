import { describe, expect, it } from "vitest";
import {
  ANDROID_ADVANCED_RULE_IDS,
  ANDROID_ADVANCED_CHECK_CATEGORIES,
  categoryForAdvancedRuleId,
  type AndroidAdvancedRuleId,
} from "../../../src/mobile/android/advancedSecurity/ruleIds.js";

// ANDROID-V041-B1-01 — stable rule identifiers: every planned v0.4.1 rule id
// is unique, machine-readable, and maps to a registered category.
describe("ANDROID_ADVANCED_RULE_IDS", () => {
  it("contains only unique ids", () => {
    expect(new Set(ANDROID_ADVANCED_RULE_IDS).size).toBe(ANDROID_ADVANCED_RULE_IDS.length);
  });

  it("contains only lowercase, hyphenated, android-prefixed ids", () => {
    for (const id of ANDROID_ADVANCED_RULE_IDS) {
      expect(id).toMatch(/^android-[a-z0-9-]+$/);
    }
  });

  it("maps every rule id to a category that exists in ANDROID_ADVANCED_CHECK_CATEGORIES", () => {
    for (const id of ANDROID_ADVANCED_RULE_IDS) {
      const category = categoryForAdvancedRuleId(id as AndroidAdvancedRuleId);
      expect(ANDROID_ADVANCED_CHECK_CATEGORIES).toContain(category);
    }
  });

  it("throws a clear error for an id that was never registered", () => {
    expect(() => categoryForAdvancedRuleId("android-does-not-exist" as AndroidAdvancedRuleId)).toThrow(
      /No category registered/
    );
  });

  it("has at least one rule id per planned category", () => {
    const coveredCategories = new Set(ANDROID_ADVANCED_RULE_IDS.map((id) => categoryForAdvancedRuleId(id)));
    for (const category of ANDROID_ADVANCED_CHECK_CATEGORIES) {
      // Optional-tool categories (semgrep/osv/lint/dependency-check) are
      // intentionally rule-id-backed 1:1 (one evidence rule id each) —
      // confirmed present, not assumed.
      expect(coveredCategories.has(category)).toBe(true);
    }
  });
});
