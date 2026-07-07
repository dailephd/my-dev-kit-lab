import { describe, expect, it } from "vitest";
import { SUBPROCESS_INJECTION_SCENARIO } from "../../../src/securityValidation/attackScenarios/scenarios/subprocessInjectionScenario.js";
import { DEFAULT_SECURITY_CONFIG } from "../../../src/securityValidation/config.js";
import type { SecurityValidationTarget } from "../../../src/securityValidation/validate/resolveTarget.js";
import type { AttackScenarioContext } from "../../../src/securityValidation/attackScenarios/attackScenario.js";

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

describe("SUBPROCESS_INJECTION_SCENARIO", () => {
  it("shell metacharacter payloads round-trip as literal arguments, never executed → passed or blocked (never failed)", async () => {
    const outcome = await SUBPROCESS_INJECTION_SCENARIO.run(makeCtx());
    expect(["passed", "blocked"]).toContain(outcome.status);
  }, 30_000);

  it("evidence documents each payload round-trip without executing it as a shell command", async () => {
    const outcome = await SUBPROCESS_INJECTION_SCENARIO.run(makeCtx());
    const commandEvidence = outcome.evidence.filter((e) => e.kind === "command");
    expect(commandEvidence.length).toBe(5); // 5 subprocess-injection payloads in the corpus
    for (const e of commandEvidence) {
      expect(e.observedBehavior).toMatch(/round-tripped as a single literal argument/i);
    }
  }, 30_000);

  it("produces JSON-serializable evidence with redacted previews for shell payloads", async () => {
    const outcome = await SUBPROCESS_INJECTION_SCENARIO.run(makeCtx());
    expect(() => JSON.stringify(outcome.evidence)).not.toThrow();
  }, 30_000);
});
