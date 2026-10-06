import { describe, expect, it } from "vitest";
import { compareTokenSavings } from "../../../src/evaluation/compareTokenSavings.js";
import { calculateRetrievalQualityMetricsFromIdentityEvidence } from "../../../src/evaluation/retrievalQuality/metrics.js";
import {
  aggregateContextPackGenerationScope,
  analyzeContextPackGeneration,
  analyzeContextPackGenerationCase,
  calculateContextPackTokenSavings,
  type ContextPackGenerationCaseEvidenceV1,
  type ContextPackGenerationTreatmentEvidenceV1
} from "../../../src/experiments/plugins/contextPackGeneration/index.js";
import { makeEvaluationCase } from "./contextPackGenerationTestHelpers.js";

type Identity = { files: string[]; symbols: Array<{ name: string; file?: string }>; availability?: "available" | "partial" | "unavailable" };

function treatment(treatmentId: "raw-full-file" | "context-pack", identity: Identity | null, tokens: number | null, status: "completed" | "partial" | "failed" = "completed"): ContextPackGenerationTreatmentEvidenceV1 {
  return {
    treatmentId,
    status,
    availability: identity ? (identity.availability ?? "available") : null,
    availabilityReason: null,
    size: tokens === null ? null : { totalChars: tokens * 4, totalEstimatedTokens: tokens, tokenCountMethod: "estimated_chars_div_4" },
    identityEvidence: identity ? { availability: identity.availability ?? "available", files: identity.files, symbols: identity.symbols } : null,
    includedFiles: identity?.files ?? [],
    steps: [],
    sections: null,
    evidenceNotes: [],
    packArtifactPath: null,
    errors: []
  };
}

function caseEvidence(caseId: string, locality: ContextPackGenerationCaseEvidenceV1["taskLocality"], raw: ContextPackGenerationTreatmentEvidenceV1, pack: ContextPackGenerationTreatmentEvidenceV1): ContextPackGenerationCaseEvidenceV1 {
  return { caseId, caseName: caseId, benchmarkProject: "p", taskLocality: locality, treatments: [raw, pack] };
}

const perfect: Identity = { files: ["src/a.ts", "src/b.ts"], symbols: [{ name: "A", file: "src/a.ts" }, { name: "B", file: "src/b.ts" }] };
const half: Identity = { files: ["src/a.ts"], symbols: [{ name: "A", file: "src/a.ts" }] };

describe("per-case analysis reuses the frozen retrieval-quality science", () => {
  it("matches the existing calculator and balanced F1 exactly", () => {
    const evaluationCase = makeEvaluationCase({ id: "c1" });
    const evidence = caseEvidence("c1", "localized", treatment("raw-full-file", { files: ["src/a.ts", "src/b.ts", "src/c.ts"], symbols: perfect.symbols }, 1000), treatment("context-pack", half, 100));
    const analysis = analyzeContextPackGenerationCase(evaluationCase, evidence);
    const direct = calculateRetrievalQualityMetricsFromIdentityEvidence({
      evaluationCase,
      retrieval: { identityEvidence: { availability: "available", files: half.files, symbols: half.symbols }, totalEstimatedTokens: 100, tokenCountMethod: "estimated_chars_div_4" }
    });
    expect(analysis.treatments[1].quality).toEqual(direct);
    // Pack: file precision 1, recall 1/2 => balanced F1 = 2TP / (2TP + FP + FN) = 2 / 3.
    expect(analysis.treatments[1].fileF1.value).toBeCloseTo(2 / 3, 12);
    expect(analysis.treatments[1].fileF1).toMatchObject({ numerator: 2, denominator: 3 });
    expect(analysis.treatments[0].fileF1).toMatchObject({ numerator: 4, denominator: 5 });
    expect(analysis.treatments[1].quality?.fact.coverage).toMatchObject({ availability: "available", numerator: 1, denominator: 2 });
    expect(analysis.treatments[1].quality?.retrievedTokenCount).toBe(100);
  });

  it("measures pack size from the exact recorded pack size and keeps negative savings", () => {
    const evaluationCase = makeEvaluationCase({ id: "c1" });
    const analysis = analyzeContextPackGenerationCase(evaluationCase, caseEvidence("c1", "localized", treatment("raw-full-file", perfect, 1000), treatment("context-pack", perfect, 2000)));
    expect(analysis.comparison).toMatchObject({ estimatedTokenDelta: 1000, tokensSaved: -1000, percentSaved: -100 });
    expect(analysis.comparison.fileF1Delta).toBe(0);
    expect(analysis.comparison.symbolF1Delta).toBe(0);
    expect(analysis.comparison.factCoverageDelta).toBe(0);
  });

  it("uses the same token-savings arithmetic as the existing comparison", () => {
    const evaluationCase = makeEvaluationCase({ id: "c1" });
    const compared = compareTokenSavings([
      {
        evaluationCase,
        rawBaseline: { totalEstimatedTokens: 1000, totalChars: 4000, totalFiles: 3 } as never,
        myDevKit: { totalEstimatedTokens: 250, totalChars: 1000, filesRead: [], commands: [], skipped: false, warnings: [] } as never
      }
    ]).cases[0];
    expect(calculateContextPackTokenSavings(1000, 250)).toEqual({ tokensSaved: compared.tokensSaved, percentSaved: compared.percentSaved });
    expect(calculateContextPackTokenSavings(0, 5)).toEqual({ tokensSaved: -5, percentSaved: 0 });
  });

  it("never converts unavailable evidence into zero", () => {
    const evaluationCase = makeEvaluationCase({ id: "c1" });
    const analysis = analyzeContextPackGenerationCase(evaluationCase, caseEvidence("c1", "localized", treatment("raw-full-file", perfect, 1000), treatment("context-pack", null, null, "failed")));
    const [, pack] = analysis.treatments;
    expect(pack.quality).toBeNull();
    expect(pack.fileF1).toMatchObject({ availability: "unavailable", value: null });
    expect(pack.estimatedTokens).toBeNull();
    expect(analysis.comparison).toEqual({ fileF1Delta: null, symbolF1Delta: null, factCoverageDelta: null, estimatedTokenDelta: null, tokensSaved: null, percentSaved: null });
  });

  it("propagates partial evidence as unavailable metrics rather than zeros", () => {
    const evaluationCase = makeEvaluationCase({ id: "c1" });
    const analysis = analyzeContextPackGenerationCase(
      evaluationCase,
      caseEvidence("c1", "localized", treatment("raw-full-file", { ...perfect, availability: "partial" }, 1000, "partial"), treatment("context-pack", perfect, 100))
    );
    expect(analysis.treatments[0].fileF1.availability).toBe("unavailable");
    expect(analysis.comparison.fileF1Delta).toBeNull();
    expect(analysis.comparison.tokensSaved).toBe(900);
  });

  it("rejects a case whose treatments are not the two canonical ones in order", () => {
    const evaluationCase = makeEvaluationCase({ id: "c1" });
    const evidence = caseEvidence("c1", "localized", treatment("context-pack", perfect, 1), treatment("raw-full-file", perfect, 1));
    expect(() => analyzeContextPackGenerationCase(evaluationCase, evidence)).toThrow(/canonical/);
    expect(() => analyzeContextPackGenerationCase(makeEvaluationCase({ id: "other" }), caseEvidence("c1", null, treatment("raw-full-file", perfect, 1), treatment("context-pack", perfect, 1)))).toThrow(/mismatch/);
  });
});

describe("matched-complete-case scope aggregation", () => {
  const cases = [
    makeEvaluationCase({ id: "c1", locality: "localized" }),
    makeEvaluationCase({ id: "c2", locality: "cross-module" }),
    makeEvaluationCase({ id: "c3", locality: "cross-module" }),
    makeEvaluationCase({ id: "c4", locality: "broad-change" }),
    makeEvaluationCase({ id: "c5", locality: undefined })
  ];
  cases[4].taskLocality = undefined;
  const evidence = [
    caseEvidence("c1", "localized", treatment("raw-full-file", perfect, 1000), treatment("context-pack", perfect, 200)),
    caseEvidence("c2", "cross-module", treatment("raw-full-file", half, 1000), treatment("context-pack", perfect, 600)),
    // Raw unavailable: excluded from BOTH treatments.
    caseEvidence("c3", "cross-module", treatment("raw-full-file", null, null, "failed"), treatment("context-pack", perfect, 100)),
    caseEvidence("c4", "broad-change", treatment("raw-full-file", perfect, 500), treatment("context-pack", half, 700)),
    caseEvidence("c5", null, treatment("raw-full-file", perfect, 400), treatment("context-pack", perfect, 100))
  ];
  const analysis = analyzeContextPackGeneration(cases, evidence);

  it("aggregates exactly the four scopes in order", () => {
    expect(analysis.scopes.map((scope) => scope.scopeId)).toEqual(["overall", "localized", "cross-module", "broad-change"]);
    expect(analysis.cases.map((entry) => entry.caseId)).toEqual(["c1", "c2", "c3", "c4", "c5"]);
    expect(analysis.cases.every((entry) => entry.treatments.map((t) => t.treatmentId).join() === "raw-full-file,context-pack")).toBe(true);
  });

  it("excludes a case from both treatments when either lacks a required measure, in corpus order", () => {
    const overall = analysis.scopes[0];
    expect(overall.includedCaseIds).toEqual(["c1", "c2", "c4", "c5"]);
    expect(overall.excludedCaseIds).toEqual(["c3"]);
    expect([overall.caseCount, overall.includedCaseCount, overall.excludedCaseCount]).toEqual([5, 4, 1]);
    const cross = analysis.scopes[2];
    expect(cross.includedCaseIds).toEqual(["c2"]);
    expect(cross.excludedCaseIds).toEqual(["c3"]);
    // Pack at c3 was available but must not leak into its treatment mean.
    expect(cross.treatmentSummaries[1].objectives?.meanEstimatedTokenCount).toBe(600);
    expect(cross.treatmentSummaries[0].objectives?.meanEstimatedTokenCount).toBe(1000);
  });

  it("computes unweighted macro means over included cases", () => {
    const overall = analysis.scopes[0];
    const [raw, pack] = overall.treatmentSummaries;
    expect(raw.objectives?.meanEstimatedTokenCount).toBeCloseTo((1000 + 1000 + 500 + 400) / 4, 12);
    expect(pack.objectives?.meanEstimatedTokenCount).toBeCloseTo((200 + 600 + 700 + 100) / 4, 12);
    // c2 raw retrieves one of two expected files: F1 = 2 / (2 + 0 + 1).
    const rawFileF1 = [1, 2 / 3, 1, 1];
    expect(raw.objectives?.meanFileF1).toBeCloseTo(rawFileF1.reduce((a, b) => a + b) / 4, 12);
    expect(overall.pairedDeltas?.meanEstimatedTokenDelta).toBeCloseTo(pack.objectives!.meanEstimatedTokenCount - raw.objectives!.meanEstimatedTokenCount, 12);
    expect(overall.tokenSavings?.meanTokensSaved).toBeCloseTo(raw.objectives!.meanEstimatedTokenCount - pack.objectives!.meanEstimatedTokenCount, 12);
    expect(overall.tokenSavings?.percentSavedOfMeans).toBeCloseTo(((raw.objectives!.meanEstimatedTokenCount - pack.objectives!.meanEstimatedTokenCount) / raw.objectives!.meanEstimatedTokenCount) * 100, 12);
  });

  it("scopes by task locality and puts a null locality only in overall", () => {
    expect(analysis.scopes[1].includedCaseIds).toEqual(["c1"]);
    expect(analysis.scopes[3].includedCaseIds).toEqual(["c4"]);
    for (const scope of analysis.scopes.slice(1)) expect(scope.includedCaseIds).not.toContain("c5");
    expect(analysis.scopes[0].caseCount).toBe(5);
  });

  it("reports null objectives, never zero, when no case is comparable", () => {
    const none = aggregateContextPackGenerationScope("localized", analysis.cases.filter((entry) => entry.caseId === "c3"));
    expect(none.includedCaseCount).toBe(0);
    expect(none.treatmentSummaries.every((summary) => summary.objectives === null)).toBe(true);
    expect(none.pairedDeltas).toBeNull();
    expect(none.tokenSavings).toBeNull();
    expect(none.treatmentSummaries[0].failedCaseCount).toBe(0);
  });

  it("counts execution statuses per treatment", () => {
    const overall = analysis.scopes[0];
    expect(overall.treatmentSummaries[0]).toMatchObject({ completedCaseCount: 4, failedCaseCount: 1, partialCaseCount: 0 });
  });

  it("exposes no winner, ranking, composite score or Pareto field anywhere", () => {
    const forbidden = /best|winner|rank|score|pareto|front|composite|interpretation/i;
    const keys: string[] = [];
    const walk = (value: unknown): void => {
      if (Array.isArray(value)) value.forEach(walk);
      else if (value && typeof value === "object") for (const [key, child] of Object.entries(value)) (keys.push(key), walk(child));
    };
    walk(analysis);
    expect(keys.filter((key) => forbidden.test(key))).toEqual([]);
  });
});
