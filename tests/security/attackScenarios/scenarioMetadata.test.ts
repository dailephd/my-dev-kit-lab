import { describe, expect, it } from "vitest";
import { SCENARIO_REGISTRY, runAttackScenarios } from "../../../src/securityValidation/attackScenarios/attackRunner.js";
import { SECURITY_CHECK_IDS } from "../../../src/securityValidation/validate/cliOptions.js";
import { VERDICT_IMPACTS } from "../../../src/securityValidation/types.js";
import { DEFAULT_SECURITY_CONFIG } from "../../../src/securityValidation/config.js";
import type { SecurityValidationTarget } from "../../../src/securityValidation/validate/resolveTarget.js";
import type { AttackScenario } from "../../../src/securityValidation/attackScenarios/attackScenario.js";

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

describe("SCENARIO_REGISTRY — metadata consistency guard (Batch 6)", () => {
  it("every registered scenario has a non-empty, deterministic id and checkId", () => {
    for (const scenario of SCENARIO_REGISTRY) {
      expect(typeof scenario.id).toBe("string");
      expect(scenario.id.length).toBeGreaterThan(0);
      expect(SECURITY_CHECK_IDS).toContain(scenario.checkId);
    }
  });

  it("every registered scenario id is unique", () => {
    const ids = SCENARIO_REGISTRY.map((s) => s.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("every registered scenario declares applicableProfiles as an array", () => {
    for (const scenario of SCENARIO_REGISTRY) {
      expect(Array.isArray(scenario.applicableProfiles)).toBe(true);
    }
  });

  it("every registered scenario declares a valid severityBaseline", () => {
    const validSeverities = ["blocker", "major", "minor", "informational", "skipped"];
    for (const scenario of SCENARIO_REGISTRY) {
      expect(validSeverities).toContain(scenario.severityBaseline);
    }
  });

  it("every registered scenario declares verdictImpact metadata (Batch 6)", () => {
    const missing = SCENARIO_REGISTRY.filter((s) => s.verdictImpact === undefined).map((s) => s.id);
    expect(missing).toEqual([]);
  });

  it("every declared verdictImpact is one of the supported VerdictImpact values", () => {
    for (const scenario of SCENARIO_REGISTRY) {
      if (scenario.verdictImpact !== undefined) {
        expect(VERDICT_IMPACTS).toContain(scenario.verdictImpact);
      }
    }
  });

  it("boundary check group has multiple concrete scenarios registered", () => {
    const boundaryScenarios = SCENARIO_REGISTRY.filter((s) => s.checkId === "boundary");
    expect(boundaryScenarios.length).toBeGreaterThan(1);
  });

  it("subprocess, secrets, and network each have at least one concrete scenario registered", () => {
    for (const checkId of ["subprocess", "secrets", "network"] as const) {
      const scenarios = SCENARIO_REGISTRY.filter((s) => s.checkId === checkId);
      expect(scenarios.length).toBeGreaterThanOrEqual(1);
    }
  });

  it("deps/package/static/cli-adversarial/fuzz are NOT forced into attack scenarios", () => {
    for (const checkId of ["deps", "package", "static", "cli-adversarial", "fuzz"] as const) {
      const scenarios = SCENARIO_REGISTRY.filter((s) => s.checkId === checkId);
      expect(scenarios.length).toBe(0);
    }
  });
});

describe("scenario registration fallback behavior (a scenario without verdictImpact)", () => {
  it("a fake scenario without verdictImpact still produces a structured (non-crashing) result, categorized generically", async () => {
    const fakeScenario: AttackScenario = {
      id: "fake-scenario-no-impact",
      title: "Fake scenario without verdictImpact",
      description: "test fixture",
      checkId: "boundary",
      applicableProfiles: [],
      severityBaseline: "major",
      // verdictImpact intentionally omitted
      expectedSafeBehavior: "n/a",
      evidenceRequirements: [],
      run: async () => ({ status: "failed", confidence: "low", evidence: [] }),
    };

    const results = await runAttackScenarios({
      scenarios: [fakeScenario],
      selectedChecks: ["boundary"],
      profile: "node-cli-package",
      toolRoot: process.cwd(),
      target: fakeTarget(),
      config: DEFAULT_SECURITY_CONFIG,
    });

    expect(results).toHaveLength(1);
    expect(results[0].status).toBe("failed");
    expect(results[0].verdictImpact).toBeUndefined();
  });
});

describe("attack scenario result consistency (Batch 6)", () => {
  it("all 9 concrete-scenario results (real run against self) are internally consistent", async () => {
    const results = await runAttackScenarios({
      selectedChecks: ["boundary", "subprocess", "secrets", "network"],
      profile: "node-cli-package",
      toolRoot: process.cwd(),
      target: fakeTarget(),
      config: DEFAULT_SECURITY_CONFIG,
    });

    expect(results.length).toBe(SCENARIO_REGISTRY.length);

    for (const result of results) {
      // severity/status compatibility
      if (result.status === "skipped") {
        expect(result.skippedReason).toBeTruthy();
      }
      if (result.status === "blocked") {
        expect(result.errorSummary ?? result.evidence.length > 0).toBeTruthy();
      }
      // Note: AttackResult.severity reflects the scenario's baseline/observed
      // severity regardless of status (it's "how bad would this be if it
      // failed", not "is there currently a problem") — a passed scenario can
      // legitimately carry severity "blocker" (e.g. target-sandbox). What
      // must hold for a passed result is that toSecurityCheckResult()
      // produces zero findings for it — verified directly in attackResult.test.ts.
      // evidence previews must never contain raw ANSI escape bytes
      const esc = String.fromCharCode(27);
      for (const e of result.evidence) {
        if (e.redactedPreview) {
          expect(e.redactedPreview.includes(esc)).toBe(false);
        }
      }
    }
  }, 30_000);

  it("result order is deterministic across repeated runs", async () => {
    const options = {
      selectedChecks: ["boundary", "subprocess", "secrets", "network"] as const,
      profile: "node-cli-package" as const,
      toolRoot: process.cwd(),
      target: fakeTarget(),
      config: DEFAULT_SECURITY_CONFIG,
    };
    const first = await runAttackScenarios(options);
    const second = await runAttackScenarios(options);
    expect(first.map((r) => r.scenarioId)).toEqual(second.map((r) => r.scenarioId));
  }, 30_000);
});
