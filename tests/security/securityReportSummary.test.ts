import { describe, expect, it } from "vitest";
import { renderTextReport, renderJsonReport } from "../../src/securityValidation/report/renderSecurityReport.js";
import type { SecurityReport } from "../../src/securityValidation/report/securityReportTypes.js";
import type { VerdictReasonSummary } from "../../src/securityValidation/validate/verdict.js";

function makeVerdictReasonSummary(overrides: Partial<VerdictReasonSummary> = {}): VerdictReasonSummary {
  return {
    releaseBlockerCount: 0,
    targetProjectBlockerCount: 0,
    toolFrameworkBlockerCount: 0,
    environmentInconclusiveCount: 0,
    optionalSkippedToolCount: 0,
    adversarialScenarioSkippedCount: 0,
    scannerFindingCount: 0,
    adversarialScenarioFailureCount: 0,
    requiredEvidenceMissingCount: 0,
    informationalEvidenceCount: 0,
    ...overrides,
  };
}

function makeReport(overrides: Partial<SecurityReport> = {}): SecurityReport {
  const now = new Date().toISOString();
  return {
    metadata: {
      toolRoot: "/tool/root",
      toolPackageName: "my-dev-kit-lab",
      toolPackageVersion: "0.2.1",
      targetRoot: "/tool/root",
      targetDescription: "self (my-dev-kit-lab)",
      packageName: "my-dev-kit-lab",
      packageVersion: "0.2.1",
      branch: "feature/security-validate-config-surface",
      commit: "abc1234",
      isSelf: true,
      generatedAt: now,
      totalDurationMs: 12345,
      profile: "node-cli-package",
      selectedChecks: ["deps", "package"],
      failOnThreshold: "high",
      formats: ["text", "json"],
      failOnBreached: false,
      isFullReleaseGate: false,
    },
    sections: [],
    allChecks: [],
    allFindings: [],
    verdict: "ready-except-optional-manual-checks",
    recommendedNextStep: "Optional checks were skipped.",
    ...overrides,
  };
}

describe("JSON report — Batch 5 fields", () => {
  it("includes failOnThreshold and selectedChecks/profile (Batch 1 fields preserved)", () => {
    const json = renderJsonReport(makeReport());
    const parsed = JSON.parse(json) as { metadata: Record<string, unknown> };
    expect(parsed.metadata.failOnThreshold).toBe("high");
    expect(parsed.metadata.selectedChecks).toEqual(["deps", "package"]);
    expect(parsed.metadata.profile).toBe("node-cli-package");
  });

  it("includes failOnBreached and isFullReleaseGate", () => {
    const json = renderJsonReport(makeReport());
    const parsed = JSON.parse(json) as { metadata: Record<string, unknown> };
    expect(parsed.metadata.failOnBreached).toBe(false);
    expect(parsed.metadata.isFullReleaseGate).toBe(false);
  });

  it("includes severity counts including informationalFindings", () => {
    const json = renderJsonReport(
      makeReport({
        allFindings: [
          {
            id: "f1",
            title: "t",
            severity: "informational",
            category: "dependency-audit",
            description: "d",
            releaseImpact: "none",
          },
        ],
      })
    );
    const parsed = JSON.parse(json) as { summary: Record<string, number> };
    expect(parsed.summary.informationalFindings).toBe(1);
  });

  it("includes verdictReasonSummary category counts when supplied", () => {
    const json = renderJsonReport(
      makeReport({ verdictReasonSummary: makeVerdictReasonSummary({ releaseBlockerCount: 2, scannerFindingCount: 3 }) })
    );
    const parsed = JSON.parse(json) as { verdictReasonSummary: VerdictReasonSummary };
    expect(parsed.verdictReasonSummary.releaseBlockerCount).toBe(2);
    expect(parsed.verdictReasonSummary.scannerFindingCount).toBe(3);
  });

  it("verdictReasonSummary is null when not supplied (existing report construction unaffected)", () => {
    const json = renderJsonReport(makeReport());
    const parsed = JSON.parse(json) as { verdictReasonSummary: unknown };
    expect(parsed.verdictReasonSummary).toBeNull();
  });

  it("existing top-level keys are preserved (additive-only schema change)", () => {
    const json = renderJsonReport(makeReport());
    const parsed = JSON.parse(json) as Record<string, unknown>;
    for (const key of [
      "schemaVersion",
      "metadata",
      "summary",
      "verdict",
      "verdictLabel",
      "recommendedNextStep",
      "checks",
      "findings",
      "attackScenarios",
    ]) {
      expect(Object.prototype.hasOwnProperty.call(parsed, key)).toBe(true);
    }
  });
});

describe("text report — Batch 5 fields", () => {
  it("includes selected checks and profile", () => {
    const text = renderTextReport(makeReport());
    expect(text).toContain("Profile    : node-cli-package");
    expect(text).toContain("Checks     : deps, package");
  });

  it("includes fail-on threshold and breach status", () => {
    const text = renderTextReport(makeReport());
    expect(text).toContain("Fail-on    : high — not breached");
  });

  it("includes breach indicator when failOnBreached is true", () => {
    const text = renderTextReport(makeReport({ metadata: { ...makeReport().metadata, failOnBreached: true } }));
    expect(text).toContain("Fail-on    : high — BREACHED");
  });

  it("includes a scoped-run warning when isFullReleaseGate is false", () => {
    const text = renderTextReport(makeReport());
    expect(text).toContain("NARROWED");
    expect(text).toContain("does not represent full release readiness");
  });

  it("omits the scoped-run warning when isFullReleaseGate is true", () => {
    const text = renderTextReport(makeReport({ metadata: { ...makeReport().metadata, isFullReleaseGate: true } }));
    expect(text).not.toContain("NARROWED");
  });

  it("includes release blocker and target-project blocker counts when verdictReasonSummary is supplied", () => {
    const text = renderTextReport(
      makeReport({
        verdictReasonSummary: makeVerdictReasonSummary({ releaseBlockerCount: 1, targetProjectBlockerCount: 2 }),
      })
    );
    expect(text).toContain("VERDICT REASONING");
    expect(text).toContain("Release blockers          : 1");
    expect(text).toContain("Target-project blockers   : 2");
  });

  it("omits the verdict reasoning section when verdictReasonSummary is not supplied", () => {
    const text = renderTextReport(makeReport());
    expect(text).not.toContain("VERDICT REASONING");
  });

  it("does not reintroduce ANSI/control leaks (Batch 4 fix) — recommendedNextStep is sanitized", () => {
    const esc = String.fromCharCode(27);
    const ansiPayload = esc + "[31mFAKE" + esc + "[0m";
    const text = renderTextReport(makeReport({ recommendedNextStep: ansiPayload }));
    const ansiPattern = new RegExp(esc + "\[[0-9;]*[a-zA-Z]");
    expect(ansiPattern.test(text)).toBe(false);
  });
});
