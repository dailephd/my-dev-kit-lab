import { describe, expect, it } from "vitest";
import { toSecurityCheckResult, type AttackResult } from "../../../src/securityValidation/attackScenarios/attackResult.js";
import { makeEvidence } from "../../../src/securityValidation/attackScenarios/exploitEvidence.js";

function makeResult(overrides: Partial<AttackResult> = {}): AttackResult {
  return {
    scenarioId: "test-scenario",
    scenarioTitle: "Test scenario",
    checkId: "boundary",
    profileId: "node-cli-package",
    status: "skipped",
    severity: "skipped",
    confidence: "low",
    evidence: [],
    category: "artifact-safety",
    skippedReason: "no scenarios registered",
    ...overrides,
  };
}

describe("AttackResult", () => {
  it("serializes to JSON without throwing", () => {
    const result = makeResult({
      evidence: [makeEvidence({ kind: "observation", source: "test", confidence: "low", rawPreview: "hello" })],
    });
    expect(() => JSON.stringify(result)).not.toThrow();
  });

  it("does not report unimplemented scenarios as passed", () => {
    const result = makeResult();
    expect(result.status).not.toBe("passed");
  });
});

describe("toSecurityCheckResult", () => {
  it("maps a skipped attack result to a skipped SecurityCheckResult", () => {
    const check = toSecurityCheckResult(makeResult());
    expect(check.status).toBe("skipped");
    expect(check.skippedReason).toBe("no scenarios registered");
    expect(check.findings).toHaveLength(0);
  });

  it("maps a blocked attack result to a failed SecurityCheckResult with a finding", () => {
    const check = toSecurityCheckResult(
      makeResult({ status: "blocked", severity: "skipped", errorSummary: "boom" })
    );
    expect(check.status).toBe("failed");
    expect(check.severity).toBe("major");
    expect(check.findings).toHaveLength(1);
    expect(check.findings[0].description).toContain("boom");
  });

  it("maps a failed attack result to a failed SecurityCheckResult with a finding", () => {
    const check = toSecurityCheckResult(makeResult({ status: "failed", severity: "major" }));
    expect(check.status).toBe("failed");
    expect(check.findings).toHaveLength(1);
  });

  it("maps a passed attack result with no findings", () => {
    const check = toSecurityCheckResult(makeResult({ status: "passed", severity: "informational" }));
    expect(check.status).toBe("passed");
    expect(check.findings).toHaveLength(0);
  });

  it("finding evidence uses redacted previews only, never raw evidence objects", () => {
    const check = toSecurityCheckResult(
      makeResult({
        status: "failed",
        severity: "major",
        evidence: [
          makeEvidence({ kind: "secret-leak", source: "test", confidence: "high", rawPreview: "sk-abcdefghijklmnopqrstuvwx1234567890ABCD" }),
        ],
      })
    );
    expect(check.findings[0].evidence).not.toContain("sk-abcdefghijklmnopqrstuvwx1234567890ABCD");
  });
});
