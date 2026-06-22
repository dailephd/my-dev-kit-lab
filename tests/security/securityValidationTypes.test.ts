import { describe, expect, it } from "vitest";
import {
  SECURITY_SEVERITIES,
  RELEASE_VERDICTS,
  SECURITY_CHECK_STATUSES,
  SECURITY_CHECK_CATEGORIES,
} from "../../src/securityValidation/types.js";

describe("security validation types — enumerations are complete", () => {
  it("includes all five severity values", () => {
    expect(SECURITY_SEVERITIES).toContain("blocker");
    expect(SECURITY_SEVERITIES).toContain("major");
    expect(SECURITY_SEVERITIES).toContain("minor");
    expect(SECURITY_SEVERITIES).toContain("informational");
    expect(SECURITY_SEVERITIES).toContain("skipped");
    expect(SECURITY_SEVERITIES).toHaveLength(5);
  });

  it("includes all four release verdict values", () => {
    expect(RELEASE_VERDICTS).toContain("ready-for-release-preparation");
    expect(RELEASE_VERDICTS).toContain("not-ready-security-blocker-remains");
    expect(RELEASE_VERDICTS).toContain("ready-except-optional-manual-checks");
    expect(RELEASE_VERDICTS).toContain("inconclusive-audit-environment-incomplete");
    expect(RELEASE_VERDICTS).toHaveLength(4);
  });

  it("includes all four check status values", () => {
    expect(SECURITY_CHECK_STATUSES).toContain("passed");
    expect(SECURITY_CHECK_STATUSES).toContain("failed");
    expect(SECURITY_CHECK_STATUSES).toContain("skipped");
    expect(SECURITY_CHECK_STATUSES).toContain("warning");
    expect(SECURITY_CHECK_STATUSES).toHaveLength(4);
  });

  it("includes all nine check category values", () => {
    expect(SECURITY_CHECK_CATEGORIES).toContain("static-scan");
    expect(SECURITY_CHECK_CATEGORIES).toContain("dependency-audit");
    expect(SECURITY_CHECK_CATEGORIES).toContain("package-content");
    expect(SECURITY_CHECK_CATEGORIES).toContain("cli-adversarial");
    expect(SECURITY_CHECK_CATEGORIES).toContain("fuzz-smoke");
    expect(SECURITY_CHECK_CATEGORIES).toContain("network-boundary");
    expect(SECURITY_CHECK_CATEGORIES).toContain("secret-leakage");
    expect(SECURITY_CHECK_CATEGORIES).toContain("artifact-safety");
    expect(SECURITY_CHECK_CATEGORIES).toContain("report-generation");
    expect(SECURITY_CHECK_CATEGORIES).toHaveLength(9);
  });
});
