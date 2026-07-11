import { describe, expect, it } from "vitest";
import { makeCandidateEvidence } from "../../../src/mobile/android/advancedSecurity/candidateEvidence.js";

const baseInput = {
  ruleId: "android-secret-hardcoded-candidate" as const,
  category: "android-secret-candidates" as const,
  confidence: "medium" as const,
  location: { path: "src/main/kotlin/Sample.kt", line: 12 },
  summary: "Hardcoded token-shaped literal",
  resolutionState: "resolved" as const,
};

// ANDROID-V041-B1-03 — candidate evidence normalization: equivalent input
// normalizes to the same deterministic structure.
describe("makeCandidateEvidence", () => {
  it("produces the same id/fingerprint/preview for equivalent input", () => {
    const first = makeCandidateEvidence({ ...baseInput, rawValue: "FAKE-TOKEN-VALUE-0000000000" });
    const second = makeCandidateEvidence({ ...baseInput, rawValue: "FAKE-TOKEN-VALUE-0000000000" });
    expect(first).toEqual(second);
  });

  it("produces a different id for different locations", () => {
    const first = makeCandidateEvidence({ ...baseInput, rawValue: "FAKE-TOKEN-VALUE-0000000000" });
    const second = makeCandidateEvidence({
      ...baseInput,
      location: { path: "src/main/kotlin/Other.kt", line: 3 },
      rawValue: "FAKE-TOKEN-VALUE-0000000000",
    });
    expect(first.id).not.toBe(second.id);
  });

  it("never stores the raw value on the returned object", () => {
    const rawValue = "FAKE-TOKEN-VALUE-0000000000";
    const evidence = makeCandidateEvidence({ ...baseInput, rawValue });
    expect(JSON.stringify(evidence)).not.toContain(rawValue);
  });

  it("defaults staticAnalysisLimitations to an empty array when omitted", () => {
    const evidence = makeCandidateEvidence({ ...baseInput, rawValue: "x" });
    expect(evidence.staticAnalysisLimitations).toEqual([]);
  });

  it("does not populate relatedFindingIds until a later batch links one", () => {
    const evidence = makeCandidateEvidence({ ...baseInput, rawValue: "x" });
    expect(evidence.relatedFindingIds).toBeUndefined();
  });

  it("carries resolutionState through unchanged", () => {
    const evidence = makeCandidateEvidence({ ...baseInput, rawValue: "x", resolutionState: "missing" });
    expect(evidence.resolutionState).toBe("missing");
  });
});
