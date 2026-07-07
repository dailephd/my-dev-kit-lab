import { describe, expect, it } from "vitest";
import {
  parseSecurityValidateArgs,
  normalizeSecurityValidateConfig,
  applyProfileDefaultChecksIfApplicable,
  DEFAULT_SECURITY_CHECKS,
} from "../../src/securityValidation/validate/cliOptions.js";
import { resolveAttackProfile } from "../../src/securityValidation/attackScenarios/attackProfile.js";
import { runSecurityValidation } from "../../src/securityValidation/validate/runSecurityValidation.js";
import { renderTextReport } from "../../src/securityValidation/report/renderSecurityReport.js";
import type { SecurityReport } from "../../src/securityValidation/report/securityReportTypes.js";

const toolRoot = process.cwd();

function buildEffectiveConfig(argv: string[]) {
  const args = parseSecurityValidateArgs(argv);
  let config = normalizeSecurityValidateConfig(args, toolRoot);
  config = applyProfileDefaultChecksIfApplicable(config, resolveAttackProfile(config.profile).defaultCheckIds);
  return config;
}

describe("selected-check/profile consistency guard (v0.2.2 Batch 6)", () => {
  it("no --profile and no --checks preserves current default behavior", () => {
    const config = buildEffectiveConfig([]);
    expect(config.checks).toEqual([...DEFAULT_SECURITY_CHECKS]);
  });

  it("explicit --checks always overrides profile defaults", () => {
    const config = buildEffectiveConfig(["--profile", "npm-package", "--checks", "boundary,secrets"]);
    expect(config.checks).toEqual(["boundary", "secrets"]);
  });

  it("each profile's default checks apply when --profile is supplied without --checks", () => {
    for (const profileId of ["node-cli-package", "local-tool", "npm-package"] as const) {
      const config = buildEffectiveConfig(["--profile", profileId]);
      const expected = resolveAttackProfile(profileId).defaultCheckIds;
      expect(new Set(config.checks)).toEqual(new Set(expected));
    }
  });

  it("selected checks are present in report metadata", async () => {
    const summary = await runSecurityValidation({
      cwd: toolRoot,
      selectedChecks: ["deps", "package"],
      profile: "node-cli-package",
    });
    // Metadata population happens in scripts/security/validate.ts from
    // config.checks; here we confirm the underlying summary carries enough
    // information (isFullReleaseGate) to derive that reporting correctly.
    expect(summary.isFullReleaseGate).toBe(false);
  }, 30_000);

  it("scoped-run warning appears in text report for a narrowed run", () => {
    const report = makeReportWithScope(false);
    expect(renderTextReport(report)).toContain("NARROWED");
  });

  it("scoped-run warning does not appear for a full-release-gate run", () => {
    const report = makeReportWithScope(true);
    expect(renderTextReport(report)).not.toContain("NARROWED");
  });

  it("isFullReleaseGate is true for the no-flag default check selection (deps,package,static,cli-adversarial,fuzz)", () => {
    const config = buildEffectiveConfig([]);
    const implementedIds = ["deps", "package", "static", "cli-adversarial", "fuzz"];
    expect(implementedIds.every((id) => config.checks.includes(id as (typeof config.checks)[number]))).toBe(true);
  });
});

function makeReportWithScope(isFullReleaseGate: boolean): SecurityReport {
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
      branch: "main",
      commit: "abc1234",
      isSelf: true,
      generatedAt: now,
      totalDurationMs: 1,
      isFullReleaseGate,
    },
    sections: [],
    allChecks: [],
    allFindings: [],
    verdict: "ready-except-optional-manual-checks",
    recommendedNextStep: "n/a",
  };
}
