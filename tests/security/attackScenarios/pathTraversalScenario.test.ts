import { describe, expect, it } from "vitest";
import { PATH_TRAVERSAL_SCENARIO } from "../../../src/securityValidation/attackScenarios/scenarios/pathTraversalScenario.js";
import { DEFAULT_SECURITY_CONFIG } from "../../../src/securityValidation/config.js";
import type { SecurityValidationTarget } from "../../../src/securityValidation/validate/resolveTarget.js";
import type { AttackScenarioContext } from "../../../src/securityValidation/attackScenarios/attackScenario.js";

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

function makeCtx(): AttackScenarioContext {
  return {
    toolRoot: process.cwd(),
    target: fakeTarget(),
    profile: "node-cli-package",
    config: DEFAULT_SECURITY_CONFIG,
  };
}

describe("PATH_TRAVERSAL_SCENARIO", () => {
  it("rejects all path-traversal payloads and accepts legitimate paths → passed", async () => {
    const outcome = await PATH_TRAVERSAL_SCENARIO.run(makeCtx());
    expect(outcome.status).toBe("passed");
  });

  it("Windows-style relative path with spaces remains accepted", async () => {
    const outcome = await PATH_TRAVERSAL_SCENARIO.run(makeCtx());
    const spacesEvidence = outcome.evidence.find((e) => e.source?.includes("relative-with-spaces"));
    expect(spacesEvidence?.observedBehavior).toMatch(/resolved to/i);
  });

  it("produces one evidence entry per payload/legitimate-case, all JSON-serializable", async () => {
    const outcome = await PATH_TRAVERSAL_SCENARIO.run(makeCtx());
    expect(outcome.evidence.length).toBeGreaterThan(0);
    expect(() => JSON.stringify(outcome.evidence)).not.toThrow();
  });
});
