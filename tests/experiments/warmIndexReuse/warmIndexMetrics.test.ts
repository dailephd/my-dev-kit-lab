import { describe, expect, it } from "vitest";
import {
  availableMetric,
  calculateWarmIndexMetrics,
  notApplicableMetric,
  toRawOutcomeMetrics,
  toRunLevelMetrics,
  toWarmOutcomeMetrics,
  unavailableMetric,
  type WarmIndexProjectSummaryV1,
  type WarmIndexTaskSummaryV1,
} from "../../../src/experiments/plugins/warmIndexReuse/index.js";

const METHOD = "estimated_chars_div_4";

function rawSummary(values: { chars: number; tokens: number; durationMs: number; method?: string }) {
  return {
    targetRoot: "/target",
    filesIncluded: ["src/a.ts"],
    totalFiles: 1,
    totalChars: values.chars,
    totalEstimatedTokens: values.tokens,
    tokenCountMethod: values.method ?? METHOD,
    durationMs: values.durationMs,
  };
}

function warmSummary(values: { chars: number; tokens: number; durationMs: number; skipped?: boolean; method?: string }) {
  return {
    skipped: values.skipped ?? false,
    warnings: [],
    totalChars: values.chars,
    totalEstimatedTokens: values.tokens,
    tokenCountMethod: values.method ?? METHOD,
    filesRead: [],
    selectedNodeId: null,
    selectedFile: null,
    selectedSymbol: null,
    durationMs: values.durationMs,
    commands: [],
  };
}

function task(
  caseId: string,
  overrides: Partial<WarmIndexTaskSummaryV1> = {}
): WarmIndexTaskSummaryV1 {
  return {
    caseId,
    status: "completed",
    rawStatus: "completed",
    warmStatus: "completed",
    rawBaseline: rawSummary({ chars: 400, tokens: 100, durationMs: 10 }),
    warmRetrieval: warmSummary({ chars: 40, tokens: 10, durationMs: 2 }),
    warnings: [],
    errors: [],
    ...overrides,
  };
}

function project(overrides: Partial<WarmIndexProjectSummaryV1> = {}): WarmIndexProjectSummaryV1 {
  return {
    benchmarkProject: "todo-ts",
    sessionKey: "todo-ts",
    status: "completed",
    targetRoot: "/target",
    sourceRoots: ["src"],
    indexDir: "/out/indexes/todo-ts",
    sessionPrepared: true,
    buildDurationMs: 100,
    indexCommand: null,
    tasks: [task("t1"), task("t2")],
    warnings: [],
    errors: [],
    ...overrides,
  };
}

const values = (metrics: Array<{ availability: string; value: number | null }>) =>
  metrics.map((metric) => (metric.availability === "available" ? metric.value : metric.availability));

describe("warm-index metric availability primitives", () => {
  it("keeps value/reason invariants and treats zero as a valid value", () => {
    expect(availableMetric(0, "ms", "measured")).toEqual({
      availability: "available",
      value: 0,
      unit: "ms",
      source: "measured",
      reason: null,
      tokenCountMethod: null,
    });
    const unavailable = unavailableMetric("ms", "measured", "no evidence");
    expect([unavailable.value, unavailable.reason]).toEqual([null, "no evidence"]);
    const notApplicable = notApplicableMetric("score", "agent", "does not apply");
    expect([notApplicable.availability, notApplicable.value, notApplicable.reason]).toEqual(["not-applicable", null, "does not apply"]);
    expect(() => unavailableMetric("ms", "measured", " ")).toThrow("require a reason");
    expect(() => notApplicableMetric("ms", "measured", "")).toThrow("require a reason");
  });

  it("turns non-finite inputs into unavailable metrics with an invalid-input reason", () => {
    for (const bad of [Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY]) {
      const metric = availableMetric(bad, "ms", "measured");
      expect(metric.availability).toBe("unavailable");
      expect(metric.value).toBeNull();
      expect(metric.reason).toContain("Invalid input");
    }
  });
});

describe("calculateWarmIndexMetrics", () => {
  it("reports direct raw and warm measurements with their sources and token method", () => {
    const [metrics] = calculateWarmIndexMetrics([project({ tasks: [task("t1")] })]).projects;
    const [t1] = metrics.tasks;
    expect(t1.taskOrdinal).toBe(1);
    expect(values([t1.raw.contextCharacters, t1.raw.contextEstimatedTokens, t1.raw.operationDurationMs])).toEqual([400, 100, 10]);
    expect(values([t1.warm.contextCharacters, t1.warm.contextEstimatedTokens, t1.warm.retrievalDurationMs])).toEqual([40, 10, 2]);
    expect(t1.raw.contextEstimatedTokens).toEqual(
      expect.objectContaining({ unit: "estimated-tokens", source: "estimated-chars-div-4", tokenCountMethod: METHOD })
    );
    expect(t1.warm.retrievalDurationMs).toEqual(expect.objectContaining({ unit: "ms", source: "measured" }));
    expect(metrics.indexBuildDurationMs).toEqual(expect.objectContaining({ availability: "available", value: 100 }));
  });

  it("amortizes the build duration as build / task ordinal", () => {
    const [metrics] = calculateWarmIndexMetrics([project({ tasks: [task("t1"), task("t2"), task("t3"), task("t4")] })]).projects;
    expect(values(metrics.tasks.map((t) => t.warm.amortizedIndexBuildDurationMs))).toEqual([100, 50, 100 / 3, 25]);
    expect(metrics.tasks[1].warm.amortizedIndexBuildDurationMs.source).toBe("derived");
  });

  it("keeps a failed build's measured duration but does not amortize or charge it to warm cumulative cost", () => {
    const [metrics] = calculateWarmIndexMetrics([
      project({ sessionPrepared: false, status: "partial", tasks: [task("t1", { warmRetrieval: null, warmStatus: "failed" })] }),
    ]).projects;
    const [t1] = metrics.tasks;
    expect(metrics.indexBuildDurationMs).toEqual(expect.objectContaining({ availability: "available", value: 100 }));
    expect(t1.warm.amortizedIndexBuildDurationMs.availability).toBe("unavailable");
    expect(t1.warm.cumulativeComponentDurationMs.availability).toBe("unavailable");
    expect(t1.warm.cumulativeComponentDurationMs.reason).toContain("No valid warm index session");
    expect(t1.warm.retrievalDurationMs.availability).toBe("unavailable");
    expect(values([t1.raw.operationDurationMs, t1.raw.cumulativeDurationMs])).toEqual([10, 10]);
  });

  it("reports a structurally invalid project's build duration as unavailable, never zero", () => {
    const [metrics] = calculateWarmIndexMetrics([
      project({ sessionPrepared: false, buildDurationMs: null, status: "partial", errors: ["roots differ"] }),
    ]).projects;
    expect(metrics.indexBuildDurationMs.availability).toBe("unavailable");
    expect(metrics.indexBuildDurationMs.value).toBeNull();
    expect(metrics.indexBuildDurationMs.reason).toContain("structurally inconsistent");
  });

  it("sums raw durations and charges the build exactly once in cumulative warm component duration", () => {
    const [metrics] = calculateWarmIndexMetrics([
      project({
        tasks: [
          task("t1", { rawBaseline: rawSummary({ chars: 1, tokens: 1, durationMs: 10 }), warmRetrieval: warmSummary({ chars: 1, tokens: 1, durationMs: 3 }) }),
          task("t2", { rawBaseline: rawSummary({ chars: 1, tokens: 1, durationMs: 20 }), warmRetrieval: warmSummary({ chars: 1, tokens: 1, durationMs: 4 }) }),
          task("t3", { rawBaseline: rawSummary({ chars: 1, tokens: 1, durationMs: 30 }), warmRetrieval: warmSummary({ chars: 1, tokens: 1, durationMs: 5 }) }),
        ],
      }),
    ]).projects;
    expect(values(metrics.tasks.map((t) => t.raw.cumulativeDurationMs))).toEqual([10, 30, 60]);
    expect(values(metrics.tasks.map((t) => t.warm.cumulativeComponentDurationMs))).toEqual([103, 107, 112]);
    expect(metrics.tasks[0].warm.cumulativeComponentDurationMs.source).toBe("derived");
  });

  it("sums estimated context tokens per side without any index token cost", () => {
    const [metrics] = calculateWarmIndexMetrics([
      project({
        tasks: [
          task("t1", { rawBaseline: rawSummary({ chars: 4, tokens: 100, durationMs: 1 }), warmRetrieval: warmSummary({ chars: 4, tokens: 7, durationMs: 1 }) }),
          task("t2", { rawBaseline: rawSummary({ chars: 4, tokens: 150, durationMs: 1 }), warmRetrieval: warmSummary({ chars: 4, tokens: 9, durationMs: 1 }) }),
        ],
      }),
    ]).projects;
    expect(values(metrics.tasks.map((t) => t.raw.cumulativeEstimatedContextTokens))).toEqual([100, 250]);
    expect(values(metrics.tasks.map((t) => t.warm.cumulativeEstimatedContextTokens))).toEqual([7, 16]);
    expect(metrics.tasks[1].warm.cumulativeEstimatedContextTokens).toEqual(
      expect.objectContaining({ unit: "estimated-tokens", source: "estimated-chars-div-4", tokenCountMethod: METHOD })
    );
  });

  it("makes a cumulative prefix unavailable from the first missing task onward while later direct metrics stay available", () => {
    const [metrics] = calculateWarmIndexMetrics([
      project({
        tasks: [
          task("t1"),
          task("t2", { rawBaseline: null, rawStatus: "failed", warmRetrieval: null, warmStatus: "failed" }),
          task("t3"),
        ],
      }),
    ]).projects;
    expect(values(metrics.tasks.map((t) => t.raw.cumulativeDurationMs))).toEqual([10, "unavailable", "unavailable"]);
    expect(values(metrics.tasks.map((t) => t.warm.cumulativeComponentDurationMs))).toEqual([102, "unavailable", "unavailable"]);
    expect(values(metrics.tasks.map((t) => t.warm.cumulativeEstimatedContextTokens))).toEqual([10, "unavailable", "unavailable"]);
    expect(metrics.tasks[2].raw.cumulativeDurationMs.reason).toContain("Task 2 (t2)");
    expect(values([metrics.tasks[2].raw.operationDurationMs, metrics.tasks[2].warm.retrievalDurationMs])).toEqual([10, 2]);
    expect(values([metrics.tasks[2].warm.amortizedIndexBuildDurationMs])).toEqual([100 / 3]);
  });

  it("breaks a cumulative prefix on a non-finite upstream measurement", () => {
    const [metrics] = calculateWarmIndexMetrics([
      project({ tasks: [task("t1", { rawBaseline: rawSummary({ chars: 1, tokens: 1, durationMs: Number.NaN }) }), task("t2")] }),
    ]).projects;
    expect(metrics.tasks[0].raw.operationDurationMs.reason).toContain("Invalid input");
    expect(values(metrics.tasks.map((t) => t.raw.cumulativeDurationMs))).toEqual(["unavailable", "unavailable"]);
  });

  it("keeps a skipped retrieval's measured values and uses them in the cumulative warm prefix", () => {
    const [metrics] = calculateWarmIndexMetrics([
      project({ tasks: [task("t1", { warmStatus: "skipped", warmRetrieval: warmSummary({ chars: 0, tokens: 0, durationMs: 6, skipped: true }) })] }),
    ]).projects;
    const [t1] = metrics.tasks;
    expect(values([t1.warm.contextCharacters, t1.warm.contextEstimatedTokens, t1.warm.retrievalDurationMs])).toEqual([0, 0, 6]);
    expect(values([t1.warm.cumulativeComponentDurationMs])).toEqual([106]);
  });

  it("does not sum estimated tokens across mixed token-count methods", () => {
    const [metrics] = calculateWarmIndexMetrics([
      project({ tasks: [task("t1"), task("t2", { rawBaseline: rawSummary({ chars: 1, tokens: 5, durationMs: 1, method: "other_method" }) })] }),
    ]).projects;
    expect(values(metrics.tasks.map((t) => t.raw.cumulativeEstimatedContextTokens))).toEqual([100, "unavailable"]);
    expect(metrics.tasks[1].raw.cumulativeEstimatedContextTokens.reason).toContain("mixed methods");
    expect(values(metrics.tasks.map((t) => t.warm.cumulativeEstimatedContextTokens))).toEqual([10, 20]);
  });

  it("restarts ordinals, amortization, and cumulative sums for every project", () => {
    const metrics = calculateWarmIndexMetrics([
      project({ tasks: [task("a1"), task("a2")] }),
      project({ benchmarkProject: "todo-js", sessionKey: "todo-js", buildDurationMs: 40, tasks: [task("b1"), task("b2")] }),
    ]);
    const second = metrics.projects[1];
    expect(metrics.projects.map((p) => p.benchmarkProject)).toEqual(["todo-ts", "todo-js"]);
    expect(second.tasks.map((t) => t.taskOrdinal)).toEqual([1, 2]);
    expect(values(second.tasks.map((t) => t.warm.amortizedIndexBuildDurationMs))).toEqual([40, 20]);
    expect(values(second.tasks.map((t) => t.raw.cumulativeDurationMs))).toEqual([10, 20]);
    expect(values(second.tasks.map((t) => t.warm.cumulativeComponentDurationMs))).toEqual([42, 44]);
  });

  it("reports agent correctness and agent token usage as unavailable on both variants", () => {
    const [metrics] = calculateWarmIndexMetrics([project({ tasks: [task("t1")] })]).projects;
    for (const side of [metrics.tasks[0].raw, metrics.tasks[0].warm]) {
      expect(side.agentCorrectness).toEqual(expect.objectContaining({ availability: "unavailable", value: null, unit: "score", source: "agent" }));
      expect(side.agentCorrectness.reason).toContain("Agent execution is not part");
      expect(side.agentTotalTokens).toEqual(
        expect.objectContaining({ availability: "unavailable", value: null, unit: "tokens", source: "agent", tokenCountMethod: null })
      );
    }
  });

  it("is deterministic and does not mutate its input", () => {
    const input = [project()];
    const before = JSON.stringify(input);
    expect(calculateWarmIndexMetrics(input)).toEqual(calculateWarmIndexMetrics(input));
    expect(JSON.stringify(input)).toBe(before);
  });
});

describe("generic metric mapping", () => {
  it("emits only available metrics with IDs, units, descriptions, variant and case", () => {
    const [metrics] = calculateWarmIndexMetrics([project({ tasks: [task("t1")] })]).projects;
    const warm = toWarmOutcomeMetrics(metrics.tasks[0], "warm-index-reuse");
    expect(warm.map((metric) => [metric.id, metric.value, metric.unit])).toEqual([
      ["context-character-count", 40, "characters"],
      ["context-estimated-token-count", 10, "estimated-tokens"],
      ["operation-duration-ms", 2, "ms"],
      ["cumulative-component-duration-ms", 102, "ms"],
      ["cumulative-context-estimated-token-count", 10, "estimated-tokens"],
      ["amortized-index-build-duration-ms", 100, "ms"],
    ]);
    for (const metric of warm) {
      expect(metric).toEqual(expect.objectContaining({ variantId: "warm-index-reuse", caseId: "t1", description: expect.any(String) }));
    }
    expect(toRawOutcomeMetrics(metrics.tasks[0], "raw-full-file").map((metric) => metric.id)).toEqual([
      "context-character-count",
      "context-estimated-token-count",
      "operation-duration-ms",
      "cumulative-component-duration-ms",
      "cumulative-context-estimated-token-count",
    ]);
  });

  it("omits unavailable metrics instead of emitting zeros and never emits agent metrics", () => {
    const [metrics] = calculateWarmIndexMetrics([
      project({ sessionPrepared: false, tasks: [task("t1", { warmRetrieval: null, warmStatus: "failed" })] }),
    ]).projects;
    expect(toWarmOutcomeMetrics(metrics.tasks[0], "warm-index-reuse")).toEqual([]);
    const raw = toRawOutcomeMetrics(metrics.tasks[0], "raw-full-file");
    expect(raw.every((metric) => typeof metric.value === "number")).toBe(true);
    expect(raw.map((metric) => metric.id).join(" ")).not.toMatch(/agent|correctness/);
  });

  it("limits run-level metrics to direct counts", () => {
    const metrics = calculateWarmIndexMetrics([project(), project({ benchmarkProject: "b", sessionKey: "b", sessionPrepared: false })]);
    expect(toRunLevelMetrics(metrics).map((metric) => [metric.id, metric.value])).toEqual([
      ["warm-index-project-count", 2],
      ["warm-index-task-count", 4],
      ["warm-index-session-prepared-project-count", 1],
    ]);
  });
});
