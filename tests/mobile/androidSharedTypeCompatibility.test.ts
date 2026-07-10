import { describe, expect, it } from "vitest";
import {
  SECURITY_SEVERITIES,
  SECURITY_CHECK_CATEGORIES,
  type SecurityFinding,
} from "../../src/securityValidation/types.js";
import type { AndroidCheckResult } from "../../src/mobile/android/validation/checkResult.js";

// ANDROID-B1-11: Existing security-validation types and reports remain
// compatible after the mobile substrate reuses SecurityFinding and
// CommandExecutionResult — this is a regression guard, not new behavior.
describe("existing security-validation types remain compatible — ANDROID-B1-11", () => {
  it("SecurityFinding is unchanged and directly reusable inside an AndroidCheckResult", () => {
    const finding: SecurityFinding = {
      id: "android-example-1",
      title: "Example",
      severity: "informational",
      category: "cli-adversarial",
      description: "example finding reused from the existing security-validation schema",
      releaseImpact: "none",
    };

    const check: AndroidCheckResult = {
      id: "android-example-check",
      category: "android-manifest",
      title: "Example",
      status: "passed",
      requirementLevel: "optional",
      ran: true,
      skipped: false,
      evidence: [],
      findings: [finding],
      warnings: [],
      errors: [],
      sourcePaths: [],
      confidence: "high",
      environmentRequirements: [],
    };

    expect(check.findings[0]).toBe(finding);
  });

  it("did not add or remove severity/category enum values as a side effect", () => {
    expect(SECURITY_SEVERITIES).toHaveLength(5);
    expect(SECURITY_CHECK_CATEGORIES).toHaveLength(9);
  });
});
