import { describe, expect, it } from "vitest";
import { boundExcerpt, makeAuditEvidence, type AuditEvidence, type AuditIssue } from "../../src/audits/core/auditIssue.js";

function makeIssue(overrides: Partial<AuditIssue> = {}): AuditIssue {
  return {
    id: "test-issue-1",
    auditType: "code-rot",
    detectorId: "test-detector",
    title: "Test issue",
    description: "Test description",
    severity: "medium",
    confidence: "medium",
    falsePositiveRisk: "low",
    category: "test-category",
    evidence: [],
    affectedFiles: [],
    recommendedAction: "Do the thing",
    suggestedFixStrategy: "Fix it this way",
    validationCommands: ["npm run test"],
    releaseBlocking: false,
    implementationBlocking: false,
    autoFixEligible: false,
    ...overrides,
  };
}

describe("AuditIssue schema", () => {
  it("serializes to JSON without throwing", () => {
    const issue = makeIssue();
    expect(() => JSON.stringify(issue)).not.toThrow();
  });

  it("has severity, confidence, and falsePositiveRisk", () => {
    const issue = makeIssue();
    expect(issue.severity).toBeDefined();
    expect(issue.confidence).toBeDefined();
    expect(issue.falsePositiveRisk).toBeDefined();
  });

  it("has recommendedAction, suggestedFixStrategy, and validationCommands", () => {
    const issue = makeIssue();
    expect(typeof issue.recommendedAction).toBe("string");
    expect(typeof issue.suggestedFixStrategy).toBe("string");
    expect(Array.isArray(issue.validationCommands)).toBe(true);
  });

  it("autoFixEligible is metadata only — setting it true does not trigger any behavior", () => {
    const issue = makeIssue({ autoFixEligible: true });
    // Batch 1 implements no auto-fix code path at all; this simply confirms
    // the field round-trips as plain data.
    expect(issue.autoFixEligible).toBe(true);
    const serialized = JSON.parse(JSON.stringify(issue)) as AuditIssue;
    expect(serialized.autoFixEligible).toBe(true);
  });
});

describe("AuditEvidence schema", () => {
  function makeEvidence(overrides: Partial<AuditEvidence> = {}): AuditEvidence {
    return {
      kind: "file",
      message: "Test evidence",
      source: "test-detector",
      confidence: "medium",
      ...overrides,
    };
  }

  it("serializes to JSON without throwing", () => {
    const evidence = makeEvidence();
    expect(() => JSON.stringify(evidence)).not.toThrow();
  });

  it("an issue's evidence array is JSON-serializable", () => {
    const issue = makeIssue({ evidence: [makeEvidence(), makeEvidence({ kind: "command" })] });
    expect(() => JSON.stringify(issue)).not.toThrow();
  });

  it("boundExcerpt truncates long excerpts to a bounded preview", () => {
    const long = "x".repeat(1000);
    const bounded = boundExcerpt(long);
    expect(bounded.length).toBeLessThan(long.length);
    expect(bounded).toContain("truncated");
    expect(bounded).toContain("1000 chars total");
  });

  it("boundExcerpt leaves short excerpts unchanged", () => {
    expect(boundExcerpt("short")).toBe("short");
  });

  it("makeAuditEvidence bounds the excerpt field when present", () => {
    const evidence = makeAuditEvidence(makeEvidence({ excerpt: "y".repeat(1000) }));
    expect(evidence.excerpt!.length).toBeLessThan(1000);
  });

  it("makeAuditEvidence leaves evidence without an excerpt unchanged", () => {
    const evidence = makeAuditEvidence(makeEvidence());
    expect(evidence.excerpt).toBeUndefined();
  });
});
