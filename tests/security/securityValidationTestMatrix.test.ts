import { describe, expect, it } from "vitest";
import { SECURITY_TEST_MATRIX } from "../../src/securityValidation/testMatrix.js";
import { SECURITY_CHECK_CATEGORIES, SECURITY_SEVERITIES } from "../../src/securityValidation/types.js";

describe("security validation test matrix — structure and completeness", () => {
  it("has at least one entry", () => {
    expect(SECURITY_TEST_MATRIX.length).toBeGreaterThan(0);
  });

  it("all entry ids are unique", () => {
    const ids = SECURITY_TEST_MATRIX.map((e) => e.id);
    const uniqueIds = new Set(ids);
    expect(uniqueIds.size).toBe(ids.length);
  });

  it("every entry has a non-empty id", () => {
    for (const entry of SECURITY_TEST_MATRIX) {
      expect(entry.id, `entry.id must not be empty`).toBeTruthy();
      expect(typeof entry.id).toBe("string");
    }
  });

  it("every entry has a non-empty title", () => {
    for (const entry of SECURITY_TEST_MATRIX) {
      expect(entry.title, `title for ${entry.id} must not be empty`).toBeTruthy();
    }
  });

  it("every entry has a valid category", () => {
    for (const entry of SECURITY_TEST_MATRIX) {
      expect(
        SECURITY_CHECK_CATEGORIES,
        `category '${entry.category}' in entry '${entry.id}' must be a known category`
      ).toContain(entry.category);
    }
  });

  it("every entry has a non-empty attackSurface", () => {
    for (const entry of SECURITY_TEST_MATRIX) {
      expect(entry.attackSurface, `attackSurface for ${entry.id} must not be empty`).toBeTruthy();
    }
  });

  it("every entry has at least one input example", () => {
    for (const entry of SECURITY_TEST_MATRIX) {
      expect(entry.inputExamples.length, `${entry.id} must have at least one input example`).toBeGreaterThan(0);
    }
  });

  it("every entry has a non-empty expectedBehavior", () => {
    for (const entry of SECURITY_TEST_MATRIX) {
      expect(entry.expectedBehavior, `expectedBehavior for ${entry.id} must not be empty`).toBeTruthy();
    }
  });

  it("every entry has a valid severityIfFailed", () => {
    for (const entry of SECURITY_TEST_MATRIX) {
      expect(
        SECURITY_SEVERITIES,
        `severityIfFailed '${entry.severityIfFailed}' in entry '${entry.id}' must be a known severity`
      ).toContain(entry.severityIfFailed);
    }
  });

  it("every entry has a valid implementationStatus", () => {
    const validStatuses = ["planned", "implemented", "skipped-environment"];
    for (const entry of SECURITY_TEST_MATRIX) {
      expect(
        validStatuses,
        `implementationStatus '${entry.implementationStatus}' in entry '${entry.id}' must be a known status`
      ).toContain(entry.implementationStatus);
    }
  });

  it("no entry uses web-app pentest terminology as category", () => {
    const webPentestCategories = ["owasp", "burp", "zap", "xss", "sqli", "csrf", "ssrf"];
    for (const entry of SECURITY_TEST_MATRIX) {
      const categoryLower = entry.category.toLowerCase();
      for (const term of webPentestCategories) {
        expect(categoryLower, `entry '${entry.id}' should not use web-app pentest category term '${term}'`).not.toContain(term);
      }
    }
  });

  it("covers cli-adversarial, artifact-safety, package-content, and secret-leakage categories", () => {
    const categories = new Set(SECURITY_TEST_MATRIX.map((e) => e.category));
    expect(categories).toContain("cli-adversarial");
    expect(categories).toContain("artifact-safety");
    expect(categories).toContain("package-content");
    expect(categories).toContain("secret-leakage");
  });

  it("has at least one blocker-severity entry", () => {
    const blockers = SECURITY_TEST_MATRIX.filter((e) => e.severityIfFailed === "blocker");
    expect(blockers.length).toBeGreaterThan(0);
  });

  it("all entries start as planned (none incorrectly marked implemented without code)", () => {
    const implemented = SECURITY_TEST_MATRIX.filter((e) => e.implementationStatus === "implemented");
    // All test matrix entries are planned at this phase; this test confirms the initial state.
    // Update this test when entries are implemented.
    expect(implemented).toHaveLength(0);
  });
});
