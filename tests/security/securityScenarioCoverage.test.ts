import { describe, expect, it } from "vitest";
import { SECURITY_CHECK_IDS, IMPLEMENTED_SECURITY_CHECK_IDS, PLANNED_SECURITY_CHECK_IDS } from "../../src/securityValidation/validate/cliOptions.js";
import { SCENARIO_REGISTRY, runAttackScenarios } from "../../src/securityValidation/attackScenarios/attackRunner.js";
import { DEFAULT_SECURITY_CONFIG } from "../../src/securityValidation/config.js";
import type { SecurityValidationTarget } from "../../src/securityValidation/validate/resolveTarget.js";

function fakeTarget(): SecurityValidationTarget {
  return {
    targetRoot: process.cwd(),
    toolRoot: process.cwd(),
    packageName: "fake",
    packageVersion: "1.0.0",
    hasPackageJson: true,
    hasSecurityTestScript: false,
    hasLockfile: false,
    branch: "main",
    commit: "abc",
    hasGit: true,
    isSelf: true,
  };
}

describe("all 9 supported --checks ids have expected implementation coverage (v0.2.2 Batch 6)", () => {
  it("SECURITY_CHECK_IDS has exactly 9 ids: 5 implemented check-group + 4 attack-scenario", () => {
    expect(SECURITY_CHECK_IDS.length).toBe(9);
    expect(IMPLEMENTED_SECURITY_CHECK_IDS.length).toBe(5);
    expect(PLANNED_SECURITY_CHECK_IDS.length).toBe(4);
  });

  it("deps/package/static/cli-adversarial/fuzz are covered by existing check-group behavior, not attack scenarios", () => {
    for (const id of IMPLEMENTED_SECURITY_CHECK_IDS) {
      expect(SCENARIO_REGISTRY.some((s) => s.checkId === id)).toBe(false);
    }
  });

  it("boundary/subprocess/secrets/network each have at least one registered concrete scenario", () => {
    for (const id of PLANNED_SECURITY_CHECK_IDS) {
      expect(SCENARIO_REGISTRY.some((s) => s.checkId === id)).toBe(true);
    }
  });

  it("secrets and network no longer produce no-scenarios-registered placeholders", async () => {
    const results = await runAttackScenarios({
      selectedChecks: ["secrets", "network"],
      profile: "node-cli-package",
      toolRoot: process.cwd(),
      target: fakeTarget(),
      config: DEFAULT_SECURITY_CONFIG,
    });
    expect(results).toHaveLength(2);
    expect(results.every((r) => !r.scenarioId.endsWith("-no-scenarios-registered"))).toBe(true);
  }, 20_000);

  it("every one of the 9 --checks ids is either an implemented check group or has a registered scenario (no silent gap)", () => {
    const scenarioCoveredIds = new Set(SCENARIO_REGISTRY.map((s) => s.checkId));
    for (const id of SECURITY_CHECK_IDS) {
      const isImplementedGroup = (IMPLEMENTED_SECURITY_CHECK_IDS as readonly string[]).includes(id);
      const hasScenario = scenarioCoveredIds.has(id);
      expect(isImplementedGroup || hasScenario).toBe(true);
    }
  });
});
