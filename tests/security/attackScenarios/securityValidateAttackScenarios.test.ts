import { describe, expect, it } from "vitest";
import { runSecurityValidation } from "../../../src/securityValidation/validate/runSecurityValidation.js";
import { renderTextReport, renderJsonReport } from "../../../src/securityValidation/report/renderSecurityReport.js";
import type { SecurityReport } from "../../../src/securityValidation/report/securityReportTypes.js";
import type { AttackResult } from "../../../src/securityValidation/attackScenarios/attackResult.js";

const toolRoot = process.cwd();

describe("runSecurityValidation — attack scenario integration (v0.2.2 Batch 2/3/4)", () => {
  it("selecting boundary/secrets runs concrete scenarios for both groups (Batch 4 registered secrets)", async () => {
    const summary = await runSecurityValidation({
      cwd: toolRoot,
      selectedChecks: ["boundary", "secrets"],
      profile: "node-cli-package",
    });

    // Batch 3 registered 6 concrete boundary scenarios (incl. Batch 4's
    // report-poisoning); Batch 4 registered 1 concrete secrets scenario (7 total).
    expect(summary.attackResults.length).toBe(7);
    expect(summary.attackResults.every((r) => r.scenarioId !== "secrets-no-scenarios-registered")).toBe(true);
    expect(summary.checks.some((c) => c.id === "secrets-no-scenarios-registered")).toBe(false);
    // Concrete boundary scenarios now run for real, not as a placeholder.
    expect(summary.checks.some((c) => c.id === "target-sandbox-read-only")).toBe(true);
    expect(summary.checks.some((c) => c.id === "package-boundary-forbidden-content")).toBe(true);
    expect(summary.checks.some((c) => c.id === "secret-leakage-bounded-scan")).toBe(true);
    // deselected implemented groups still show up as explicit skipped checks, not silently absent
    expect(summary.checks.some((c) => c.id === "npm-audit-full" && c.status === "skipped")).toBe(true);
  }, 60_000);

  it("threads the selected profile through to attack results", async () => {
    const summary = await runSecurityValidation({
      cwd: toolRoot,
      selectedChecks: ["network"],
      profile: "local-tool",
    });
    expect(summary.attackResults).toHaveLength(1);
    expect(summary.attackResults[0].profileId).toBe("local-tool");
  }, 20_000);

  it("defaults to an empty attackResults array when no attack-scenario checks are selected", async () => {
    const summary = await runSecurityValidation({
      cwd: toolRoot,
      selectedChecks: ["deps"],
    });
    expect(summary.attackResults).toEqual([]);
  }, 60_000);
});

function makeAttackResult(overrides: Partial<AttackResult> = {}): AttackResult {
  return {
    scenarioId: "boundary-no-scenarios-registered",
    scenarioTitle: "No attack scenarios registered for 'boundary'",
    checkId: "boundary",
    profileId: "node-cli-package",
    status: "skipped",
    severity: "skipped",
    confidence: "low",
    evidence: [],
    category: "artifact-safety",
    skippedReason: "No attack scenarios are registered yet for check group 'boundary'.",
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
      totalDurationMs: 100,
    },
    sections: [],
    allChecks: [],
    allFindings: [],
    verdict: "ready-except-optional-manual-checks",
    recommendedNextStep: "Optional checks were skipped.",
    ...overrides,
  };
}

describe("report rendering — attack scenario section", () => {
  it("JSON report includes an attackScenarios field with count and results", () => {
    const json = renderJsonReport(makeReport({ attackResults: [makeAttackResult()] }));
    const parsed = JSON.parse(json) as { attackScenarios: { count: number; results: unknown[] } };
    expect(parsed.attackScenarios.count).toBe(1);
    expect(parsed.attackScenarios.results).toHaveLength(1);
  });

  it("JSON report has an empty attackScenarios section when no attack results are present", () => {
    const json = renderJsonReport(makeReport());
    const parsed = JSON.parse(json) as { attackScenarios: { count: number; results: unknown[] } };
    expect(parsed.attackScenarios.count).toBe(0);
  });

  it("text report includes a clear framework-present-but-pending section when attack results exist", () => {
    const text = renderTextReport(makeReport({ attackResults: [makeAttackResult()] }));
    expect(text).toContain("ATTACK SCENARIO FRAMEWORK");
    expect(text).toContain("pending");
    expect(text).not.toContain("[PASS]");
  });

  it("text report omits the attack scenario section entirely when there are no attack results", () => {
    const text = renderTextReport(makeReport());
    expect(text).not.toContain("ATTACK SCENARIO FRAMEWORK");
  });

  it("text report never renders an attack scenario result as PASS-labeled when unimplemented", () => {
    const text = renderTextReport(
      makeReport({ attackResults: [makeAttackResult({ status: "skipped" })] })
    );
    expect(text).toContain("[SKIP]");
  });
});
