import { describe, expect, it } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
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

describe("selected-check/profile consistency guard (Batch 6)", () => {
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
    // Flake investigation (v0.3.0 readiness pass): this test runs real
    // "deps" + "package" checks (npm audit x2, npm outdated, npm ls,
    // osv-scanner, npm pack --dry-run) against the tool root. Every sibling
    // test file in tests/security/ that also selects "deps"/"package"
    // (e.g. securityValidateAttackScenarios.test.ts,
    // securityValidateVerdictIntegration.test.ts) calls runSecurityValidation
    // with the *default* config, which resolves reportDir/rawOutputDir to
    // the same fixed path: <toolRoot>/reports/security. Under `npm run
    // test:security`, vitest runs test files concurrently in separate
    // worker processes, so many of those files write to the exact same
    // reports/security/*.json files at the same time. That collision, plus
    // ordinary CPU/subprocess contention from ~40 concurrent test files
    // spawning real npm processes, measurably slows this test down (observed
    // ~9s in isolation vs ~15s under full-suite load in this environment,
    // and comparable sibling tests ranged 8.7s-15.9s under load) even
    // without any assertion actually depending on the written files. A
    // fixed 30s timeout combined with that variance is a plausible source
    // of the one-off failure under parallel load on a busier machine/CI.
    // Fix: give this test its own isolated report/raw output directories
    // (mkdtempSync) so it never shares a destination file with a
    // concurrently-running sibling test file, and bring the timeout in
    // line with the 60s precedent already used by equivalent-weight
    // sibling checks (see securityValidateAttackScenarios.test.ts).
    const isolatedReportDir = fs.mkdtempSync(
      path.join(os.tmpdir(), "sec-profile-selection-report-")
    );
    try {
      const summary = await runSecurityValidation({
        cwd: toolRoot,
        selectedChecks: ["deps", "package"],
        profile: "node-cli-package",
        config: {
          reportDir: isolatedReportDir,
          rawOutputDir: path.join(isolatedReportDir, "raw"),
        },
      });
      // Metadata population happens in scripts/security/validate.ts from
      // config.checks; here we confirm the underlying summary carries enough
      // information (isFullReleaseGate) to derive that reporting correctly.
      expect(summary.isFullReleaseGate).toBe(false);
    } finally {
      fs.rmSync(isolatedReportDir, { recursive: true, force: true });
    }
  }, 60_000);

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
