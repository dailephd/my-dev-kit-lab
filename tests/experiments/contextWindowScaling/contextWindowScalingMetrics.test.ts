import os from "node:os";
import path from "node:path";
import { mkdtemp, rm } from "node:fs/promises";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { readEvaluationCases } from "../../../src/evaluation/readEvaluationCases.js";
import {
  STANDARD_CONTEXT_BUDGETS,
  aggregateContextWindowScaling,
  contextWindowScalingMetadata,
  contextWindowScalingPlugin,
  toAggregateExperimentMetrics,
  type BudgetTreatmentSummaryV1,
  type ContextWindowScalingRun,
} from "../../../src/experiments/plugins/contextWindowScaling/index.js";
import { createDefaultExperimentPluginRegistry } from "../../../src/experiments/defaultRegistry.js";
import { FAIL, PASS, UNAVAILABLE, caseEvidence, syntheticRun, target, treatmentEvidence } from "./evidenceFactory.js";

const B = [8192, 16384];

function summary(budgets: number[], cases: ReturnType<typeof caseEvidence>[], budget: number, variant = "raw-full-file"): BudgetTreatmentSummaryV1 {
  const aggregate = aggregateContextWindowScaling({ contextBudgets: budgets, cases });
  return aggregate.budgetTreatmentSummaries.find((s) => s.contextBudgetTokens === budget && s.variantId === variant)!;
}

function singleTreatmentCases(specs: Array<{ tokens: number | null; shared: typeof PASS | null }>) {
  return specs.map((spec, index) =>
    caseEvidence(`c${index}`, [
      treatmentEvidence({ variantId: "raw-full-file", budgets: B, tokens: spec.tokens, shared: spec.shared }),
      treatmentEvidence({ variantId: "my-dev-kit-guided", budgets: B, tokens: 100, shared: PASS }),
    ])
  );
}

describe("success-rate aggregation", () => {
  it("is 100 when every available cell succeeds", () => {
    const s = summary(B, singleTreatmentCases([{ tokens: 100, shared: PASS }, { tokens: 200, shared: PASS }]), 8192);
    expect(s).toMatchObject({ successfulCellCount: 2, notSuccessfulCellCount: 0, successEvidenceAvailableCount: 2, successRatePercent: 100 });
  });

  it("is 0 (not null) when every available cell is not successful", () => {
    const s = summary(B, singleTreatmentCases([{ tokens: 100, shared: FAIL }, { tokens: 200, shared: FAIL }]), 8192);
    expect(s).toMatchObject({ successfulCellCount: 0, notSuccessfulCellCount: 2, successRatePercent: 0 });
  });

  it("keeps context-too-large in the denominator as available false and mixes with pass/fail", () => {
    const s = summary(
      B,
      singleTreatmentCases([
        { tokens: 100, shared: PASS },
        { tokens: 100, shared: FAIL },
        { tokens: 9000, shared: PASS }, // too large for 8192
        { tokens: 9000, shared: PASS },
      ]),
      8192
    );
    expect(s).toMatchObject({ totalCellCount: 4, successfulCellCount: 1, notSuccessfulCellCount: 3, successEvidenceAvailableCount: 4, successRatePercent: 25 });
  });

  it("excludes unavailable evidence from the denominator", () => {
    const s = summary(B, singleTreatmentCases([{ tokens: 100, shared: PASS }, { tokens: 100, shared: UNAVAILABLE }, { tokens: null, shared: null }]), 8192);
    expect(s).toMatchObject({
      totalCellCount: 3,
      successfulCellCount: 1,
      successEvidenceAvailableCount: 1,
      successEvidenceUnavailableCount: 2,
      successRatePercent: 100,
    });
  });

  it("is null, not 0, with a zero available denominator", () => {
    const s = summary(B, singleTreatmentCases([{ tokens: null, shared: null }, { tokens: 100, shared: UNAVAILABLE }]), 8192);
    expect(s.successEvidenceAvailableCount).toBe(0);
    expect(s.successRatePercent).toBeNull();
  });
});

describe("correctness aggregation", () => {
  it("averages only available scores and never coerces unavailable or too-large cells to zero", () => {
    const cases = singleTreatmentCases([
      { tokens: 100, shared: { availability: "available", score: 1, pass: true } },
      { tokens: 100, shared: { availability: "available", score: 0.5, pass: false } },
      { tokens: 9000, shared: PASS }, // too large at 8192: correctness unavailable
      { tokens: 100, shared: UNAVAILABLE },
    ]);
    const s = summary(B, cases, 8192);
    expect(s).toMatchObject({ correctnessAvailableCount: 2, correctnessUnavailableCount: 2, meanCorrectnessScore: 0.75 });
    // The same two scored cells still yield 0.75 at a budget where the large one now fits and is scored 1.
    expect(summary(B, cases, 16384).meanCorrectnessScore).toBeCloseTo((1 + 0.5 + 1) / 3, 12);
  });

  it("does not let more too-large cells lower the mean", () => {
    const base = summary(B, singleTreatmentCases([{ tokens: 100, shared: PASS }]), 8192).meanCorrectnessScore;
    const more = summary(B, singleTreatmentCases([{ tokens: 100, shared: PASS }, { tokens: 9000, shared: PASS }, { tokens: 9000, shared: PASS }]), 8192).meanCorrectnessScore;
    expect(more).toBe(base);
  });

  it("is null when nothing is scored", () => {
    expect(summary(B, singleTreatmentCases([{ tokens: 9000, shared: PASS }]), 8192).meanCorrectnessScore).toBeNull();
  });
});

describe("utilization aggregation", () => {
  it("is uncapped with exact mean, min, and max across <100, =100, and >100", () => {
    // 4096/8192=50, 8192/8192=100, 12288/8192=150
    const s = summary(B, singleTreatmentCases([{ tokens: 4096, shared: PASS }, { tokens: 8192, shared: PASS }, { tokens: 12288, shared: PASS }]), 8192);
    expect(s).toMatchObject({
      utilizationAvailableCount: 3,
      utilizationUnavailableCount: 0,
      meanContextBudgetUtilizationPercent: 100,
      minContextBudgetUtilizationPercent: 50,
      maxContextBudgetUtilizationPercent: 150,
    });
  });

  it("lets the mean exceed 100 and excludes unmeasured cells", () => {
    const s = summary(B, singleTreatmentCases([{ tokens: 16384, shared: PASS }, { tokens: null, shared: null }]), 8192);
    expect(s).toMatchObject({ utilizationAvailableCount: 1, utilizationUnavailableCount: 1, meanContextBudgetUtilizationPercent: 200, maxContextBudgetUtilizationPercent: 200 });
  });

  it("is null when nothing is measured", () => {
    const s = summary(B, singleTreatmentCases([{ tokens: null, shared: null }]), 8192);
    expect([s.meanContextBudgetUtilizationPercent, s.minContextBudgetUtilizationPercent, s.maxContextBudgetUtilizationPercent]).toEqual([null, null, null]);
  });
});

describe("fit counts, context summaries, and relevant-file summary", () => {
  const cases = [
    caseEvidence("a", [
      treatmentEvidence({ variantId: "raw-full-file", budgets: B, tokens: 100, shared: PASS, expectedFiles: ["x.ts", "y.ts"], observedFiles: ["x.ts", "y.ts"] }),
      treatmentEvidence({ variantId: "my-dev-kit-guided", budgets: B, tokens: null, shared: null, expectedFiles: ["x.ts"] }),
    ]),
    caseEvidence("b", [
      treatmentEvidence({ variantId: "raw-full-file", budgets: B, tokens: 9000, shared: PASS, expectedFiles: ["x.ts", "y.ts", "z.ts"], observedFiles: ["x.ts"] }),
      treatmentEvidence({ variantId: "my-dev-kit-guided", budgets: B, tokens: 50, shared: PASS, expectedFiles: [], observedFiles: [] }),
    ]),
  ];

  it("partitions total cells into fit, too-large, and unavailable", () => {
    const aggregate = aggregateContextWindowScaling({ contextBudgets: B, cases });
    for (const s of aggregate.budgetTreatmentSummaries) {
      expect(s.fitCount + s.contextTooLargeCount + s.contextUnavailableCount).toBe(s.totalCellCount);
      expect(s.contextMeasuredCount).toBe(s.fitCount + s.contextTooLargeCount);
    }
    const guided8k = aggregate.budgetTreatmentSummaries.find((s) => s.contextBudgetTokens === 8192 && s.variantId === "my-dev-kit-guided")!;
    expect(guided8k).toMatchObject({ fitCount: 1, contextTooLargeCount: 0, contextUnavailableCount: 1 });
    const raw8k = aggregate.budgetTreatmentSummaries.find((s) => s.contextBudgetTokens === 8192 && s.variantId === "raw-full-file")!;
    expect(raw8k).toMatchObject({ fitCount: 1, contextTooLargeCount: 1, contextUnavailableCount: 0 });
  });

  it("orders budgets ascending, then treatments raw before guided, and keeps case order", () => {
    const aggregate = aggregateContextWindowScaling({ contextBudgets: [16384, 8192], cases });
    expect(aggregate.budgets).toEqual([8192, 16384]);
    expect(aggregate.budgetTreatmentSummaries.map((s) => `${s.contextBudgetTokens}:${s.variantId}`)).toEqual([
      "8192:raw-full-file",
      "8192:my-dev-kit-guided",
      "16384:raw-full-file",
      "16384:my-dev-kit-guided",
    ]);
    expect(aggregate.caseTreatmentContextSummaries.map((s) => `${s.caseId}:${s.variantId}`)).toEqual([
      "a:raw-full-file",
      "a:my-dev-kit-guided",
      "b:raw-full-file",
      "b:my-dev-kit-guided",
    ]);
  });

  it("represents context once per case and treatment, not once per budget", () => {
    const aggregate = aggregateContextWindowScaling({ contextBudgets: STANDARD_CONTEXT_BUDGETS, cases: cases.map((c) => ({ ...c, treatments: c.treatments.map((t) => ({ ...t, budgetCells: STANDARD_CONTEXT_BUDGETS.map((b) => ({ ...t.budgetCells[0]!, contextBudgetTokens: b })) })) })) });
    expect(aggregate.caseTreatmentContextSummaries).toHaveLength(4);
    expect(aggregate.caseTreatmentContextSummaries[0]).toMatchObject({ caseId: "a", variantId: "raw-full-file", estimatedTokens: 100, characterCount: 400, observedFileCount: 2, contextStatus: "available" });
  });

  it("summarizes relevant-file evidence with straight counts and no precision/recall fields", () => {
    const aggregate = aggregateContextWindowScaling({ contextBudgets: B, cases });
    expect(aggregate.relevantFileSummary).toEqual({
      relevantFileEvidenceAvailableCount: 2, // a/raw, b/raw
      relevantFileEvidenceUnavailableCount: 1, // a/guided (context unavailable)
      relevantFileEvidenceNotApplicableCount: 1, // b/guided (no expected files)
      totalOmittedRelevantFileCount: 2, // b/raw omits y.ts and z.ts
    });
    const serialized = JSON.stringify(aggregate);
    for (const banned of ["recall", "precision", "falsePositive", "irrelevant", "missedContextRate"]) {
      expect(serialized.toLowerCase()).not.toContain(banned.toLowerCase());
    }
  });

  it("rejects evidence whose cells do not match the selected budgets", () => {
    expect(() => aggregateContextWindowScaling({ contextBudgets: [8192, 16384, 32768], cases })).toThrow("do not match the selected budgets");
  });

  it("is deterministic", () => {
    expect(aggregateContextWindowScaling({ contextBudgets: B, cases })).toEqual(aggregateContextWindowScaling({ contextBudgets: B, cases }));
  });
});

describe("generic experiment metrics and plugin metadata", () => {
  it("maps scalar aggregates with unique, budget- and variant-scoped ids and null for unavailable values", () => {
    const run = syntheticRun(B, singleTreatmentCases([{ tokens: null, shared: null }]));
    const ids = run.metrics.map((m) => `${m.id}|${m.variantId ?? ""}`);
    expect(new Set(ids).size).toBe(ids.length);
    const rate = run.metrics.find((m) => m.id === "context-budget-8192-success-rate-percent" && m.variantId === "raw-full-file")!;
    expect(rate.value).toBeNull();
    expect(run.metrics.find((m) => m.id === "context-budget-8192-fit-count" && m.variantId === "my-dev-kit-guided")!.value).toBe(1);
    const outcomeIds = run.cases[0]!.outcomes[0]!.metrics.map((m) => m.id);
    expect(outcomeIds).toEqual(expect.arrayContaining(["budget-8192-context-budget-utilization-percent", "budget-8192-correctness-score", "budget-8192-success"]));
    expect(toAggregateExperimentMetrics(run.aggregate)).toEqual(run.metrics);
  });

  it("advertises json, text, html, and plot but not screenshot", () => {
    expect(contextWindowScalingMetadata.supportedOutputs).toEqual(["json", "text", "html", "plot"]);
    expect(createDefaultExperimentPluginRegistry().list()).toHaveLength(4);
  });
});

describe("fixed-corpus aggregates derived from real execution evidence", () => {
  let run: ContextWindowScalingRun;
  let outputRoot: string;
  beforeAll(async () => {
    const cases = await readEvaluationCases(path.join(process.cwd(), "benchmarks", "contracts", "context-window-scaling-cases.json"), process.cwd());
    outputRoot = await mkdtemp(path.join(os.tmpdir(), "ctx-metrics-"));
    run = await contextWindowScalingPlugin.run({
      runId: "fixed",
      startedAt: new Date(),
      toolRoot: process.cwd(),
      target,
      outputRoot,
      config: { contextBudgets: [...STANDARD_CONTEXT_BUDGETS], kitCommand: `node ${path.join(process.cwd(), "tests", "fixtures", "fake-context-scaling-kit-cli.js")}` },
      inputs: { cases },
    });
  }, 120_000);
  afterAll(async () => {
    await rm(outputRoot, { recursive: true, force: true });
  });

  it("derives raw success rates from actual fit and correctness evidence", () => {
    const rawTokens = run.aggregate.caseTreatmentContextSummaries.filter((s) => s.variantId === "raw-full-file").map((s) => s.estimatedTokens!);
    const rates = STANDARD_CONTEXT_BUDGETS.map((budget) => run.aggregate.budgetTreatmentSummaries.find((s) => s.contextBudgetTokens === budget && s.variantId === "raw-full-file")!.successRatePercent);
    expect(rates).toEqual(STANDARD_CONTEXT_BUDGETS.map((budget) => (rawTokens.filter((t) => t <= budget).length / rawTokens.length) * 100));
    expect(rates).toEqual([0, 25, 50, 75]);
  });

  it("derives guided success at 100 percent for every standard budget", () => {
    const rates = run.aggregate.budgetTreatmentSummaries.filter((s) => s.variantId === "my-dev-kit-guided").map((s) => s.successRatePercent);
    expect(rates).toEqual([100, 100, 100, 100]);
  });

  it("averages raw correctness over scored cells only and keeps utilization uncapped", () => {
    const raw = run.aggregate.budgetTreatmentSummaries.filter((s) => s.variantId === "raw-full-file");
    expect(raw.map((s) => s.correctnessAvailableCount)).toEqual([0, 1, 2, 3]);
    expect(raw.map((s) => s.meanCorrectnessScore)).toEqual([null, 1, 1, 1]);
    const eightK = raw[0]!;
    expect(eightK.maxContextBudgetUtilizationPercent!).toBeGreaterThan(100);
    expect(eightK.meanContextBudgetUtilizationPercent!).toBeGreaterThan(100);
    const guided = run.aggregate.budgetTreatmentSummaries.filter((s) => s.variantId === "my-dev-kit-guided");
    expect(guided.every((s) => s.maxContextBudgetUtilizationPercent! < 10)).toBe(true);
  });

  it("reports natural context sizes and omitted-file counts", () => {
    const guided = run.aggregate.caseTreatmentContextSummaries.filter((s) => s.variantId === "my-dev-kit-guided");
    expect(guided.map((s) => s.observedFileCount)).toEqual([1, 1, 1, 1]);
    expect(guided.map((s) => s.relevantFileEvidence.omittedRelevantFileCount)).toEqual([1, 1, 1, 1]);
    const raw = run.aggregate.caseTreatmentContextSummaries.filter((s) => s.variantId === "raw-full-file");
    expect(raw.map((s) => s.relevantFileEvidence.omittedRelevantFileCount)).toEqual([0, 0, 0, 0]);
    expect(run.aggregate.runSummary).toMatchObject({ caseCount: 4, treatmentCount: 2, budgetCount: 4, totalBudgetCellCount: 32, contextTooLargeCellCount: 10, contextUnavailableCellCount: 0 });
    expect(run.aggregate.relevantFileSummary.totalOmittedRelevantFileCount).toBe(4);
  });
});
