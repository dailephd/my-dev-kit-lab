import { describe, expect, it } from "vitest";
import { makeCandidateEvidence } from "../../../src/mobile/android/advancedSecurity/candidateEvidence.js";
import { sortCandidateEvidence } from "../../../src/mobile/android/advancedSecurity/ordering.js";

// ANDROID-V041-B1-17 — deterministic candidate ordering, independent of
// input/insertion order.
describe("sortCandidateEvidence", () => {
  const b = makeCandidateEvidence({
    ruleId: "android-webview-javascript-enabled",
    category: "android-webview",
    confidence: "low",
    location: { path: "b.kt", line: 2 },
    summary: "b",
    resolutionState: "resolved",
    rawValue: "x",
  });
  const a = makeCandidateEvidence({
    ruleId: "android-secret-hardcoded-candidate",
    category: "android-secret-candidates",
    confidence: "medium",
    location: { path: "a.kt", line: 1 },
    summary: "a",
    resolutionState: "resolved",
    rawValue: "y",
  });

  it("orders by category first regardless of input order", () => {
    expect(sortCandidateEvidence([b, a]).map((e) => e.category)).toEqual(["android-secret-candidates", "android-webview"]);
    expect(sortCandidateEvidence([a, b]).map((e) => e.category)).toEqual(["android-secret-candidates", "android-webview"]);
  });

  it("does not mutate the input array", () => {
    const input = [b, a];
    sortCandidateEvidence(input);
    expect(input).toEqual([b, a]);
  });

  it("is stable across repeated calls with the same input", () => {
    expect(sortCandidateEvidence([b, a])).toEqual(sortCandidateEvidence([b, a]));
  });

  it("falls back to fingerprint as a final tiebreaker for identical category/rule/module/location", () => {
    const sameLocationDifferentValue = makeCandidateEvidence({
      ruleId: "android-secret-hardcoded-candidate",
      category: "android-secret-candidates",
      confidence: "medium",
      location: { path: "a.kt", line: 1 },
      summary: "a",
      resolutionState: "resolved",
      rawValue: "different-value",
    });
    const sorted = sortCandidateEvidence([sameLocationDifferentValue, a]);
    expect(sorted[0].fingerprint <= sorted[1].fingerprint).toBe(true);
  });
});
