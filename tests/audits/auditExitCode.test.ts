import { describe, expect, it } from "vitest";
import { AUDIT_EXIT_CODES, calculateAuditExitCode, issueBreachesFailOnThreshold } from "../../src/audits/core/auditExitCode.js";
import type { AuditIssue } from "../../src/audits/core/auditIssue.js";
import type { AuditSeverity } from "../../src/audits/core/auditTypes.js";

function makeIssue(severity: AuditSeverity): AuditIssue {
  return {
    id: `issue-${severity}`,
    auditType: "code-rot",
    detectorId: "test-detector",
    title: "Test issue",
    description: "Test description",
    severity,
    confidence: "medium",
    falsePositiveRisk: "low",
    category: "test",
    evidence: [],
    affectedFiles: [],
    recommendedAction: "n/a",
    suggestedFixStrategy: "n/a",
    validationCommands: [],
    releaseBlocking: false,
    implementationBlocking: false,
    autoFixEligible: false,
  };
}

describe("calculateAuditExitCode", () => {
  it("no issues exits 0", () => {
    expect(calculateAuditExitCode([], "blocker").exitCode).toBe(AUDIT_EXIT_CODES.SUCCESS);
  });

  it("blocker issue with --fail-on blocker exits 1", () => {
    expect(calculateAuditExitCode([makeIssue("blocker")], "blocker").exitCode).toBe(
      AUDIT_EXIT_CODES.THRESHOLD_BREACHED
    );
  });

  it("high issue with --fail-on blocker exits 0", () => {
    expect(calculateAuditExitCode([makeIssue("high")], "blocker").exitCode).toBe(AUDIT_EXIT_CODES.SUCCESS);
  });

  it("high issue with --fail-on high exits 1", () => {
    expect(calculateAuditExitCode([makeIssue("high")], "high").exitCode).toBe(AUDIT_EXIT_CODES.THRESHOLD_BREACHED);
  });

  it("low issue with --fail-on medium exits 0", () => {
    expect(calculateAuditExitCode([makeIssue("low")], "medium").exitCode).toBe(AUDIT_EXIT_CODES.SUCCESS);
  });

  it("low issue with --fail-on low exits 1", () => {
    expect(calculateAuditExitCode([makeIssue("low")], "low").exitCode).toBe(AUDIT_EXIT_CODES.THRESHOLD_BREACHED);
  });

  it("any finding with --fail-on none exits 0", () => {
    expect(calculateAuditExitCode([makeIssue("blocker")], "none").exitCode).toBe(AUDIT_EXIT_CODES.SUCCESS);
  });

  it("an info-severity issue never breaches, even at --fail-on low", () => {
    expect(calculateAuditExitCode([makeIssue("info")], "low").exitCode).toBe(AUDIT_EXIT_CODES.SUCCESS);
  });

  it("exit code 2 (FATAL_ERROR) is reserved for config/target/runtime errors, never returned by this function", () => {
    // Exhaustive over every severity/threshold combination -- the pure
    // issue-driven decision function must only ever return 0 or 1.
    const severities: AuditSeverity[] = ["blocker", "high", "medium", "low", "info"];
    const thresholds = ["blocker", "high", "medium", "low", "none"] as const;
    for (const severity of severities) {
      for (const failOn of thresholds) {
        const { exitCode } = calculateAuditExitCode([makeIssue(severity)], failOn);
        expect(exitCode === AUDIT_EXIT_CODES.SUCCESS || exitCode === AUDIT_EXIT_CODES.THRESHOLD_BREACHED).toBe(true);
      }
    }
    expect(AUDIT_EXIT_CODES.FATAL_ERROR).toBe(2);
  });
});

describe("issueBreachesFailOnThreshold", () => {
  it("returns false for --fail-on none regardless of severity", () => {
    expect(issueBreachesFailOnThreshold("blocker", "none")).toBe(false);
  });

  it("ranks severities monotonically against a fixed threshold", () => {
    expect(issueBreachesFailOnThreshold("info", "low")).toBe(false);
    expect(issueBreachesFailOnThreshold("low", "low")).toBe(true);
    expect(issueBreachesFailOnThreshold("medium", "low")).toBe(true);
    expect(issueBreachesFailOnThreshold("high", "low")).toBe(true);
    expect(issueBreachesFailOnThreshold("blocker", "low")).toBe(true);
  });
});
