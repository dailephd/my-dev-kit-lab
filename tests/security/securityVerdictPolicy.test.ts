import { describe, expect, it } from "vitest";
import {
  categorizeCheck,
  summarizeVerdictReasoning,
  calculateVerdict,
} from "../../src/securityValidation/validate/verdict.js";
import type { SecurityCheckResult, SecurityFinding } from "../../src/securityValidation/types.js";

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

describe("categorizeCheck", () => {
  it("passed/warning checks are not categorized (null)", () => {
    expect(categorizeCheck(makeCheck({ status: "passed" }))).toBeNull();
    expect(categorizeCheck(makeCheck({ status: "warning" }))).toBeNull();
  });

  // v0.2.2 Batch 6: categorization now reads check.verdictImpact directly
  // (carried through from the originating AttackScenario's static
  // declaration via toSecurityCheckResult()) rather than looking up the id
  // in a verdict.ts-owned map — these fixtures set verdictImpact explicitly
  // to mirror what the real pipeline populates for each named scenario.
  it("a failed target-sandbox scenario is a target-project-blocker", () => {
    const check = makeCheck({
      id: "target-sandbox-read-only",
      status: "failed",
      severity: "blocker",
      verdictImpact: "target-project-blocker",
    });
    expect(categorizeCheck(check)).toBe("target-project-blocker");
  });

  it("a failed secret-leakage scenario is a target-project-blocker", () => {
    const check = makeCheck({
      id: "secret-leakage-bounded-scan",
      status: "failed",
      severity: "blocker",
      verdictImpact: "target-project-blocker",
    });
    expect(categorizeCheck(check)).toBe("target-project-blocker");
  });

  it("a failed package-boundary scenario is a target-project-blocker", () => {
    const check = makeCheck({
      id: "package-boundary-forbidden-content",
      status: "failed",
      severity: "major",
      verdictImpact: "target-project-blocker",
    });
    expect(categorizeCheck(check)).toBe("target-project-blocker");
  });

  it("a failed report-poisoning scenario is a tool-framework-blocker", () => {
    const check = makeCheck({
      id: "report-poisoning-safety",
      status: "failed",
      severity: "major",
      verdictImpact: "tool-framework-blocker",
    });
    expect(categorizeCheck(check)).toBe("tool-framework-blocker");
  });

  it("a failed output-boundary scenario is a release-blocker", () => {
    const check = makeCheck({
      id: "output-boundary-report-dir",
      status: "failed",
      severity: "major",
      verdictImpact: "release-blocker",
    });
    expect(categorizeCheck(check)).toBe("release-blocker");
  });


  it("a failed non-scenario check is a scanner-finding", () => {
    const check = makeCheck({ id: "npm-audit-full", status: "failed", severity: "major" });
    expect(categorizeCheck(check)).toBe("scanner-finding");
  });

  it("an unrecognized failed scenario-shaped id falls back to adversarial-scenario-failure", () => {
    const check = makeCheck({ id: "secrets-no-scenarios-registered", status: "failed", severity: "major" });
    expect(categorizeCheck(check)).toBe("adversarial-scenario-failure");
  });

  it("a skipped mandatory check is required-evidence-missing", () => {
    const check = makeCheck({ id: "npm-audit-full", status: "skipped" });
    expect(categorizeCheck(check)).toBe("required-evidence-missing");
  });

  it("a skipped optional (non-mandatory, non-scenario) check is optional-skipped-tool", () => {
    const check = makeCheck({ id: "codeql-scan", status: "skipped" });
    expect(categorizeCheck(check)).toBe("optional-skipped-tool");
  });

  it("a skipped attack-scenario check is adversarial-scenario-skipped, distinct from optional-skipped-tool", () => {
    const check = makeCheck({ id: "secrets-no-scenarios-registered", status: "skipped" });
    expect(categorizeCheck(check)).toBe("adversarial-scenario-skipped");
  });
});

describe("summarizeVerdictReasoning", () => {
  it("scanner findings are counted separately from adversarial scenario failures", () => {
    const checks = [
      makeCheck({ id: "npm-audit-full", status: "failed", severity: "major" }),
      makeCheck({
        id: "path-traversal-containment",
        status: "failed",
        severity: "blocker",
        verdictImpact: "tool-framework-blocker",
      }),
    ];
    const summary = summarizeVerdictReasoning(checks, []);
    expect(summary.scannerFindingCount).toBe(1);
    expect(summary.toolFrameworkBlockerCount).toBe(1);
  });

  it("optional skipped tools are counted separately from adversarial scenario skipped results", () => {
    const checks = [
      makeCheck({ id: "codeql-scan", status: "skipped" }),
      makeCheck({ id: "network-no-scenarios-registered", status: "skipped" }),
    ];
    const summary = summarizeVerdictReasoning(checks, []);
    expect(summary.optionalSkippedToolCount).toBe(1);
    expect(summary.adversarialScenarioSkippedCount).toBe(1);
  });

  it("release blockers, target-project blockers, and tool-framework blockers are all counted", () => {
    const checks = [
      makeCheck({
        id: "output-boundary-report-dir",
        status: "failed",
        severity: "major",
        verdictImpact: "release-blocker",
      }),
      makeCheck({
        id: "target-sandbox-read-only",
        status: "failed",
        severity: "blocker",
        verdictImpact: "target-project-blocker",
      }),
      makeCheck({
        id: "report-poisoning-safety",
        status: "failed",
        severity: "major",
        verdictImpact: "tool-framework-blocker",
      }),
    ];
    const summary = summarizeVerdictReasoning(checks, []);
    expect(summary.releaseBlockerCount).toBe(1);
    expect(summary.targetProjectBlockerCount).toBe(1);
    expect(summary.toolFrameworkBlockerCount).toBe(1);
  });

  it("informational evidence is counted from findings and does not fail the run", () => {
    const checks = [makeCheck({ id: "npm-outdated", status: "passed" })];
    const findings = [makeFinding({ severity: "informational" })];
    const summary = summarizeVerdictReasoning(checks, findings);
    expect(summary.informationalEvidenceCount).toBe(1);
    const { verdict } = calculateVerdict(checks, findings);
    expect(verdict).not.toBe("not-ready-security-blocker-remains");
  });

  it("required evidence missing is counted for skipped mandatory checks", () => {
    const checks = [makeCheck({ id: "npm-pack-dry-run", status: "skipped" })];
    const summary = summarizeVerdictReasoning(checks, []);
    expect(summary.requiredEvidenceMissingCount).toBe(1);
  });
});

describe("attack scenario contribution to verdict (via existing calculateVerdict)", () => {
  it("a failed target-sandbox scenario (blocker severity) contributes to not-ready verdict", () => {
    const checks = [makeCheck({ id: "target-sandbox-read-only", status: "failed", severity: "blocker" })];
    const findings = [makeFinding({ severity: "blocker" })];
    const { verdict } = calculateVerdict(checks, findings);
    expect(verdict).toBe("not-ready-security-blocker-remains");
  });

  it("a failed secret leakage scenario (blocker severity) contributes to not-ready verdict", () => {
    const checks = [makeCheck({ id: "secret-leakage-bounded-scan", status: "failed", severity: "blocker" })];
    const findings = [makeFinding({ severity: "blocker" })];
    const { verdict } = calculateVerdict(checks, findings);
    expect(verdict).toBe("not-ready-security-blocker-remains");
  });

  it("a failed report poisoning scenario (major severity) contributes to not-ready verdict", () => {
    const checks = [makeCheck({ id: "report-poisoning-safety", status: "failed", severity: "major" })];
    const findings = [makeFinding({ severity: "major" })];
    const { verdict } = calculateVerdict(checks, findings);
    expect(verdict).toBe("not-ready-security-blocker-remains");
  });

  it("optional skipped tools alone do not produce a not-ready verdict", () => {
    const checks = [makeCheck({ id: "codeql-scan", status: "skipped" })];
    const { verdict } = calculateVerdict(checks, []);
    expect(verdict).not.toBe("not-ready-security-blocker-remains");
  });

  it("a skipped attack scenario result is not treated as passed and does not become a blocker by itself", () => {
    const checks = [makeCheck({ id: "secrets-no-scenarios-registered", status: "skipped" })];
    const { verdict } = calculateVerdict(checks, []);
    expect(checks[0].status).not.toBe("passed");
    expect(verdict).not.toBe("not-ready-security-blocker-remains");
  });
});
