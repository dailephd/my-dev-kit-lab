import { describe, expect, it } from "vitest";
import {
  calculateRetrievalQualityMetrics,
  calculateRetrievalQualityMetricsFromIdentityEvidence,
  type RetrievalEvidenceV1,
  type RetrievalQualityIdentityEvidence,
  type RetrievalQualityMetricsV1
} from "../../src/evaluation/retrievalQuality/index.js";
import { RETRIEVAL_QUERY_STRATEGY_IDS, type RetrievalQueryStrategyId } from "../../src/evaluation/retrievalQueryStrategies.js";
import type { RetrievalQueryStrategyEvidenceV1 } from "../../src/evaluation/retrievalQueryStrategyEvidence.js";
import type { EvaluationCase } from "../../src/evaluation/types.js";
import {
  RETRIEVAL_QUERY_STRATEGY_COMPARISON_ANALYSIS_SCHEMA_VERSION,
  RETRIEVAL_QUERY_STRATEGY_COMPARISON_SCOPE_IDS,
  aggregateRetrievalQueryStrategyScope,
  analyzeRetrievalQueryStrategyCase,
  analyzeRetrievalQueryStrategyComparison,
  analyzeRetrievalQueryStrategyTreatment,
  buildRetrievalQueryStrategyComparisonAnalysisArtifact,
  calculateBalancedIdentityF1,
  findRetrievalStrategyParetoFront,
  isCaseComparableAcrossAllStrategies,
  mapRetrievalQueryStrategyComparisonToRun,
  paretoDominatesRetrievalStrategy,
  toRetrievalQueryStrategyOutcomeMetrics,
  toRetrievalQueryStrategyRunMetrics,
  type RetrievalQueryStrategyCaseAnalysisV1,
  type RetrievalQueryStrategyComparisonCaseEvidenceV1,
  type RetrievalQueryStrategyObjectiveVectorV1,
  type RetrievalQueryStrategyScopeStrategySummaryV1,
  type RetrievalQueryStrategyTreatmentEvidenceV1
} from "../../src/experiments/plugins/retrievalQueryStrategyComparison/index.js";
import type { ExperimentRunStatus } from "../../src/experiments/types.js";
import {
  COMMAND_PATH_SENTINEL,
  evidenceOf,
  makeEvaluationCase,
  SOURCE_SENTINEL,
  STDERR_SENTINEL,
  STDOUT_SENTINEL
} from "./retrievalPrecisionRecall/retrievalPrecisionRecallTestHelpers.js";

// ---------------------------------------------------------------- fixtures

const strategyEvidence = (
  strategyId: RetrievalQueryStrategyId,
  files: string[],
  symbols: Array<{ name: string; file: string | null }>,
  availability: RetrievalQueryStrategyEvidenceV1["availability"] = "available"
): RetrievalQueryStrategyEvidenceV1 => ({
  schemaVersion: "retrieval-query-strategy-evidence-v1",
  strategyId,
  availability,
  availabilityReason: availability === "available" ? null : "fixed-reason",
  files: files.map((path) => ({ path })),
  symbols: symbols.map((symbol) => ({ name: symbol.name, nodeId: null, file: symbol.file })),
  steps: [{ kind: "search", succeeded: true, evidenceAvailable: true, reason: null }]
});

function treatmentOf(
  strategyId: RetrievalQueryStrategyId,
  files: string[],
  symbols: Array<{ name: string; file: string | null }>,
  options: { tokens?: number; status?: ExperimentRunStatus; availability?: RetrievalQueryStrategyEvidenceV1["availability"] } = {}
): RetrievalQueryStrategyTreatmentEvidenceV1 {
  const evidence = strategyEvidence(strategyId, files, symbols, options.availability);
  return {
    strategyId,
    status: options.status ?? (evidence.availability === "available" ? "completed" : "partial"),
    retrieval: {
      skipped: false,
      durationMs: 1,
      totalEstimatedTokens: options.tokens ?? 100,
      tokenCountMethod: "estimated_chars_div_4",
      warnings: [],
      evidenceAvailability: evidence.availability,
      evidenceAvailabilityReason: evidence.availabilityReason,
      retrievedFileCount: files.length,
      retrievedSymbolCount: symbols.length,
      steps: evidence.steps
    },
    evidence,
    errors: []
  };
}

function executionCaseOf(
  evaluationCase: EvaluationCase,
  build: (strategyId: RetrievalQueryStrategyId) => RetrievalQueryStrategyTreatmentEvidenceV1
): RetrievalQueryStrategyComparisonCaseEvidenceV1 {
  return {
    caseId: evaluationCase.id,
    caseName: evaluationCase.title,
    benchmarkProject: evaluationCase.benchmarkProject,
    taskLocality: evaluationCase.taskLocality ?? null,
    treatments: RETRIEVAL_QUERY_STRATEGY_IDS.map(build)
  };
}

/** A synthetic per-case analysis whose objective values are set directly (pure aggregation tests). */
type Objectives = { fileF1: number; symbolF1: number; fact: number; tokens: number };
function syntheticCase(
  caseId: string,
  taskLocality: string | null,
  objectivesFor: (strategyId: RetrievalQueryStrategyId) => Objectives | "no-fact-coverage" | "failed"
): RetrievalQueryStrategyCaseAnalysisV1 {
  const ratio = (value: number) => ({ availability: "available" as const, numerator: null, denominator: null, value, reason: null });
  return {
    caseId,
    benchmarkProject: "p",
    taskLocality,
    treatments: RETRIEVAL_QUERY_STRATEGY_IDS.map((strategyId) => {
      const objectives = objectivesFor(strategyId);
      if (objectives === "failed") {
        const none = { availability: "unavailable" as const, numerator: null, denominator: null, value: null, reason: "no-retrieval-measurement" };
        return { strategyId, executionStatus: "failed" as const, quality: null, fileF1: none, symbolF1: none };
      }
      const coverage =
        objectives === "no-fact-coverage"
          ? { availability: "unavailable" as const, numerator: null, denominator: null, value: null, reason: "fact-context-mapping-unavailable" }
          : ratio(objectives.fact);
      const values = objectives === "no-fact-coverage" ? { fileF1: 0.5, symbolF1: 0.5, tokens: 10 } : objectives;
      return {
        strategyId,
        executionStatus: "completed" as const,
        quality: { fact: { coverage }, retrievedTokenCount: values.tokens } as unknown as RetrievalQualityMetricsV1,
        fileF1: ratio(values.fileF1),
        symbolF1: ratio(values.symbolF1)
      };
    })
  };
}

const flat = (value: Objectives) => () => value;
const vector = (meanFileF1: number, meanSymbolF1: number, meanFactCoverage: number, meanRetrievedTokenCount: number): RetrievalQueryStrategyObjectiveVectorV1 => ({
  meanFileF1,
  meanSymbolF1,
  meanFactCoverage,
  meanRetrievedTokenCount
});
const summaryOf = (strategyId: RetrievalQueryStrategyId, objectives: RetrievalQueryStrategyObjectiveVectorV1 | null): RetrievalQueryStrategyScopeStrategySummaryV1 => ({
  strategyId,
  completedCaseCount: 0,
  partialCaseCount: 0,
  failedCaseCount: 0,
  objectives
});

// ------------------------------------------------------------- v0.8.0 seam

describe("generic identity-evidence metric seam", () => {
  const evaluationCase = makeEvaluationCase({ id: "eq1" });
  const fixtures: Array<[string, RetrievalEvidenceV1 | undefined]> = [
    ["relevant plus irrelevant", evidenceOf(["src/a.ts", "src/z.ts"], [{ name: "A", file: "src/a.ts" }, { name: "Z", file: "src/z.ts" }, { name: "B" }])],
    ["empty successful retrieval", evidenceOf([], [])],
    ["partial evidence", evidenceOf(["src/a.ts"], [{ name: "A", file: "src/a.ts" }], "partial")],
    ["unavailable evidence", evidenceOf([], [], "unavailable")],
    ["absent evidence", undefined]
  ];

  it.each(fixtures)("TST-081-047 matches the v0.8.0 calculator for %s", (_label, evidence) => {
    const identityEvidence: RetrievalQualityIdentityEvidence | undefined =
      evidence === undefined
        ? undefined
        : {
            availability: evidence.availability,
            ...(evidence.availabilityReason !== undefined ? { availabilityReason: evidence.availabilityReason } : {}),
            files: evidence.files.map((file) => file.path),
            symbols: evidence.symbols.map((symbol) => ({ name: symbol.name, ...(symbol.file !== undefined ? { file: symbol.file } : {}) }))
          };
    const a = calculateRetrievalQualityMetrics({
      evaluationCase,
      retrieval: { retrievalEvidence: evidence, totalEstimatedTokens: 42, tokenCountMethod: "estimated_chars_div_4" }
    });
    const b = calculateRetrievalQualityMetricsFromIdentityEvidence({
      evaluationCase,
      retrieval: { identityEvidence, totalEstimatedTokens: 42, tokenCountMethod: "estimated_chars_div_4" }
    });
    expect(b).toEqual(a);
  });
});

// ---------------------------------------------------------------- balanced F1

describe("balanced identity F1", () => {
  it("TST-081-048 computes 2TP / (2TP + FP + FN)", () => {
    expect(calculateBalancedIdentityF1(["a", "b"], ["c"], ["d"])).toEqual({
      availability: "available",
      numerator: 4,
      denominator: 6,
      value: 4 / 6,
      reason: null
    });
  });

  it("TST-081-049 scores empty retrieval against a nonempty relevant set as available zero", () => {
    expect(calculateBalancedIdentityF1([], [], ["a", "b"])).toEqual({
      availability: "available",
      numerator: 0,
      denominator: 2,
      value: 0,
      reason: null
    });
  });

  it("TST-081-050 is not applicable without positive or retrieved identities", () => {
    expect(calculateBalancedIdentityF1([], [], [])).toEqual({
      availability: "not-applicable",
      numerator: null,
      denominator: null,
      value: null,
      reason: "no-positive-or-retrieved-identities"
    });
  });

  it.each([
    [null, [], []],
    [[], null, []],
    [[], [], null]
  ])("TST-081-051 is unavailable when any identity set is null (%j,%j,%j)", (relevant, irrelevant, missed) => {
    expect(calculateBalancedIdentityF1(relevant, irrelevant, missed)).toEqual({
      availability: "unavailable",
      numerator: null,
      denominator: null,
      value: null,
      reason: "quality-identity-sets-unavailable"
    });
  });
});

// ------------------------------------------------------ treatment analysis

describe("treatment analysis", () => {
  it("TST-081-052 scores strategy-neutral evidence with exact v0.8.0 semantics", () => {
    const evaluationCase = makeEvaluationCase({ id: "t1" }); // expects src/a.ts, src/b.ts; symbols A, B; fact1 -> a/A, fact2 -> b/B
    const treatment = treatmentOf(
      "keyword-search",
      ["src/a.ts", "src/c.ts", "src/d.ts"],
      [{ name: "A", file: "src/a.ts" }, { name: "C", file: "src/c.ts" }, { name: "D", file: null }],
      { tokens: 250 }
    );
    const analysis = analyzeRetrievalQueryStrategyTreatment(evaluationCase, treatment);
    const quality = analysis.quality as RetrievalQualityMetricsV1;
    expect(analysis.strategyId).toBe("keyword-search");
    expect(analysis.executionStatus).toBe("completed");
    expect(quality.file.precision).toMatchObject({ availability: "available", numerator: 1, denominator: 3, value: 1 / 3 });
    expect(quality.file.recall).toMatchObject({ numerator: 1, denominator: 2, value: 1 / 2 });
    expect(quality.symbol.precision).toMatchObject({ numerator: 1, denominator: 3, value: 1 / 3 });
    expect(quality.symbol.recall).toMatchObject({ numerator: 1, denominator: 2, value: 1 / 2 });
    expect(quality.fact.coverage).toMatchObject({ numerator: 1, denominator: 2, value: 1 / 2 });
    expect(quality.irrelevantContextRatio).toMatchObject({ numerator: 2, denominator: 3, value: 2 / 3 });
    expect(quality.retrievedTokenCount).toBe(250);
    expect(analysis.fileF1).toEqual({ availability: "available", numerator: 2, denominator: 5, value: 2 / 5, reason: null });
    expect(analysis.symbolF1).toEqual({ availability: "available", numerator: 2, denominator: 5, value: 2 / 5, reason: null });
  });

  it("TST-081-053 reports a failed treatment as unavailable, never zero", () => {
    const evaluationCase = makeEvaluationCase({ id: "t2" });
    const failed: RetrievalQueryStrategyTreatmentEvidenceV1 = {
      strategyId: "symbol-lookup",
      status: "failed",
      retrieval: null,
      evidence: null,
      errors: [{ code: "retrieval-failed", message: "The retrieval strategy threw before producing a measurement." }]
    };
    const unavailable = { availability: "unavailable", numerator: null, denominator: null, value: null, reason: "no-retrieval-measurement" };
    expect(analyzeRetrievalQueryStrategyTreatment(evaluationCase, failed)).toEqual({
      strategyId: "symbol-lookup",
      executionStatus: "failed",
      quality: null,
      fileF1: unavailable,
      symbolF1: unavailable
    });
  });

  it("rejects mismatched case identity, treatment count, and strategy order instead of reordering", () => {
    const evaluationCase = makeEvaluationCase({ id: "t3" });
    const good = executionCaseOf(evaluationCase, (id) => treatmentOf(id, ["src/a.ts"], []));
    expect(() => analyzeRetrievalQueryStrategyCase(makeEvaluationCase({ id: "other" }), good)).toThrow();
    expect(() => analyzeRetrievalQueryStrategyCase(evaluationCase, { ...good, treatments: good.treatments.slice(1) })).toThrow();
    expect(() => analyzeRetrievalQueryStrategyCase(evaluationCase, { ...good, treatments: [...good.treatments].reverse() })).toThrow();
    expect(analyzeRetrievalQueryStrategyCase(evaluationCase, good).treatments.map((t) => t.strategyId)).toEqual([...RETRIEVAL_QUERY_STRATEGY_IDS]);
  });
});

// ------------------------------------------------- matching and aggregation

describe("matched complete-case aggregation", () => {
  it("TST-081-054 excludes a case for every strategy when one strategy lacks an objective", () => {
    const base: Objectives = { fileF1: 0.5, symbolF1: 0.5, fact: 0.5, tokens: 100 };
    const caseA = syntheticCase("A", "localized", flat(base));
    const caseB = syntheticCase("B", "localized", (id) => (id === "graph-neighborhood" ? "no-fact-coverage" : { fileF1: 0.9, symbolF1: 0.9, fact: 0.9, tokens: 900 }));
    expect(isCaseComparableAcrossAllStrategies(caseA)).toBe(true);
    expect(isCaseComparableAcrossAllStrategies(caseB)).toBe(false);
    const scope = aggregateRetrievalQueryStrategyScope("overall", [caseA, caseB]);
    expect(scope.caseCount).toBe(2);
    expect(scope.comparisonCaseCount).toBe(1);
    expect(scope.excludedCaseCount).toBe(1);
    expect(scope.comparisonCaseIds).toEqual(["A"]);
    for (const summary of scope.strategySummaries) expect(summary.objectives).toEqual(vector(0.5, 0.5, 0.5, 100));
  });

  it("TST-081-055 uses an unweighted macro mean over cases, not a micro average", () => {
    const small = makeEvaluationCase({ id: "small", files: ["src/a.ts", "src/b.ts"], symbols: ["A", "B"] });
    const large = makeEvaluationCase({ id: "large", files: ["src/a.ts", "src/b.ts", "src/c.ts", "src/d.ts"], symbols: ["A", "B", "C", "D"] });
    const only = (tokens: number) => (id: RetrievalQueryStrategyId) => treatmentOf(id, ["src/a.ts"], [{ name: "A", file: "src/a.ts" }], { tokens });
    const analysis = analyzeRetrievalQueryStrategyComparison(
      [small, large],
      [executionCaseOf(small, only(100)), executionCaseOf(large, only(300))]
    );
    const overall = analysis.scopes[0];
    expect(overall.comparisonCaseCount).toBe(2);
    // small: TP1 FP0 FN1 -> 2/3; large: TP1 FP0 FN3 -> 2/5. Micro would be 4/(4+4)=0.5.
    const expected = (2 / 3 + 2 / 5) / 2;
    for (const summary of overall.strategySummaries) {
      expect(summary.objectives?.meanFileF1).toBe(expected);
      expect(summary.objectives?.meanSymbolF1).toBe(expected);
      expect(summary.objectives?.meanFactCoverage).toBe(0.5);
      expect(summary.objectives?.meanRetrievedTokenCount).toBe(200);
    }
    expect(expected).not.toBe(0.5);
  });

  it("TST-081-056 groups by existing task locality; unknown locality joins only overall", () => {
    const f = flat({ fileF1: 0.5, symbolF1: 0.5, fact: 0.5, tokens: 10 });
    const cases = [
      syntheticCase("localized-1", "localized", f),
      syntheticCase("localized-2", "localized", f),
      syntheticCase("cross-module-1", "cross-module", f),
      syntheticCase("broad-change-1", "broad-change", f),
      syntheticCase("null-locality-1", null, f)
    ];
    const byScope = (id: "overall" | "localized" | "cross-module" | "broad-change") => aggregateRetrievalQueryStrategyScope(id, cases);
    expect(byScope("overall").comparisonCaseIds).toEqual(["localized-1", "localized-2", "cross-module-1", "broad-change-1", "null-locality-1"]);
    expect(byScope("localized").comparisonCaseIds).toEqual(["localized-1", "localized-2"]);
    expect(byScope("cross-module").comparisonCaseIds).toEqual(["cross-module-1"]);
    expect(byScope("broad-change").comparisonCaseIds).toEqual(["broad-change-1"]);
    expect(byScope("overall").caseCount).toBe(5);
  });

  it("counts inherited execution status without deriving it from metrics", () => {
    const cases = [
      syntheticCase("c1", "localized", (id) => (id === "source-slice" ? "failed" : { fileF1: 1, symbolF1: 1, fact: 1, tokens: 1 }))
    ];
    const scope = aggregateRetrievalQueryStrategyScope("localized", cases);
    const slice = scope.strategySummaries.find((s) => s.strategyId === "source-slice");
    const keyword = scope.strategySummaries.find((s) => s.strategyId === "keyword-search");
    expect(slice).toMatchObject({ completedCaseCount: 0, partialCaseCount: 0, failedCaseCount: 1 });
    expect(keyword).toMatchObject({ completedCaseCount: 1, partialCaseCount: 0, failedCaseCount: 0 });
    expect(scope.comparisonCaseCount).toBe(0);
  });
});

// ------------------------------------------------------------------- Pareto

describe("Pareto comparison", () => {
  it("TST-081-057 dominance requires no-worse on all four objectives and strictly better on one", () => {
    const a = vector(0.9, 0.8, 0.9, 100);
    const b = vector(0.8, 0.8, 0.7, 120);
    expect(paretoDominatesRetrievalStrategy(a, b)).toBe(true);
    expect(paretoDominatesRetrievalStrategy(b, a)).toBe(false);
  });

  it("treats fewer tokens as strictly better and uses no tolerance", () => {
    expect(paretoDominatesRetrievalStrategy(vector(0.5, 0.5, 0.5, 99), vector(0.5, 0.5, 0.5, 100))).toBe(true);
    expect(paretoDominatesRetrievalStrategy(vector(0.5, 0.5, 0.5, 100), vector(0.5, 0.5, 0.5, 99))).toBe(false);
    expect(paretoDominatesRetrievalStrategy(vector(0.5 + 1e-12, 0.5, 0.5, 100), vector(0.5, 0.5, 0.5, 100))).toBe(true);
  });

  it("TST-081-058 keeps both strategies on the front under a quality/cost tradeoff", () => {
    const a = vector(0.9, 0.9, 0.9, 200);
    const b = vector(0.8, 0.8, 0.8, 100);
    expect(paretoDominatesRetrievalStrategy(a, b)).toBe(false);
    expect(paretoDominatesRetrievalStrategy(b, a)).toBe(false);
    expect(findRetrievalStrategyParetoFront([summaryOf("keyword-search", a), summaryOf("symbol-lookup", b)])).toEqual(["keyword-search", "symbol-lookup"]);
  });

  it("TST-081-059 never lets equal vectors dominate each other or order break the tie", () => {
    const v = vector(0.7, 0.7, 0.7, 70);
    expect(paretoDominatesRetrievalStrategy(v, { ...v })).toBe(false);
    expect(findRetrievalStrategyParetoFront([summaryOf("keyword-search", v), summaryOf("symbol-lookup", { ...v })])).toEqual(["keyword-search", "symbol-lookup"]);
  });

  it("ignores summaries without objective vectors", () => {
    expect(findRetrievalStrategyParetoFront([summaryOf("keyword-search", null), summaryOf("symbol-lookup", vector(0.1, 0.1, 0.1, 1))])).toEqual(["symbol-lookup"]);
  });

  it("TST-081-060 declares a unique best only for a single-member Pareto front", () => {
    const dominant: Objectives = { fileF1: 0.9, symbolF1: 0.9, fact: 0.9, tokens: 50 };
    const weaker: Objectives = { fileF1: 0.5, symbolF1: 0.5, fact: 0.5, tokens: 500 };
    const scope = aggregateRetrievalQueryStrategyScope("overall", [
      syntheticCase("c1", "localized", (id) => (id === "graph-neighborhood" ? dominant : weaker))
    ]);
    expect(scope.paretoFrontStrategyIds).toEqual(["graph-neighborhood"]);
    expect(scope.bestStrategyId).toBe("graph-neighborhood");
    expect(scope.interpretation).toBe("unique-best");
  });

  it("TST-081-061 preserves no single best when tradeoffs remain, in canonical order", () => {
    const cheap: Objectives = { fileF1: 0.4, symbolF1: 0.4, fact: 0.4, tokens: 10 };
    const rich: Objectives = { fileF1: 0.9, symbolF1: 0.9, fact: 0.9, tokens: 900 };
    const dominated: Objectives = { fileF1: 0.3, symbolF1: 0.3, fact: 0.3, tokens: 950 };
    const scope = aggregateRetrievalQueryStrategyScope("overall", [
      syntheticCase("c1", "localized", (id) => (id === "combined-graph-guided" ? cheap : id === "symbol-lookup" ? rich : dominated))
    ]);
    expect(scope.paretoFrontStrategyIds).toEqual(["symbol-lookup", "combined-graph-guided"]);
    expect(scope.bestStrategyId).toBeNull();
    expect(scope.interpretation).toBe("tradeoff");
  });

  it("TST-081-062 is unavailable when no case is matched-comparable", () => {
    const scope = aggregateRetrievalQueryStrategyScope("overall", [
      syntheticCase("c1", "localized", (id) => (id === "keyword-search" ? "no-fact-coverage" : { fileF1: 1, symbolF1: 1, fact: 1, tokens: 1 }))
    ]);
    expect(scope).toMatchObject({
      caseCount: 1,
      comparisonCaseCount: 0,
      excludedCaseCount: 1,
      comparisonCaseIds: [],
      bestStrategyId: null,
      paretoFrontStrategyIds: [],
      interpretation: "unavailable"
    });
    expect(scope.strategySummaries.every((summary) => summary.objectives === null)).toBe(true);
  });
});

// ----------------------------------------------------------- full analysis

function fullAnalysis() {
  const cases = [
    makeEvaluationCase({ id: "m1", locality: "localized" }),
    makeEvaluationCase({ id: "m2", locality: "cross-module" })
  ];
  const execution = cases.map((evaluationCase, index) =>
    executionCaseOf(evaluationCase, (id) =>
      treatmentOf(id, index === 0 ? ["src/a.ts", "src/b.ts"] : ["src/a.ts"], [{ name: "A", file: "src/a.ts" }, { name: "B", file: "src/b.ts" }], {
        tokens: 100 + RETRIEVAL_QUERY_STRATEGY_IDS.indexOf(id)
      })
    )
  );
  return { cases, execution, analysis: analyzeRetrievalQueryStrategyComparison(cases, execution) };
}

describe("full analysis", () => {
  it("TST-081-063 returns scopes in the frozen order", () => {
    const { analysis } = fullAnalysis();
    expect(analysis.scopes.map((scope) => scope.scopeId)).toEqual(["overall", "localized", "cross-module", "broad-change"]);
    expect([...RETRIEVAL_QUERY_STRATEGY_COMPARISON_SCOPE_IDS]).toEqual(["overall", "localized", "cross-module", "broad-change"]);
    expect(analysis.scopes.find((scope) => scope.scopeId === "broad-change")?.interpretation).toBe("unavailable");
  });

  it("TST-081-064 preserves canonical strategy order everywhere", () => {
    const { analysis } = fullAnalysis();
    const canonical = [...RETRIEVAL_QUERY_STRATEGY_IDS];
    for (const entry of analysis.cases) expect(entry.treatments.map((t) => t.strategyId)).toEqual(canonical);
    for (const scope of analysis.scopes) {
      expect(scope.strategySummaries.map((s) => s.strategyId)).toEqual(canonical);
      const positions = scope.paretoFrontStrategyIds.map((id) => canonical.indexOf(id));
      expect(positions).toEqual([...positions].sort((x, y) => x - y));
    }
    // Strategies differ only in tokens here, so the cheapest (first) uniquely dominates.
    expect(analysis.scopes[0].bestStrategyId).toBe("keyword-search");
  });

  it("rejects selected-case mismatches", () => {
    const { cases, execution } = fullAnalysis();
    expect(() => analyzeRetrievalQueryStrategyComparison(cases, [execution[1], execution[0]])).toThrow();
    expect(() => analyzeRetrievalQueryStrategyComparison(cases, [execution[0]])).toThrow();
  });
});

describe("analysis artifact", () => {
  it("TST-081-065 has the frozen schema, methodology, and no raw execution material", () => {
    const { analysis } = fullAnalysis();
    const artifact = buildRetrievalQueryStrategyComparisonAnalysisArtifact({
      runId: "r",
      pluginId: "retrieval-query-strategy-comparison",
      pluginSchemaVersion: "1.0.0",
      startedAt: "s",
      completedAt: "c",
      analysis
    });
    expect(artifact.schemaVersion).toBe("my-dev-kit-lab-retrieval-query-strategy-comparison-analysis-v1");
    expect(artifact.schemaVersion).toBe(RETRIEVAL_QUERY_STRATEGY_COMPARISON_ANALYSIS_SCHEMA_VERSION);
    expect(artifact.methodology).toEqual({
      fileF1: "balanced-f1",
      symbolF1: "balanced-f1",
      aggregation: "matched-complete-case-macro-mean",
      multiObjectiveComparison: "pareto-dominance",
      uniqueBestRule: "single-member-pareto-front",
      objectiveDirections: {
        meanFileF1: "maximize",
        meanSymbolF1: "maximize",
        meanFactCoverage: "maximize",
        meanRetrievedTokenCount: "minimize"
      }
    });
    expect(artifact.analysis).toEqual(analysis);
    expect(artifact.analysis).not.toBe(analysis);
    expect(artifact.analysis.cases).toHaveLength(2);
    expect(artifact.analysis.scopes).toHaveLength(4);
    const serialized = JSON.stringify(artifact);
    for (const forbidden of ["contextText", "stdout", "stderr", "commandString", "winnerScore", SOURCE_SENTINEL, STDOUT_SENTINEL, STDERR_SENTINEL, COMMAND_PATH_SENTINEL]) {
      expect(serialized).not.toContain(forbidden);
    }
  });

  it("TST-081-072 exposes no composite score or ranking property at any depth", () => {
    const { analysis } = fullAnalysis();
    const artifact = buildRetrievalQueryStrategyComparisonAnalysisArtifact({
      runId: "r",
      pluginId: "p",
      pluginSchemaVersion: "1",
      startedAt: "s",
      completedAt: "c",
      analysis
    });
    const keys = new Set<string>();
    const walk = (value: unknown) => {
      if (Array.isArray(value)) value.forEach(walk);
      else if (value !== null && typeof value === "object") {
        for (const [key, child] of Object.entries(value)) {
          keys.add(key);
          walk(child);
        }
      }
    };
    walk(JSON.parse(JSON.stringify(artifact)));
    for (const forbidden of ["score", "compositeScore", "winnerScore", "rank", "ranking"]) expect(keys.has(forbidden)).toBe(false);
  });
});

describe("metric projection", () => {
  const OUTCOME_IDS = [
    "file-precision",
    "file-recall",
    "file-f1",
    "symbol-precision",
    "symbol-recall",
    "symbol-f1",
    "fact-coverage",
    "irrelevant-context-ratio",
    "retrieved-token-count",
    "missed-file-count",
    "missed-symbol-count",
    "uncovered-fact-count",
    "irrelevant-retrieved-file-count",
    "irrelevant-retrieved-symbol-count"
  ];

  it("TST-081-067 projects exact outcome metrics and nulls (never zero) for unavailable values", () => {
    const evaluationCase = makeEvaluationCase({ id: "t1" });
    const completed = analyzeRetrievalQueryStrategyTreatment(
      evaluationCase,
      treatmentOf("keyword-search", ["src/a.ts", "src/c.ts", "src/d.ts"], [{ name: "A", file: "src/a.ts" }], { tokens: 250 })
    );
    const metrics = toRetrievalQueryStrategyOutcomeMetrics(completed, "t1");
    expect(metrics.map((metric) => metric.id)).toEqual(OUTCOME_IDS);
    expect(metrics.every((metric) => metric.variantId === "keyword-search" && metric.caseId === "t1")).toBe(true);
    const byId = new Map(metrics.map((metric) => [metric.id, metric]));
    expect(byId.get("file-f1")).toMatchObject({ value: 2 / 5, unit: "ratio" });
    // symbols: TP1 (A) FP0 FN1 (B) -> 2/3
    expect(byId.get("symbol-f1")).toMatchObject({ value: 2 / 3, unit: "ratio" });
    expect(byId.get("retrieved-token-count")).toMatchObject({ value: 250, unit: "tokens" });
    expect(byId.get("missed-file-count")).toMatchObject({ value: 1, unit: "count" });
    expect(byId.get("irrelevant-retrieved-file-count")).toMatchObject({ value: 2, unit: "count" });

    const failed = analyzeRetrievalQueryStrategyTreatment(evaluationCase, {
      strategyId: "keyword-search",
      status: "failed",
      retrieval: null,
      evidence: null,
      errors: []
    });
    const failedMetrics = toRetrievalQueryStrategyOutcomeMetrics(failed, "t1");
    expect(failedMetrics.map((metric) => metric.id)).toEqual(OUTCOME_IDS);
    expect(failedMetrics.every((metric) => metric.value === null)).toBe(true);
  });

  it("TST-081-068 projects four scopes by seven strategies of objective means plus case counts", () => {
    const { analysis } = fullAnalysis();
    const metrics = toRetrievalQueryStrategyRunMetrics(analysis);
    expect(metrics).toHaveLength(4 * (1 + 7 * 4));
    for (const scope of analysis.scopes) {
      const count = metrics.filter((metric) => metric.id === `${scope.scopeId}-comparison-case-count`);
      expect(count).toEqual([
        { id: `${scope.scopeId}-comparison-case-count`, name: `${scope.scopeId} matched comparison cases`, value: scope.comparisonCaseCount, unit: "count" }
      ]);
      const table: Array<[string, string, "meanFileF1" | "meanSymbolF1" | "meanFactCoverage" | "meanRetrievedTokenCount", string]> = [
        ["mean-file-f1", "mean file F1", "meanFileF1", "ratio"],
        ["mean-symbol-f1", "mean symbol F1", "meanSymbolF1", "ratio"],
        ["mean-fact-coverage", "mean fact coverage", "meanFactCoverage", "ratio"],
        ["mean-retrieved-token-count", "mean retrieved token count", "meanRetrievedTokenCount", "tokens"]
      ];
      for (const [suffix, label, key, unit] of table) {
        const entries = metrics.filter((metric) => metric.id === `${scope.scopeId}-${suffix}`);
        expect(entries.map((metric) => metric.variantId)).toEqual([...RETRIEVAL_QUERY_STRATEGY_IDS]);
        entries.forEach((metric, index) => {
          expect(metric.name).toBe(`${scope.scopeId} ${label}`);
          expect(metric.unit).toBe(unit);
          expect(metric.value).toBe(scope.strategySummaries[index].objectives?.[key] ?? null);
        });
      }
    }
    // The unavailable scope projects null, not zero.
    expect(metrics.find((metric) => metric.id === "broad-change-mean-file-f1")?.value).toBeNull();
    for (const forbidden of ["best-strategy", "rank", "score", "winner-score"]) {
      expect(metrics.some((metric) => metric.id.includes(forbidden))).toBe(false);
    }
  });

  it("maps analysis onto outcomes and run without recalculating", () => {
    const { execution, analysis } = fullAnalysis();
    const run = mapRetrievalQueryStrategyComparisonToRun({
      runId: "run-x",
      startedAt: "s",
      completedAt: "c",
      target: { kind: "self", targetRoot: ".", toolRoot: ".", packageName: null, packageVersion: null, hasPackageJson: true, hasLockfile: true, branch: null, commit: null, hasGit: true, isSelf: true },
      caseEvidence: execution,
      analysis,
      executionArtifactPath: "exec.json",
      analysisArtifactPath: "analysis.json"
    });
    expect(run.metadata).toEqual({ executionArtifactPath: "exec.json", analysisArtifactPath: "analysis.json" });
    expect(run.artifacts.map((artifact) => [artifact.id, artifact.path])).toEqual([
      ["retrieval-query-strategy-comparison-execution", "exec.json"],
      ["retrieval-query-strategy-comparison-analysis", "analysis.json"]
    ]);
    expect(run.analysis).toEqual(analysis);
    expect(run.analysis).not.toBe(analysis);
    expect(run.metrics).toEqual(toRetrievalQueryStrategyRunMetrics(analysis));
    expect(run.cases[0].outcomes[0].metrics).toEqual(toRetrievalQueryStrategyOutcomeMetrics(analysis.cases[0].treatments[0], "m1"));
  });
});

describe("analysis is downstream of execution", () => {
  it("TST-081-069 changing only the answer key changes scores but never execution evidence", () => {
    const original = makeEvaluationCase({ id: "d1", files: ["src/a.ts", "src/b.ts"], symbols: ["A", "B"] });
    const altered = makeEvaluationCase({ id: "d1", files: ["src/a.ts", "src/x.ts", "src/y.ts"], symbols: ["A", "X", "Y"] });
    const execution = [executionCaseOf(original, (id) => treatmentOf(id, ["src/a.ts"], [{ name: "A", file: "src/a.ts" }]))];
    const before = JSON.stringify(execution);
    const first = analyzeRetrievalQueryStrategyComparison([original], execution);
    const second = analyzeRetrievalQueryStrategyComparison([altered], execution);
    expect(JSON.stringify(execution)).toBe(before);
    expect(first.cases[0].treatments[0].fileF1.value).toBe(2 / 3);
    expect(second.cases[0].treatments[0].fileF1.value).toBe(2 / 4);
    expect(first.cases[0].treatments[0].fileF1.value).not.toBe(second.cases[0].treatments[0].fileF1.value);
  });
});
