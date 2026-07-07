import { describe, expect, it } from "vitest";
import { CONFIG_INJECTION_SCENARIO } from "../../../src/securityValidation/attackScenarios/scenarios/configInjectionScenario.js";
import { DEFAULT_SECURITY_CONFIG } from "../../../src/securityValidation/config.js";
import type { SecurityValidationTarget } from "../../../src/securityValidation/validate/resolveTarget.js";
import type { AttackScenarioContext } from "../../../src/securityValidation/attackScenarios/attackScenario.js";
import { normalizeSecurityValidateConfig } from "../../../src/securityValidation/validate/cliOptions.js";

function makeCtx(): AttackScenarioContext {
  const target: SecurityValidationTarget = {
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
  return { toolRoot: process.cwd(), target, profile: "node-cli-package", config: DEFAULT_SECURITY_CONFIG };
}

describe("CONFIG_INJECTION_SCENARIO", () => {
  it("malformed --checks/--profile/--format/--fail-on values fail cleanly (no partial config)", () => {
    expect(() => normalizeSecurityValidateConfig({ checks: "{not valid json" }, process.cwd())).toThrow();
    expect(() => normalizeSecurityValidateConfig({ profile: "{not valid json" }, process.cwd())).toThrow();
    expect(() => normalizeSecurityValidateConfig({ format: "{not valid json" }, process.cwd())).toThrow();
    expect(() => normalizeSecurityValidateConfig({ failOn: "{not valid json" }, process.cwd())).toThrow();
  });

  it("scenario confirms all malformed-config x flag combinations are rejected → passed", async () => {
    const outcome = await CONFIG_INJECTION_SCENARIO.run(makeCtx());
    expect(outcome.status).toBe("passed");
  });

  it("injection-like report-poisoning payloads do not corrupt JSON output", async () => {
    const outcome = await CONFIG_INJECTION_SCENARIO.run(makeCtx());
    const outputEvidence = outcome.evidence.find((e) => e.kind === "output");
    expect(outputEvidence?.observedBehavior).toContain("jsonCorrupted=false");
    expect(outputEvidence?.observedBehavior).toContain("textCrashed=false");
  });

  it("produces JSON-serializable evidence", async () => {
    const outcome = await CONFIG_INJECTION_SCENARIO.run(makeCtx());
    expect(() => JSON.stringify(outcome.evidence)).not.toThrow();
  });
});
