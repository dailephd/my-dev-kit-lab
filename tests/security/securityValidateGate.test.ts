import { describe, expect, it } from "vitest";
import { calculateVerdict, verdictToHumanLabel } from "../../src/securityValidation/validate/verdict.js";
import { renderTextReport, renderJsonReport } from "../../src/securityValidation/report/renderSecurityReport.js";
import type { SecurityCheckResult, SecurityFinding } from "../../src/securityValidation/types.js";
import type { SecurityReport } from "../../src/securityValidation/report/securityReportTypes.js";

// ---------------------------------------------------------------------------
// Verdict calculation
// ---------------------------------------------------------------------------

function makeCheck(overrides: Partial<SecurityCheckResult>): SecurityCheckResult {
  const now = new Date().toISOString();
  return {
    id: "test-check",
    name: "Test check",
    category: "dependency-audit",
    status: "passed",
    severity: "informational",
    startedAt: now,
    finishedAt: now,
    durationMs: 0,
    findings: [],
    ...overrides,
  };
}

function makeFinding(overrides: Partial<SecurityFinding>): SecurityFinding {
  return {
    id: "test-finding",
    title: "Test finding",
    severity: "informational",
    category: "dependency-audit",
    description: "Test description",
    releaseImpact: "No release impact",
    ...overrides,
  };
}

describe("verdict calculation", () => {
  it("all checks pass with no findings → ready-for-release-preparation", () => {
    const checks = [makeCheck({ id: "npm-audit-full", status: "passed" })];
    const { verdict } = calculateVerdict(checks, []);
    expect(verdict).toBe("ready-for-release-preparation");
  });

  it("blocker finding → not-ready-security-blocker-remains", () => {
    const checks = [makeCheck({ status: "passed" })];
    const findings = [makeFinding({ severity: "blocker" })];
    const { verdict } = calculateVerdict(checks, findings);
    expect(verdict).toBe("not-ready-security-blocker-remains");
  });

  it("major finding → not-ready-security-blocker-remains", () => {
    const checks = [makeCheck({ status: "passed" })];
    const findings = [makeFinding({ severity: "major" })];
    const { verdict } = calculateVerdict(checks, findings);
    expect(verdict).toBe("not-ready-security-blocker-remains");
  });

  it("mandatory check failed → not-ready-security-blocker-remains", () => {
    const checks = [
      makeCheck({ id: "npm-audit-full", status: "failed" }),
    ];
    const { verdict } = calculateVerdict(checks, []);
    expect(verdict).toBe("not-ready-security-blocker-remains");
  });

  it("4 or more mandatory checks skipped → inconclusive", () => {
    const checks = [
      makeCheck({ id: "npm-audit-full", status: "skipped" }),
      makeCheck({ id: "npm-audit-runtime", status: "skipped" }),
      makeCheck({ id: "npm-pack-dry-run", status: "skipped" }),
      makeCheck({ id: "source-files-not-modified", status: "skipped" }),
    ];
    const { verdict } = calculateVerdict(checks, []);
    expect(verdict).toBe("inconclusive-audit-environment-incomplete");
  });

  it("optional check skipped with no other issues → ready-except-optional-manual-checks", () => {
    const checks = [
      makeCheck({ id: "npm-audit-full", status: "passed" }),
      makeCheck({ id: "codeql-scan", status: "skipped" }),
    ];
    const { verdict } = calculateVerdict(checks, []);
    expect(verdict).toBe("ready-except-optional-manual-checks");
  });

  it("recommendedNextStep is always a non-empty string", () => {
    const scenarios: Array<[SecurityCheckResult[], SecurityFinding[]]> = [
      [[], []],
      [[makeCheck({ status: "failed", id: "npm-audit-full" })], []],
      [[], [makeFinding({ severity: "blocker" })]],
      [[makeCheck({ id: "codeql-scan", status: "skipped" })], []],
    ];
    for (const [checks, findings] of scenarios) {
      const { recommendedNextStep } = calculateVerdict(checks, findings);
      expect(typeof recommendedNextStep).toBe("string");
      expect(recommendedNextStep.length).toBeGreaterThan(0);
    }
  });
});

describe("verdictToHumanLabel", () => {
  it("maps all four verdicts to human-readable labels", () => {
    expect(verdictToHumanLabel("ready-for-release-preparation")).toBe(
      "ready for release preparation"
    );
    expect(verdictToHumanLabel("not-ready-security-blocker-remains")).toBe(
      "not ready: security blocker remains"
    );
    expect(verdictToHumanLabel("ready-except-optional-manual-checks")).toBe(
      "ready except optional manual checks"
    );
    expect(verdictToHumanLabel("inconclusive-audit-environment-incomplete")).toBe(
      "inconclusive: audit environment incomplete"
    );
  });
});

// ---------------------------------------------------------------------------
// Report rendering
// ---------------------------------------------------------------------------

function makeReport(overrides: Partial<SecurityReport> = {}): SecurityReport {
  const now = new Date().toISOString();
  return {
    metadata: {
      toolRoot: "/tool/root",
      toolPackageName: "my-dev-kit-lab",
      toolPackageVersion: "0.1.4",
      targetRoot: "/tool/root",
      targetDescription: "self (my-dev-kit-lab)",
      packageName: "my-dev-kit-lab",
      packageVersion: "0.1.4",
      branch: "feature/security-validation-release-gate",
      commit: "abc1234",
      isSelf: true,
      generatedAt: now,
      totalDurationMs: 12345,
    },
    sections: [],
    allChecks: [
      makeCheck({ id: "npm-audit-full", status: "passed", name: "npm audit full" }),
      makeCheck({ id: "codeql-scan", status: "skipped", name: "CodeQL", severity: "skipped", skippedReason: "Not installed" }),
    ],
    allFindings: [],
    verdict: "ready-except-optional-manual-checks",
    recommendedNextStep: "Optional checks were skipped.",
    ...overrides,
  };
}

describe("renderTextReport", () => {
  it("returns a non-empty string", () => {
    const text = renderTextReport(makeReport());
    expect(typeof text).toBe("string");
    expect(text.length).toBeGreaterThan(100);
  });

  it("includes package name and version", () => {
    const text = renderTextReport(makeReport());
    expect(text).toContain("my-dev-kit-lab");
    expect(text).toContain("0.1.4");
  });

  it("includes branch and commit", () => {
    const text = renderTextReport(makeReport());
    expect(text).toContain("feature/security-validation-release-gate");
    expect(text).toContain("abc1234");
  });

  it("includes the verdict label", () => {
    const text = renderTextReport(makeReport());
    expect(text.toUpperCase()).toContain("OPTIONAL MANUAL CHECKS");
  });

  it("includes skipped reason for skipped checks", () => {
    const text = renderTextReport(makeReport());
    expect(text).toContain("Not installed");
  });

  it("includes command execution details when present", () => {
    const text = renderTextReport(
      makeReport({
        allChecks: [
          makeCheck({
            id: "cli-adversarial-suite",
            name: "Target security test suite",
            command: "npm run test:security",
            commandCwd: "Z:/tmp/target project",
            exitCode: 0,
            stdoutSummary: "SECURITY_PASS_CWD=Z:/tmp/target project",
          }),
        ],
      })
    );
    expect(text).toContain("Command: npm run test:security");
    expect(text).toContain("Cwd: Z:/tmp/target project");
    expect(text).toContain("Exit code: 0");
    expect(text).toContain("SECURITY_PASS_CWD=Z:/tmp/target project");
  });

  it("includes executive summary section", () => {
    const text = renderTextReport(makeReport());
    expect(text).toContain("EXECUTIVE SUMMARY");
  });

  it("includes findings section", () => {
    const text = renderTextReport(makeReport());
    expect(text).toContain("FINDINGS BY SEVERITY");
  });

  it("includes recommended next step", () => {
    const text = renderTextReport(makeReport());
    expect(text).toContain("RECOMMENDED NEXT STEP");
  });
});

describe("renderJsonReport", () => {
  it("returns valid JSON", () => {
    const json = renderJsonReport(makeReport());
    expect(() => JSON.parse(json)).not.toThrow();
  });

  it("JSON includes schemaVersion, metadata, verdict, checks, findings", () => {
    const json = renderJsonReport(makeReport());
    const parsed = JSON.parse(json) as Record<string, unknown>;
    expect(parsed["schemaVersion"]).toBe(1);
    expect(parsed["metadata"]).toBeTruthy();
    expect(parsed["verdict"]).toBe("ready-except-optional-manual-checks");
    expect(Array.isArray(parsed["checks"])).toBe(true);
    expect(Array.isArray(parsed["findings"])).toBe(true);
  });

  it("JSON summary counts are accurate", () => {
    const json = renderJsonReport(makeReport());
    const parsed = JSON.parse(json) as Record<string, unknown>;
    const summary = parsed["summary"] as Record<string, number>;
    expect(summary["totalChecks"]).toBe(2);
    expect(summary["passed"]).toBe(1);
    expect(summary["skipped"]).toBe(1);
    expect(summary["totalFindings"]).toBe(0);
  });

  it("JSON includes verdictLabel in human-readable form", () => {
    const json = renderJsonReport(makeReport());
    const parsed = JSON.parse(json) as Record<string, unknown>;
    expect(parsed["verdictLabel"]).toBe("ready except optional manual checks");
  });

  it("JSON includes command execution details when present", () => {
    const json = renderJsonReport(
      makeReport({
        allChecks: [
          makeCheck({
            id: "cli-adversarial-suite",
            name: "Target security test suite",
            command: "npm run test:security",
            commandCwd: "Z:/tmp/target project",
            exitCode: 0,
            stdoutSummary: "SECURITY_PASS_CWD=Z:/tmp/target project",
            stderrSummary: "",
          }),
        ],
      })
    );
    const parsed = JSON.parse(json) as { checks: Array<Record<string, unknown>> };
    expect(parsed.checks[0]?.["command"]).toBe("npm run test:security");
    expect(parsed.checks[0]?.["commandCwd"]).toBe("Z:/tmp/target project");
    expect(parsed.checks[0]?.["exitCode"]).toBe(0);
    expect(parsed.checks[0]?.["stdoutSummary"]).toBe("SECURITY_PASS_CWD=Z:/tmp/target project");
  });

  it("JSON includes recommendedNextStep", () => {
    const json = renderJsonReport(makeReport());
    const parsed = JSON.parse(json) as Record<string, unknown>;
    expect(typeof parsed["recommendedNextStep"]).toBe("string");
  });
});
