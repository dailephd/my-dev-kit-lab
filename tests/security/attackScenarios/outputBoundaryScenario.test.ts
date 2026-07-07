import path from "node:path";
import { describe, expect, it } from "vitest";
import { OUTPUT_BOUNDARY_SCENARIO } from "../../../src/securityValidation/attackScenarios/scenarios/outputBoundaryScenario.js";
import { DEFAULT_SECURITY_CONFIG } from "../../../src/securityValidation/config.js";
import type { SecurityValidationTarget } from "../../../src/securityValidation/validate/resolveTarget.js";
import type { AttackScenarioContext } from "../../../src/securityValidation/attackScenarios/attackScenario.js";

function fakeTarget(overrides: Partial<SecurityValidationTarget>): SecurityValidationTarget {
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
    ...overrides,
  };
}

describe("OUTPUT_BOUNDARY_SCENARIO", () => {
  it("accepts the default output path for self-validation", async () => {
    const target = fakeTarget({ isSelf: true });
    const ctx: AttackScenarioContext = {
      toolRoot: process.cwd(),
      target,
      profile: "node-cli-package",
      config: { ...DEFAULT_SECURITY_CONFIG, reportDir: path.join(process.cwd(), "reports", "security") },
    };
    const outcome = await OUTPUT_BOUNDARY_SCENARIO.run(ctx);
    expect(outcome.status).toBe("passed");
  });

  it("accepts a safe explicit --out for an external target (outside the target root)", async () => {
    const target = fakeTarget({ isSelf: false, targetRoot: path.join(process.cwd(), "..", "some-other-project") });
    const ctx: AttackScenarioContext = {
      toolRoot: process.cwd(),
      target,
      profile: "node-cli-package",
      config: { ...DEFAULT_SECURITY_CONFIG, reportDir: path.join(process.cwd(), "reports", "security") },
    };
    const outcome = await OUTPUT_BOUNDARY_SCENARIO.run(ctx);
    expect(outcome.status).toBe("passed");
  });

  it("reports the default output directory as unsafe when it resolves inside an external target", async () => {
    const externalTargetRoot = path.join(process.cwd(), "some-external-target");
    const target = fakeTarget({ isSelf: false, targetRoot: externalTargetRoot });
    const ctx: AttackScenarioContext = {
      toolRoot: process.cwd(),
      target,
      profile: "node-cli-package",
      // Simulates a misconfigured default that resolves inside the external target.
      config: { ...DEFAULT_SECURITY_CONFIG, reportDir: path.join(externalTargetRoot, "reports", "security") },
    };
    const outcome = await OUTPUT_BOUNDARY_SCENARIO.run(ctx);
    expect(outcome.status).toBe("failed");
  });

  it("classifies output-boundary payload paths deterministically without writing any files", async () => {
    const target = fakeTarget({ isSelf: true });
    const ctx: AttackScenarioContext = {
      toolRoot: process.cwd(),
      target,
      profile: "node-cli-package",
      config: { ...DEFAULT_SECURITY_CONFIG, reportDir: path.join(process.cwd(), "reports", "security") },
    };
    const first = await OUTPUT_BOUNDARY_SCENARIO.run(ctx);
    const second = await OUTPUT_BOUNDARY_SCENARIO.run(ctx);
    const previewsA = first.evidence.map((e) => e.redactedPreview);
    const previewsB = second.evidence.map((e) => e.redactedPreview);
    expect(previewsA).toEqual(previewsB);
  });
});
