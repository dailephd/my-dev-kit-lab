import { describe, expect, it } from "vitest";
import { runSecurityValidation } from "../../../src/securityValidation/validate/runSecurityValidation.js";
import { renderTextReport, renderJsonReport } from "../../../src/securityValidation/report/renderSecurityReport.js";
import type { SecurityReport } from "../../../src/securityValidation/report/securityReportTypes.js";
import { DEFAULT_SECURITY_CHECKS } from "../../../src/securityValidation/validate/cliOptions.js";

const toolRoot = process.cwd();

function isConcrete(scenarioId: string): boolean {
  return !scenarioId.endsWith("-no-scenarios-registered");
}

function buildReport(summary: Awaited<ReturnType<typeof runSecurityValidation>>): SecurityReport {
  return {
    metadata: {
      toolRoot: summary.toolRoot,
      toolPackageName: summary.toolPackageName,
      toolPackageVersion: summary.toolPackageVersion,
      targetRoot: summary.targetRoot,
      targetDescription: summary.targetDescription,
      packageName: summary.packageName,
      packageVersion: summary.packageVersion,
      branch: summary.auditedBranch,
      commit: summary.auditedCommit,
      isSelf: summary.isSelf,
      generatedAt: summary.finishedAt,
      totalDurationMs: 0,
    },
    sections: [],
    allChecks: summary.checks,
    allFindings: summary.findings,
    verdict: summary.verdict,
    recommendedNextStep: summary.recommendedNextStep,
    attackResults: summary.attackResults,
  };
}

describe("security:validate — Batch 4 secrets/report-poisoning/network scenarios (integration)", () => {
  it("--profile local-tool --checks secrets --format json runs the concrete secret scenario", async () => {
    const summary = await runSecurityValidation({
      cwd: toolRoot,
      selectedChecks: ["secrets"],
      profile: "local-tool",
    });
    expect(summary.attackResults).toHaveLength(1);
    expect(isConcrete(summary.attackResults[0].scenarioId)).toBe(true);
    expect(summary.attackResults[0].checkId).toBe("secrets");
    expect(summary.attackResults[0].profileId).toBe("local-tool");
  }, 60_000);

  it("--profile local-tool --checks network --format json runs the concrete network scenario", async () => {
    const summary = await runSecurityValidation({
      cwd: toolRoot,
      selectedChecks: ["network"],
      profile: "local-tool",
    });
    expect(summary.attackResults).toHaveLength(1);
    expect(isConcrete(summary.attackResults[0].scenarioId)).toBe(true);
    expect(summary.attackResults[0].checkId).toBe("network");
  }, 60_000);

  it("--checks secrets,network no longer returns no-scenarios-registered placeholders for those checks", async () => {
    const summary = await runSecurityValidation({
      cwd: toolRoot,
      selectedChecks: ["secrets", "network"],
      profile: "node-cli-package",
    });
    expect(summary.attackResults).toHaveLength(2);
    expect(summary.attackResults.every((r) => isConcrete(r.scenarioId))).toBe(true);
    expect(summary.checks.some((c) => c.id === "secrets-no-scenarios-registered")).toBe(false);
    expect(summary.checks.some((c) => c.id === "network-no-scenarios-registered")).toBe(false);
  }, 60_000);

  it("--profile node-cli-package --checks boundary,secrets,network --format text,json includes Batch 3 and Batch 4 concrete results", async () => {
    const summary = await runSecurityValidation({
      cwd: toolRoot,
      selectedChecks: ["boundary", "secrets", "network"],
      profile: "node-cli-package",
    });
    // 6 boundary (incl. report-poisoning) + 1 secrets + 1 network = 8.
    expect(summary.attackResults).toHaveLength(8);
    expect(summary.attackResults.every((r) => isConcrete(r.scenarioId))).toBe(true);
    expect(summary.checks.some((c) => c.id === "report-poisoning-safety")).toBe(true);
    expect(summary.checks.some((c) => c.id === "secret-leakage-bounded-scan")).toBe(true);
    expect(summary.checks.some((c) => c.id === "network-local-first-bounded-scan")).toBe(true);

    const report = buildReport(summary);
    const json = renderJsonReport(report);
    const parsed = JSON.parse(json) as { attackScenarios: { count: number; results: Array<{ scenarioId: string }> } };
    expect(parsed.attackScenarios.count).toBe(8);
    expect(parsed.attackScenarios.results.some((r) => r.scenarioId === "secret-leakage-bounded-scan")).toBe(true);

    const text = renderTextReport(report);
    expect(text).toContain("ATTACK SCENARIO FRAMEWORK");
    expect(text).toContain("8 concrete attack scenario(s) executed");
    // No more "still pending" wording for boundary/secrets/network now that
    // all three have concrete scenarios registered.
    expect(text).not.toContain("still pending for");
  }, 90_000);

  // The full no-flag pipeline (deps/package/static/cli-adversarial/fuzz,
  // including cli-adversarial self-spawning the whole test:security suite)
  // is expensive and already exercised via real CLI smoke runs for this
  // batch. secrets/network staying out of the default is guaranteed by this
  // static check on the same DEFAULT_SECURITY_CHECKS the runner consults.
  it("no-flag default behavior is unchanged (secrets/network not in the default check selection)", () => {
    expect(DEFAULT_SECURITY_CHECKS).not.toContain("secrets");
    expect(DEFAULT_SECURITY_CHECKS).not.toContain("network");
  });
});
