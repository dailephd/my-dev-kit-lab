import { describe, expect, it } from "vitest";
import { classifyStaleRisk } from "../../../src/experiments/plugins/incrementalChangeStaleness/comparison.js";
import {
  classifyPartialRefreshAgainstFull,
  compareCandidateCorrectness,
  compareCandidateRequiredFileEvidence,
  type CandidateCorrectnessRelationV2,
  type CandidateRequiredFileRelationV2
} from "../../../src/experiments/plugins/incrementalChangeStaleness/comparisonV2.js";

describe("neutral candidate-vs-reference relations", () => {
  it("compares correctness with candidate terminology and unknown when either side is unavailable", () => {
    expect(compareCandidateCorrectness({ available: true, score: 0.5 }, { available: true, score: 1 })).toBe("candidate-worse");
    expect(compareCandidateCorrectness({ available: true, score: 1 }, { available: true, score: 1 })).toBe("same");
    expect(compareCandidateCorrectness({ available: true, score: 1 }, { available: true, score: 0.5 })).toBe("candidate-better");
    expect(compareCandidateCorrectness({ available: false }, { available: true, score: 1 })).toBe("unknown");
    expect(compareCandidateCorrectness({ available: true, score: 1 }, { available: false })).toBe("unknown");
  });

  it("compares required-file evidence with candidate terminology and unknown when either side is unknown", () => {
    expect(compareCandidateRequiredFileEvidence({ status: "missing" }, { status: "present" })).toBe("candidate-worse");
    expect(compareCandidateRequiredFileEvidence({ status: "present" }, { status: "missing" })).toBe("candidate-better");
    expect(compareCandidateRequiredFileEvidence({ status: "present" }, { status: "present" })).toBe("same");
    expect(compareCandidateRequiredFileEvidence({ status: "missing" }, { status: "missing" })).toBe("same");
    expect(compareCandidateRequiredFileEvidence({ status: "unknown" }, { status: "present" })).toBe("unknown");
    expect(compareCandidateRequiredFileEvidence({ status: "present" }, { status: "unknown" })).toBe("unknown");
  });
});

describe("partial-refresh reference classification precedence", () => {
  const relations: CandidateCorrectnessRelationV2[] = ["candidate-worse", "same", "candidate-better", "unknown"];

  it("rule 0: a full fallback is not comparable regardless of the raw relations", () => {
    for (const correctnessRelation of relations) {
      for (const requiredFileEvidenceRelation of relations as CandidateRequiredFileRelationV2[]) {
        expect(classifyPartialRefreshAgainstFull({ realization: "FALLBACK_FULL", correctnessRelation, requiredFileEvidenceRelation })).toEqual({
          classification: "not-comparable-as-partial-refresh",
          reasonCodes: ["candidate-fell-back-to-full"]
        });
      }
    }
  });

  it("rule 1: either dimension worse is one observed regression with each observed dimension as a reason", () => {
    const applied = "APPLIED_PARTIAL" as const;
    expect(classifyPartialRefreshAgainstFull({ realization: applied, correctnessRelation: "candidate-worse", requiredFileEvidenceRelation: "same" })).toEqual({
      classification: "observed-regression-relative-to-full",
      reasonCodes: ["candidate-correctness-lower"]
    });
    expect(classifyPartialRefreshAgainstFull({ realization: applied, correctnessRelation: "same", requiredFileEvidenceRelation: "candidate-worse" })).toEqual({
      classification: "observed-regression-relative-to-full",
      reasonCodes: ["candidate-missing-required-file"]
    });
    expect(classifyPartialRefreshAgainstFull({ realization: applied, correctnessRelation: "candidate-worse", requiredFileEvidenceRelation: "candidate-worse" })).toEqual({
      classification: "observed-regression-relative-to-full",
      reasonCodes: ["candidate-correctness-lower", "candidate-missing-required-file"]
    });
    // A regression wins even when the other dimension is unknown.
    expect(classifyPartialRefreshAgainstFull({ realization: applied, correctnessRelation: "unknown", requiredFileEvidenceRelation: "candidate-worse" }).classification).toBe(
      "observed-regression-relative-to-full"
    );
  });

  it("rule 2: no regression but an unknown dimension is inconclusive naming the unavailable dimensions", () => {
    const applied = "APPLIED_PARTIAL" as const;
    expect(classifyPartialRefreshAgainstFull({ realization: applied, correctnessRelation: "unknown", requiredFileEvidenceRelation: "same" })).toEqual({
      classification: "inconclusive",
      reasonCodes: ["correctness-unavailable"]
    });
    expect(classifyPartialRefreshAgainstFull({ realization: applied, correctnessRelation: "candidate-better", requiredFileEvidenceRelation: "unknown" })).toEqual({
      classification: "inconclusive",
      reasonCodes: ["required-file-evidence-unavailable"]
    });
    expect(classifyPartialRefreshAgainstFull({ realization: applied, correctnessRelation: "unknown", requiredFileEvidenceRelation: "unknown" }).reasonCodes).toEqual([
      "correctness-unavailable",
      "required-file-evidence-unavailable"
    ]);
  });

  it("rule 3: same/same and candidate-better are no observed regression, never a winner claim", () => {
    const applied = "APPLIED_PARTIAL" as const;
    for (const [correctnessRelation, requiredFileEvidenceRelation] of [
      ["same", "same"],
      ["candidate-better", "same"],
      ["same", "candidate-better"],
      ["candidate-better", "candidate-better"]
    ] as const) {
      expect(classifyPartialRefreshAgainstFull({ realization: applied, correctnessRelation, requiredFileEvidenceRelation })).toEqual({
        classification: "no-observed-regression-relative-to-full",
        reasonCodes: ["no-reference-regression-observed"]
      });
    }
  });

  it("uses neutral reason names and leaves the historical stale-risk classification untouched", () => {
    const all = relations.flatMap((c) => (relations as CandidateRequiredFileRelationV2[]).map((r) => classifyPartialRefreshAgainstFull({ realization: "APPLIED_PARTIAL", correctnessRelation: c, requiredFileEvidenceRelation: r })));
    for (const result of all) for (const code of result.reasonCodes) expect(code.startsWith("stale-")).toBe(false);
    expect(classifyStaleRisk("stale-worse", "same")).toEqual({ staleRiskClassification: "observed-stale-regression", reasonCodes: ["stale-correctness-lower"] });
    expect(classifyStaleRisk("same", "same")).toEqual({ staleRiskClassification: "no-observed-stale-regression", reasonCodes: ["no-stale-specific-difference-observed"] });
    expect(classifyStaleRisk("unknown", "same").staleRiskClassification).toBe("inconclusive");
  });
});
