import { describe, expect, it } from "vitest";
import {
  aggregateRetrievalPrecisionRecall,
  toRetrievalPrecisionRecallOutcomeMetrics,
  toRetrievalPrecisionRecallRunMetrics
} from "../../../src/experiments/plugins/retrievalPrecisionRecall/index.js";
import { caseEvidenceFor, evidenceOf, failedCaseEvidence, makeEvaluationCase } from "./retrievalPrecisionRecallTestHelpers.js";

// expected {a}: retrieved {a} -> precision 1; retrieved {a,x,y,z} -> precision 1/4; retrieved {x} -> precision 0.
const caseA = makeEvaluationCase({ id: "ca", project: "p1", files: ["src/a.ts"], symbols: ["A"] });
const caseB = makeEvaluationCase({ id: "cb", project: "p1", files: ["src/a.ts"], symbols: ["A"] });
const caseC = makeEvaluationCase({ id: "cc", project: "p2", files: ["src/a.ts"], symbols: ["A"] });

describe("aggregateRetrievalPrecisionRecall", () => {
  it("TST-B3-008 macro-averages available per-case values instead of micro-averaging by denominator", () => {
    const aggregate = aggregateRetrievalPrecisionRecall([
      caseEvidenceFor(caseA, evidenceOf(["src/a.ts"])),
      caseEvidenceFor(caseB, evidenceOf(["src/a.ts", "src/x.ts", "src/y.ts", "src/z.ts"]))
    ]);
    // macro = (1 + 1/4) / 2; a micro average over denominators would be 2/5.
    expect(aggregate.ratios.filePrecision).toMatchObject({ availableCount: 2, meanValue: 0.625 });
    expect(aggregate.ratios.fileRecall.meanValue).toBe(1);
    expect(aggregate.ratios.irrelevantContextRatio.meanValue).toBe(0.375);
  });

  it("TST-B3-009 counts unavailable and not-applicable cases separately and excludes them from the mean", () => {
    const aggregate = aggregateRetrievalPrecisionRecall([
      caseEvidenceFor(caseA, evidenceOf(["src/a.ts"])), // precision 1 (available)
      caseEvidenceFor(caseB, evidenceOf([])), // precision not-applicable (nothing retrieved)
      caseEvidenceFor(caseC, evidenceOf(["src/a.ts"], [], "partial")), // unavailable
      failedCaseEvidence(makeEvaluationCase({ id: "cf", project: "p2" })) // no measurement: unavailable, never zero
    ]);
    expect(aggregate.ratios.filePrecision).toEqual({ availableCount: 1, unavailableCount: 2, notApplicableCount: 1, meanValue: 1 });
    expect(aggregate.ratios.irrelevantContextRatio).toEqual({ availableCount: 1, unavailableCount: 2, notApplicableCount: 1, meanValue: 0 });
    expect(aggregate.ratios.fileRecall).toEqual({ availableCount: 2, unavailableCount: 2, notApplicableCount: 0, meanValue: 0.5 });
  });

  it("returns a null mean, never zero, when nothing is available", () => {
    const aggregate = aggregateRetrievalPrecisionRecall([failedCaseEvidence(caseA), caseEvidenceFor(caseB, evidenceOf([], [], "unavailable"))]);
    for (const summary of Object.values(aggregate.ratios)) {
      expect(summary).toMatchObject({ availableCount: 0, unavailableCount: 2, meanValue: null });
    }
    expect(aggregate.tokens.availableCount).toBe(1);
    expect(aggregateRetrievalPrecisionRecall([]).ratios.filePrecision).toEqual({ availableCount: 0, unavailableCount: 0, notApplicableCount: 0, meanValue: null });
  });

  it("TST-B3-010 lets an available zero participate in the mean", () => {
    const aggregate = aggregateRetrievalPrecisionRecall([
      caseEvidenceFor(caseA, evidenceOf(["src/a.ts"])),
      caseEvidenceFor(caseB, evidenceOf(["src/x.ts"]))
    ]);
    expect(aggregate.ratios.filePrecision).toMatchObject({ availableCount: 2, meanValue: 0.5 });
    expect(aggregate.ratios.fileRecall).toMatchObject({ availableCount: 2, meanValue: 0.5 });
  });

  it("TST-B3-011 aggregates tokens, keeping a measured zero and never substituting zero for no evidence", () => {
    const aggregate = aggregateRetrievalPrecisionRecall([
      caseEvidenceFor(caseA, evidenceOf(["src/a.ts"]), 0),
      caseEvidenceFor(caseB, evidenceOf(["src/a.ts"]), 300),
      caseEvidenceFor(caseC, evidenceOf(["src/a.ts"]), 100),
      failedCaseEvidence(makeEvaluationCase({ id: "cf" }))
    ]);
    expect(aggregate.tokens).toEqual({ availableCount: 3, unavailableCount: 1, totalTokens: 400, meanTokens: 400 / 3, minTokens: 0, maxTokens: 300 });
    const none = aggregateRetrievalPrecisionRecall([failedCaseEvidence(caseA)]);
    expect(none.tokens).toEqual({ availableCount: 0, unavailableCount: 1, totalTokens: null, meanTokens: null, minTokens: null, maxTokens: null });
    const zeroOnly = aggregateRetrievalPrecisionRecall([caseEvidenceFor(caseA, evidenceOf([]), 0)]);
    expect(zeroOnly.tokens).toEqual({ availableCount: 1, unavailableCount: 0, totalTokens: 0, meanTokens: 0, minTokens: 0, maxTokens: 0 });
  });

  it("TST-B3-012 sums per-case occurrences without deduplicating identical paths across cases or projects", () => {
    const aggregate = aggregateRetrievalPrecisionRecall([
      // project p1: missed src/b.ts, irrelevant src/x.ts
      caseEvidenceFor(makeEvaluationCase({ id: "o1", project: "p1", files: ["src/a.ts", "src/b.ts"], symbols: ["A", "B"] }), evidenceOf(["src/a.ts", "src/x.ts"], [{ name: "A", file: "src/a.ts" }, { name: "Q" }])),
      // project p2: the same relative paths again, a distinct scientific identity
      caseEvidenceFor(makeEvaluationCase({ id: "o2", project: "p2", files: ["src/a.ts", "src/b.ts"], symbols: ["A", "B"] }), evidenceOf(["src/a.ts", "src/x.ts"], [{ name: "A", file: "src/a.ts" }, { name: "Q" }])),
      failedCaseEvidence(makeEvaluationCase({ id: "o3", project: "p2" }))
    ]);
    expect(aggregate.occurrences).toMatchObject({
      totalMissedFileOccurrences: 2,
      totalIrrelevantRetrievedFileOccurrences: 2,
      totalMissedSymbolOccurrences: 2,
      totalIrrelevantRetrievedSymbolOccurrences: 2,
      // o1 and o2 each leave one fact uncovered (the fact needing src/b.ts).
      totalUncoveredFactOccurrences: 2,
      fileOccurrenceEvidenceCaseCount: 2,
      symbolOccurrenceEvidenceCaseCount: 2,
      factOccurrenceEvidenceCaseCount: 2
    });
  });

  it("summarizes run counts and evidence availability", () => {
    const aggregate = aggregateRetrievalPrecisionRecall([
      caseEvidenceFor(caseA, evidenceOf(["src/a.ts"])),
      caseEvidenceFor(caseB, evidenceOf(["src/a.ts"], [], "partial")),
      caseEvidenceFor(caseC, evidenceOf([], [], "unavailable")),
      failedCaseEvidence(makeEvaluationCase({ id: "cf", project: "p3" }))
    ]);
    expect(aggregate.runSummary).toEqual({
      projectCount: 3,
      caseCount: 4,
      completedCaseCount: 1,
      partialCaseCount: 2,
      failedCaseCount: 1,
      retrievalEvidenceAvailableCaseCount: 1,
      retrievalEvidencePartialCaseCount: 1,
      retrievalEvidenceUnavailableCaseCount: 1
    });
  });

  it("is deterministic and introduces no score, winner, ranking or threshold", () => {
    const cases = [caseEvidenceFor(caseA, evidenceOf(["src/a.ts"])), caseEvidenceFor(caseB, evidenceOf(["src/x.ts"]))];
    const first = aggregateRetrievalPrecisionRecall(cases);
    expect(aggregateRetrievalPrecisionRecall(structuredClone(cases))).toEqual(first);
    const serialized = JSON.stringify([first, toRetrievalPrecisionRecallRunMetrics(first)]).toLowerCase();
    for (const forbidden of ["winner", "rank", "threshold", "composite", "\"score", "f1", "best"]) {
      expect(serialized).not.toContain(forbidden);
    }
  });
});

describe("generic metric projection", () => {
  it("projects run-level metrics with consistent units and null for no evidence", () => {
    const available = toRetrievalPrecisionRecallRunMetrics(aggregateRetrievalPrecisionRecall([caseEvidenceFor(caseA, evidenceOf(["src/a.ts"]), 50)]));
    const byId = Object.fromEntries(available.map((metric) => [metric.id, metric]));
    expect(byId["case-count"]).toMatchObject({ value: 1, unit: "count" });
    expect(byId["mean-file-precision"]).toMatchObject({ value: 1, unit: "ratio" });
    expect(byId["mean-irrelevant-context-ratio"]).toMatchObject({ value: 0, unit: "ratio" });
    expect(byId["total-retrieved-tokens"]).toMatchObject({ value: 50, unit: "tokens" });
    expect(byId["mean-retrieved-tokens"]).toMatchObject({ value: 50, unit: "tokens" });
    for (const id of ["total-missed-file-occurrences", "total-missed-symbol-occurrences", "total-uncovered-fact-occurrences", "total-irrelevant-file-occurrences"]) {
      expect(byId[id].unit).toBe("count");
    }
    const none = Object.fromEntries(toRetrievalPrecisionRecallRunMetrics(aggregateRetrievalPrecisionRecall([failedCaseEvidence(caseA)])).map((metric) => [metric.id, metric.value]));
    expect(none["mean-file-precision"]).toBeNull();
    expect(none["total-retrieved-tokens"]).toBeNull();
    expect(none["failed-case-count"]).toBe(1);
  });

  it("projects the twelve per-case outcome metrics, with unavailable and not-applicable ratios as null", () => {
    const quality = caseEvidenceFor(caseA, evidenceOf([])).quality;
    const metrics = toRetrievalPrecisionRecallOutcomeMetrics(quality, "my-dev-kit-retrieval", "ca");
    expect(metrics.map((metric) => metric.id)).toEqual([
      "file-precision",
      "file-recall",
      "symbol-precision",
      "symbol-recall",
      "fact-coverage",
      "irrelevant-context-ratio",
      "retrieved-token-count",
      "missed-file-count",
      "missed-symbol-count",
      "uncovered-fact-count",
      "irrelevant-retrieved-file-count",
      "irrelevant-retrieved-symbol-count"
    ]);
    const byId = Object.fromEntries(metrics.map((metric) => [metric.id, metric.value]));
    expect(byId["file-precision"]).toBeNull(); // not-applicable: nothing retrieved
    expect(byId["file-recall"]).toBe(0); // a real zero
    expect(byId["missed-file-count"]).toBe(1);
    for (const metric of metrics) expect(metric).toMatchObject({ variantId: "my-dev-kit-retrieval", caseId: "ca" });
    const failed = toRetrievalPrecisionRecallOutcomeMetrics(null, "v", "c");
    expect(failed.every((metric) => metric.value === null)).toBe(true);
  });
});
