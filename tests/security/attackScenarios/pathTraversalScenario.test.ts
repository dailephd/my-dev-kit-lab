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

  // v0.2.2 pre-release readiness: cross-platform CI caught that the
  // "windows-parent" (backslash-style) payload only escapes on win32 — "\"
  // is a path separator there, but a literal filename character on POSIX
  // (Linux/macOS), so resolveWithinRoot() legitimately resolves it inside
  // root on non-Windows platforms. This test self-verifies the
  // platform-conditional exclusion behaves correctly on whatever OS actually
  // runs it, rather than asserting one hardcoded expectation for all OSes.
  it("windows-parent payload rejection is platform-consistent", async () => {
    const outcome = await PATH_TRAVERSAL_SCENARIO.run(makeCtx());
    const windowsParentEvidence = outcome.evidence.find((e) => e.source?.includes("windows-parent"));
    expect(windowsParentEvidence).toBeDefined();
    if (process.platform === "win32") {
      expect(windowsParentEvidence?.observedBehavior).toMatch(/rejected/i);
    } else {
      expect(windowsParentEvidence?.observedBehavior).toMatch(/resolved to/i);
    }
    // Regardless of platform, the scenario as a whole must still pass —
    // the platform-conditional exclusion set keeps this payload from being
    // misclassified as an unrejected escape on POSIX.
    expect(outcome.status).toBe("passed");
  });
});
