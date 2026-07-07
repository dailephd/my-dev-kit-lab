import { describe, expect, it } from "vitest";
import {
  severityMeetsFailOnThreshold,
  findingsBreachFailOnThreshold,
} from "../../src/securityValidation/validate/verdict.js";
import type { SecurityFinding } from "../../src/securityValidation/types.js";
import {
  parseSecurityValidateArgs,
  normalizeSecurityValidateConfig,
} from "../../src/securityValidation/validate/cliOptions.js";

function makeFinding(severity: SecurityFinding["severity"]): SecurityFinding {
  return {
    id: `finding-${severity}`,
    title: "Test finding",
    severity,
    category: "artifact-safety",
    description: "Test",
    releaseImpact: "Test",
  };
}

describe("severityMeetsFailOnThreshold", () => {
  it("--fail-on blocker only breaches for blocker severity", () => {
    expect(severityMeetsFailOnThreshold("blocker", "blocker")).toBe(true);
    expect(severityMeetsFailOnThreshold("major", "blocker")).toBe(false);
    expect(severityMeetsFailOnThreshold("minor", "blocker")).toBe(false);
    expect(severityMeetsFailOnThreshold("informational", "blocker")).toBe(false);
  });

  it("--fail-on high breaches for blocker and major", () => {
    expect(severityMeetsFailOnThreshold("blocker", "high")).toBe(true);
    expect(severityMeetsFailOnThreshold("major", "high")).toBe(true);
    expect(severityMeetsFailOnThreshold("minor", "high")).toBe(false);
    expect(severityMeetsFailOnThreshold("informational", "high")).toBe(false);
  });

  it("--fail-on medium breaches for blocker, major, and minor", () => {
    expect(severityMeetsFailOnThreshold("blocker", "medium")).toBe(true);
    expect(severityMeetsFailOnThreshold("major", "medium")).toBe(true);
    expect(severityMeetsFailOnThreshold("minor", "medium")).toBe(true);
    expect(severityMeetsFailOnThreshold("informational", "medium")).toBe(false);
  });

  it("--fail-on low breaches for blocker, major, minor, and informational", () => {
    expect(severityMeetsFailOnThreshold("blocker", "low")).toBe(true);
    expect(severityMeetsFailOnThreshold("major", "low")).toBe(true);
    expect(severityMeetsFailOnThreshold("minor", "low")).toBe(true);
    expect(severityMeetsFailOnThreshold("informational", "low")).toBe(true);
  });

  it("skipped severity never breaches any threshold", () => {
    for (const threshold of ["blocker", "high", "medium", "low"] as const) {
      expect(severityMeetsFailOnThreshold("skipped", threshold)).toBe(false);
    }
  });
});

describe("findingsBreachFailOnThreshold", () => {
  it("--fail-on high does not fail for low-only (informational/minor) findings", () => {
    const findings = [makeFinding("minor"), makeFinding("informational")];
    expect(findingsBreachFailOnThreshold(findings, "high")).toBe(false);
  });

  it("--fail-on medium does not fail when only informational findings are below threshold", () => {
    const findings = [makeFinding("informational")];
    expect(findingsBreachFailOnThreshold(findings, "medium")).toBe(false);
  });

  it("--fail-on medium fails when a minor finding is present", () => {
    const findings = [makeFinding("minor")];
    expect(findingsBreachFailOnThreshold(findings, "medium")).toBe(true);
  });

  it("--fail-on low fails when only an informational finding is present", () => {
    const findings = [makeFinding("informational")];
    expect(findingsBreachFailOnThreshold(findings, "low")).toBe(true);
  });

  it("empty findings never breach any threshold", () => {
    for (const threshold of ["blocker", "high", "medium", "low"] as const) {
      expect(findingsBreachFailOnThreshold([], threshold)).toBe(false);
    }
  });
});

describe("--fail-on CLI parsing (Batch 1 behavior preserved)", () => {
  it("default (no --fail-on) is blocker", () => {
    const config = normalizeSecurityValidateConfig({}, process.cwd());
    expect(config.failOnThreshold).toBe("blocker");
    expect(config.failOnWasDefault).toBe(true);
  });

  it("accepts blocker/high/medium/low", () => {
    for (const value of ["blocker", "high", "medium", "low"] as const) {
      const config = normalizeSecurityValidateConfig({ failOn: value }, process.cwd());
      expect(config.failOnThreshold).toBe(value);
    }
  });

  it("rejects an invalid --fail-on value cleanly (unchanged from Batch 1)", () => {
    expect(() => normalizeSecurityValidateConfig({ failOn: "critical" }, process.cwd())).toThrow(
      /Invalid --fail-on/
    );
  });

  it("parseSecurityValidateArgs still parses --fail-on (unchanged from Batch 1)", () => {
    const args = parseSecurityValidateArgs(["--fail-on", "medium"]);
    expect(args.failOn).toBe("medium");
  });
});
