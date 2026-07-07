import { describe, expect, it } from "vitest";
import { runSecurityValidation } from "../../../src/securityValidation/validate/runSecurityValidation.js";
import { renderTextReport, renderJsonReport } from "../../../src/securityValidation/report/renderSecurityReport.js";
import type { SecurityReport } from "../../../src/securityValidation/report/securityReportTypes.js";
import { DEFAULT_SECURITY_CHECKS } from "../../../src/securityValidation/validate/cliOptions.js";

const toolRoot = process.cwd();

function isConcrete(scenarioId: string): boolean {
  return !scenarioId.endsWith("-no-scenarios-registered");
}

describe("security:validate — Batch 3 concrete boundary/subprocess scenarios (integration)", () => {
  it("--profile local-tool --checks boundary runs concrete Batch 3 scenarios", async () => {
    const summary = await runSecurityValidation({
      cwd: toolRoot,
      selectedChecks: ["boundary"],
      profile: "local-tool",
    });
    expect(summary.attackResults.length).toBeGreaterThan(0);
    expect(summary.attackResults.every((r) => isConcrete(r.scenarioId))).toBe(true);
    expect(summary.attackResults.every((r) => r.checkId === "boundary")).toBe(true);
    expect(summary.attackResults.every((r) => r.profileId === "local-tool")).toBe(true);
  }, 60_000);

  it("--profile node-cli-package --checks boundary,subprocess runs concrete scenarios for both groups", async () => {
    const summary = await runSecurityValidation({
      cwd: toolRoot,
      selectedChecks: ["boundary", "subprocess"],
      profile: "node-cli-package",
    });
    expect(summary.attackResults.some((r) => r.checkId === "boundary" && isConcrete(r.scenarioId))).toBe(true);
    expect(summary.attackResults.some((r) => r.checkId === "subprocess" && isConcrete(r.scenarioId))).toBe(true);
    expect(summary.attackResults.every((r) => r.status !== "passed" || isConcrete(r.scenarioId))).toBe(true);

    const report: SecurityReport = {
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

    const json = renderJsonReport(report);
    const parsed = JSON.parse(json) as { attackScenarios: { count: number; results: Array<{ scenarioId: string }> } };
    expect(parsed.attackScenarios.count).toBe(summary.attackResults.length);
    expect(parsed.attackScenarios.results.some((r) => isConcrete(r.scenarioId))).toBe(true);

    const text = renderTextReport(report);
    expect(text).toContain("ATTACK SCENARIO FRAMEWORK");
    expect(text).toContain("concrete attack scenario(s) executed");
  }, 60_000);

  // Batch 4 registered concrete secrets/network scenarios — see
  // securityValidateContentSafetyScenarios.test.ts for the up-to-date
  // "runs concrete scenarios, never a placeholder" coverage for those checks.

  // The full no-flag default and implemented-checks-only pipelines (which
  // include cli-adversarial — self-validation spawning the entire
  // test:security suite as a subprocess — plus real npm/codeql/semgrep
  // calls) are expensive (minutes) and are already exercised end-to-end via
  // real `npm run security:validate` CLI invocations (see this batch's final
  // report / Batch 1-2 validation history). Here we verify the specific
  // mechanism that guarantees backward compatibility — that the default and
  // "implemented-only" check selections never include boundary/subprocess —
  // using a fast, targeted run instead of re-running the full expensive
  // suite three times over.
  // "deps only -> empty attackResults" is already covered by
  // securityValidateAttackScenarios.test.ts (Batch 2); not duplicated here.
  it("DEFAULT_SECURITY_CHECKS (the no-flag default) never includes boundary/subprocess/secrets/network", () => {
    expect(DEFAULT_SECURITY_CHECKS).not.toContain("boundary");
    expect(DEFAULT_SECURITY_CHECKS).not.toContain("subprocess");
    expect(DEFAULT_SECURITY_CHECKS).not.toContain("secrets");
    expect(DEFAULT_SECURITY_CHECKS).not.toContain("network");
  });
});
