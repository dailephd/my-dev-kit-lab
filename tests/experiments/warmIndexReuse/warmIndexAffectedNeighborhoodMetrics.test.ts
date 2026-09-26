import { describe, expect, it } from "vitest";
import {
  calculateWarmIndexMetrics,
  toRawOutcomeMetrics,
  toRunLevelMetrics,
  toWarmOutcomeMetrics,
  type WarmIndexNumberMetricV1,
  type WarmIndexProjectSummaryV1,
  type WarmIndexTaskSummaryV1,
} from "../../../src/experiments/plugins/warmIndexReuse/index.js";
import { makeAssessment } from "./affectedNeighborhoodTestHelpers.js";

const METHOD = "estimated_chars_div_4";

function task(caseId: string, overrides: Partial<WarmIndexTaskSummaryV1> = {}): WarmIndexTaskSummaryV1 {
  return {
    caseId,
    status: "completed",
    rawStatus: "completed",
    warmStatus: "completed",
    rawBaseline: { targetRoot: "/t", filesIncluded: ["a.ts"], totalFiles: 1, totalChars: 400, totalEstimatedTokens: 100, tokenCountMethod: METHOD, durationMs: 10 },
    warmRetrieval: {
      skipped: false,
      warnings: [],
      totalChars: 40,
      totalEstimatedTokens: 10,
      tokenCountMethod: METHOD,
      filesRead: [],
      selectedNodeId: null,
      selectedFile: null,
      selectedSymbol: null,
      durationMs: 2,
      commands: [],
    },
    warnings: [],
    errors: [],
    ...overrides,
  };
}

function project(tasks: WarmIndexTaskSummaryV1[]): WarmIndexProjectSummaryV1 {
  return {
    benchmarkProject: "todo-ts",
    sessionKey: "todo-ts",
    status: "completed",
    targetRoot: "/t",
    sourceRoots: ["src"],
    indexDir: "/out/indexes/todo-ts",
    sessionPrepared: true,
    buildDurationMs: 100,
    indexCommand: null,
    tasks,
    warnings: [],
    errors: [],
  };
}

const warmOf = (summary: WarmIndexTaskSummaryV1) => calculateWarmIndexMetrics([project([summary])]).projects[0].tasks[0];

const FIELDS = [
  ["changedFileCount", "affected-neighborhood-changed-file-count", "count"],
  ["changedSymbolCount", "affected-neighborhood-changed-symbol-count", "count"],
  ["affectedNodeCount", "affected-neighborhood-node-count", "count"],
  ["affectedEdgeCount", "affected-neighborhood-edge-count", "count"],
  ["taskOverlapCount", "affected-neighborhood-task-overlap-count", "count"],
  ["taskOverlapPercent", "affected-neighborhood-task-overlap-percent", "percent"],
] as const;

const populated = () =>
  makeAssessment({
    changedFileCount: 2,
    changedSymbolCount: 5,
    affectedNodeCount: 9,
    affectedEdgeCount: 11,
    taskOverlapCount: 2,
    taskOverlapPercent: (2 / 3) * 100,
  });

const unestablished = () =>
  makeAssessment({
    status: "unavailable",
    seedMappingStatus: "unavailable",
    graphEvidenceStatus: "partial",
    neighborhoodStatus: "unavailable",
    changedFileCount: null,
    changedSymbolCount: null,
    affectedNodeCount: null,
    affectedEdgeCount: null,
    taskOverlapCount: null,
    taskOverlapPercent: null,
    relationship: "unknown",
    reindexRecommendation: "unknown",
    taskMapping: { ...makeAssessment().taskMapping, status: "unavailable", resolvableTaskNodeCount: 0, resolvedTaskNodeIds: [] },
  });

describe("affected-neighborhood warm-side metrics", () => {
  // TST-B3-013 .. TST-B3-018
  it.each(FIELDS)("converts the persisted %s into an available derived metric with the frozen unit", (field, _id, unit) => {
    const assessment = populated();
    const metric = warmOf(task("t1", { affectedNeighborhood: assessment })).warm[field];

    expect(metric).toEqual({
      availability: "available",
      value: assessment[field],
      unit,
      source: "derived",
      reason: null,
      tokenCountMethod: null,
    });
  });

  // TST-B3-019
  it("keeps every established zero as an available zero", () => {
    const warm = warmOf(task("t1", { affectedNeighborhood: makeAssessment() })).warm;

    for (const [field, , unit] of FIELDS) {
      expect(warm[field]).toEqual({ availability: "available", value: 0, unit, source: "derived", reason: null, tokenCountMethod: null });
    }
    const emitted = toWarmOutcomeMetrics(warmOf(task("t1", { affectedNeighborhood: makeAssessment() })), "warm-index-reuse");
    expect(emitted.filter((metric) => metric.id.startsWith("affected-neighborhood-")).map((metric) => metric.value)).toEqual([0, 0, 0, 0, 0, 0]);
  });

  // TST-B3-020
  it("makes a null analytical value unavailable with a non-empty bounded reason, never zero", () => {
    const warm = warmOf(task("t1", { affectedNeighborhood: unestablished() })).warm;

    for (const [field] of FIELDS) {
      const metric: WarmIndexNumberMetricV1 = warm[field];
      expect(metric.availability).toBe("unavailable");
      expect(metric.value).toBeNull();
      expect(metric.reason).toEqual(expect.stringContaining("Affected-neighborhood evidence did not establish"));
      expect(metric.reason).toContain("assessment unavailable");
      expect(metric.reason).toContain("seed mapping unavailable");
      expect(metric.reason?.length).toBeLessThan(400);
    }
    expect(warm.taskOverlapPercent.reason).toContain("resolvable task nodes 0");
  });

  it("makes only the missing fields unavailable when the assessment establishes some values", () => {
    // Fresh index, incomplete evidence: counts are established, overlap is not.
    const partial = makeAssessment({
      status: "unavailable",
      neighborhoodStatus: "unavailable",
      changedFileCount: 0,
      changedSymbolCount: 0,
      affectedNodeCount: null,
      affectedEdgeCount: null,
      taskOverlapCount: null,
      taskOverlapPercent: null,
    });
    const warm = warmOf(task("t1", { affectedNeighborhood: partial })).warm;

    expect([warm.changedFileCount.availability, warm.changedSymbolCount.availability]).toEqual(["available", "available"]);
    expect([warm.affectedNodeCount.availability, warm.taskOverlapPercent.availability]).toEqual(["unavailable", "unavailable"]);
  });

  // TST-B3-021
  it.each([
    ["null (not performed)", null],
    ["absent (legacy)", undefined],
  ])("makes all six metrics unavailable with an explicit reason when the assessment is %s", (_label, value) => {
    const warm = warmOf(task("t1", value === undefined ? {} : { affectedNeighborhood: value })).warm;

    for (const [field, , unit] of FIELDS) {
      expect(warm[field]).toEqual({
        availability: "unavailable",
        value: null,
        unit,
        source: "derived",
        reason: "No affected-neighborhood assessment was recorded for this task.",
        tokenCountMethod: null,
      });
    }
  });

  // TST-B3-022, TST-B3-024
  it("emits available metrics on the warm outcome only, with the frozen generic IDs", () => {
    const metrics = warmOf(task("t1", { affectedNeighborhood: populated() }));
    const warm = toWarmOutcomeMetrics(metrics, "warm-index-reuse");
    const raw = toRawOutcomeMetrics(metrics, "raw-full-file");

    expect(warm.filter((metric) => metric.id.startsWith("affected-neighborhood-")).map((metric) => [metric.id, metric.value, metric.unit])).toEqual([
      ["affected-neighborhood-changed-file-count", 2, "count"],
      ["affected-neighborhood-changed-symbol-count", 5, "count"],
      ["affected-neighborhood-node-count", 9, "count"],
      ["affected-neighborhood-edge-count", 11, "count"],
      ["affected-neighborhood-task-overlap-count", 2, "count"],
      ["affected-neighborhood-task-overlap-percent", (2 / 3) * 100, "percent"],
    ]);
    for (const metric of warm.filter((entry) => entry.id.startsWith("affected-neighborhood-"))) {
      expect(metric).toEqual(expect.objectContaining({ variantId: "warm-index-reuse", caseId: "t1", description: expect.any(String) }));
    }
    expect(raw.map((metric) => metric.id).join(" ")).not.toContain("affected-neighborhood");
    expect(Object.keys(metrics.raw).join(" ")).not.toMatch(/changed|affected|overlap/i);
  });

  it("states the frozen semantics in the generic metric descriptions", () => {
    const warm = toWarmOutcomeMetrics(warmOf(task("t1", { affectedNeighborhood: populated() })), "warm-index-reuse");
    const description = (id: string) => warm.find((metric) => metric.id === id)?.description ?? "";

    expect(description("affected-neighborhood-changed-symbol-count")).toContain("not proof that each symbol's own source text changed");
    expect(description("affected-neighborhood-node-count")).toContain("one-hop");
    expect(description("affected-neighborhood-edge-count")).toContain("incident to at least one resolved seed");
    expect(description("affected-neighborhood-task-overlap-percent")).toContain("resolvable task graph nodes");
  });

  // TST-B3-023
  it("keeps unavailable metrics structured but omits them from the generic metrics", () => {
    for (const affectedNeighborhood of [unestablished(), null]) {
      const metrics = warmOf(task("t1", { affectedNeighborhood }));
      const ids = toWarmOutcomeMetrics(metrics, "warm-index-reuse").map((metric) => metric.id);

      expect(ids.filter((id) => id.startsWith("affected-neighborhood-"))).toEqual([]);
      expect(metrics.warm.taskOverlapPercent.availability).toBe("unavailable");
    }
  });

  // TST-B3-025
  it("adds no run-level aggregate, average, score, or recommendation metric", () => {
    const metrics = calculateWarmIndexMetrics([project([task("t1", { affectedNeighborhood: populated() }), task("t2", { affectedNeighborhood: makeAssessment() })])]);

    expect(toRunLevelMetrics(metrics).map((metric) => metric.id)).toEqual([
      "warm-index-project-count",
      "warm-index-task-count",
      "warm-index-session-prepared-project-count",
    ]);
  });

  it("does not change any pre-v0.6.1 warm or raw metric", () => {
    const withEvidence = calculateWarmIndexMetrics([project([task("t1", { affectedNeighborhood: populated() })])]).projects[0].tasks[0];
    const without = calculateWarmIndexMetrics([project([task("t1")])]).projects[0].tasks[0];
    const legacy = ({ changedFileCount, changedSymbolCount, affectedNodeCount, affectedEdgeCount, taskOverlapCount, taskOverlapPercent, ...rest }: typeof withEvidence.warm) => {
      void [changedFileCount, changedSymbolCount, affectedNodeCount, affectedEdgeCount, taskOverlapCount, taskOverlapPercent];
      return rest;
    };

    expect(legacy(withEvidence.warm)).toEqual(legacy(without.warm));
    expect(withEvidence.raw).toEqual(without.raw);
  });
});
