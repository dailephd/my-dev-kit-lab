import path from "node:path";
import { describe, expect, it } from "vitest";
import { filterScenarios, runAttackScenarios, SCENARIO_REGISTRY } from "../../../src/securityValidation/attackScenarios/attackRunner.js";
import type { AttackScenario } from "../../../src/securityValidation/attackScenarios/attackScenario.js";
import { DEFAULT_SECURITY_CONFIG } from "../../../src/securityValidation/config.js";
import type { SecurityValidationTarget } from "../../../src/securityValidation/validate/resolveTarget.js";

const toolRoot = path.resolve("/tmp/tool-root");

function fakeTarget(): SecurityValidationTarget {
  return {
    targetRoot: toolRoot,
    toolRoot,
    packageName: "fake-package",
    packageVersion: "1.0.0",
    hasPackageJson: true,
    hasSecurityTestScript: true,
    hasLockfile: true,
    branch: "main",
    commit: "abc1234",
    hasGit: true,
    isSelf: true,
  };
}

function scenario(overrides: Partial<AttackScenario>): AttackScenario {
  return {
    id: "test-scenario",
    title: "Test scenario",
    description: "A test scenario",
    checkId: "boundary",
    applicableProfiles: [],
    severityBaseline: "minor",
    expectedSafeBehavior: "does not do anything unsafe",
    evidenceRequirements: [],
    run: async () => ({ status: "passed", confidence: "low", evidence: [] }),
    ...overrides,
  };
}

describe("SCENARIO_REGISTRY", () => {
  it("has concrete scenarios registered for boundary, subprocess, secrets, and network (Batch 3 + Batch 4)", () => {
    expect(SCENARIO_REGISTRY.length).toBeGreaterThan(0);
    const allowedCheckIds = new Set(["boundary", "subprocess", "secrets", "network"]);
    expect(SCENARIO_REGISTRY.every((s) => allowedCheckIds.has(s.checkId))).toBe(true);
    expect(SCENARIO_REGISTRY.some((s) => s.checkId === "secrets")).toBe(true);
    expect(SCENARIO_REGISTRY.some((s) => s.checkId === "network")).toBe(true);
  });

  it("has zero scenarios registered for deps/package/static/cli-adversarial/fuzz (out of scope for this framework)", () => {
    const outOfScope = new Set(["deps", "package", "static", "cli-adversarial", "fuzz"]);
    expect(SCENARIO_REGISTRY.some((s) => outOfScope.has(s.checkId))).toBe(false);
  });

  it("scenario ids are unique", () => {
    const ids = SCENARIO_REGISTRY.map((s) => s.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
});

describe("filterScenarios", () => {
  it("filters by selected checks", () => {
    const scenarios = [scenario({ id: "a", checkId: "boundary" }), scenario({ id: "b", checkId: "secrets" })];
    const filtered = filterScenarios(scenarios, ["boundary"], "node-cli-package");
    expect(filtered.map((s) => s.id)).toEqual(["a"]);
  });

  it("filters by selected profile", () => {
    const scenarios = [
      scenario({ id: "a", checkId: "boundary", applicableProfiles: ["local-tool"] }),
      scenario({ id: "b", checkId: "boundary", applicableProfiles: ["npm-package"] }),
      scenario({ id: "c", checkId: "boundary", applicableProfiles: [] }),
    ];
    const filtered = filterScenarios(scenarios, ["boundary"], "local-tool");
    expect(filtered.map((s) => s.id)).toEqual(["a", "c"]);
  });

  it("preserves registry order", () => {
    const scenarios = [
      scenario({ id: "z", checkId: "boundary" }),
      scenario({ id: "a", checkId: "boundary" }),
      scenario({ id: "m", checkId: "boundary" }),
    ];
    const filtered = filterScenarios(scenarios, ["boundary"], "node-cli-package");
    expect(filtered.map((s) => s.id)).toEqual(["z", "a", "m"]);
  });
});

describe("runAttackScenarios", () => {
  it("is safe when no scenarios are registered", async () => {
    const results = await runAttackScenarios({
      scenarios: [],
      selectedChecks: ["boundary", "secrets"],
      profile: "node-cli-package",
      toolRoot,
      target: fakeTarget(),
      config: DEFAULT_SECURITY_CONFIG,
    });
    expect(results).toHaveLength(2);
    expect(results.every((r) => r.status === "skipped")).toBe(true);
    expect(results.every((r) => r.status !== "passed")).toBe(true);
  });

  it("does not claim an unimplemented check passed", async () => {
    const results = await runAttackScenarios({
      scenarios: [],
      selectedChecks: ["subprocess"],
      profile: "node-cli-package",
      toolRoot,
      target: fakeTarget(),
      config: DEFAULT_SECURITY_CONFIG,
    });
    expect(results[0].status).not.toBe("passed");
    expect(results[0].skippedReason).toMatch(/no attack scenarios are registered/i);
  });

  it("converts a thrown scenario error into a structured 'blocked' result, not an uncaught exception", async () => {
    const throwingScenario = scenario({
      id: "throws",
      checkId: "boundary",
      run: async () => {
        throw new Error("scenario exploded");
      },
    });
    const results = await runAttackScenarios({
      scenarios: [throwingScenario],
      selectedChecks: ["boundary"],
      profile: "node-cli-package",
      toolRoot,
      target: fakeTarget(),
      config: DEFAULT_SECURITY_CONFIG,
    });
    expect(results).toHaveLength(1);
    expect(results[0].status).toBe("blocked");
    expect(results[0].errorSummary).toContain("scenario exploded");
  });

  it("honors skipCondition without invoking run()", async () => {
    let ran = false;
    const skippedScenario = scenario({
      id: "skips",
      checkId: "boundary",
      skipCondition: () => "environment does not support this scenario",
      run: async () => {
        ran = true;
        return { status: "passed", confidence: "low", evidence: [] };
      },
    });
    const results = await runAttackScenarios({
      scenarios: [skippedScenario],
      selectedChecks: ["boundary"],
      profile: "node-cli-package",
      toolRoot,
      target: fakeTarget(),
      config: DEFAULT_SECURITY_CONFIG,
    });
    expect(ran).toBe(false);
    expect(results[0].status).toBe("skipped");
    expect(results[0].skippedReason).toBe("environment does not support this scenario");
  });

  it("preserves deterministic result order: matched scenarios then unavailable placeholders", async () => {
    const results = await runAttackScenarios({
      scenarios: [scenario({ id: "matched", checkId: "boundary" })],
      selectedChecks: ["boundary", "secrets"],
      profile: "node-cli-package",
      toolRoot,
      target: fakeTarget(),
      config: DEFAULT_SECURITY_CONFIG,
    });
    expect(results.map((r) => r.scenarioId)).toEqual(["matched", "secrets-no-scenarios-registered"]);
  });
});
