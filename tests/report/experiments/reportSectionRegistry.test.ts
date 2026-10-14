import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ExperimentRun } from "../../../src/experiments/index.js";
import { contextStrategyComparisonMetadata } from "../../../src/experiments/plugins/contextStrategyComparison/index.js";
import type { PluginExperimentReport } from "../../../src/report/experiments/experimentReportModel.js";
import { buildPluginExperimentReport } from "../../../src/report/experiments/buildPluginExperimentReport.js";
import { renderPluginExperimentReportHtml } from "../../../src/report/experiments/renderPluginExperimentReportHtml.js";
import { renderPluginExperimentReportText } from "../../../src/report/experiments/renderPluginExperimentReportText.js";
import {
  createReportSectionRegistry,
  type ReportSectionDescriptorV1,
} from "../../../src/report/experiments/reportSectionRegistry.js";
import {
  getSpecializedReportSectionRegistry,
  SPECIALIZED_REPORT_SECTION_DESCRIPTORS,
} from "../../../src/report/experiments/specializedReportSections.js";

// Controls the existing context-window-scaling family builder for dispatch/error tests; passes through otherwise.
const scalingControl = vi.hoisted(() => ({ mode: "real" as "real" | "sentinel" | "throw" }));
vi.mock("../../../src/report/experiments/buildContextWindowScalingReport.js", async (importOriginal) => {
  const original = await importOriginal<typeof import("../../../src/report/experiments/buildContextWindowScalingReport.js")>();
  return {
    ...original,
    buildContextWindowScalingReport: (run: ExperimentRun) => {
      if (scalingControl.mode === "throw") throw new Error("required projection failed");
      if (scalingControl.mode === "sentinel") {
        return {
          sentinel: true,
          pluginId: run.pluginId,
          runSummary: {
            caseCount: 0,
            treatmentCount: 0,
            budgetCount: 0,
            totalBudgetCellCount: 0,
            evaluatedBudgetCellCount: 0,
            contextTooLargeCellCount: 0,
            contextUnavailableCellCount: 0,
          },
        };
      }
      return original.buildContextWindowScalingReport(run);
    },
  };
});

const GENERATED_AT = "2026-06-23T00:00:00.000Z";

const EXPECTED_ORDER = [
  "context-strategy.v043",
  "warm-index.reuse",
  "incremental-change.staleness",
  "context-window.scaling",
  "retrieval.precision-recall",
  "retrieval.query-strategy-comparison",
  "retrieval.context-pack-generation",
  "agent-success.rate",
];

function makeRun(pluginId: string, redacted = false, withV043 = true): ExperimentRun {
  return {
    runId: "run-1",
    pluginId,
    startedAt: GENERATED_AT,
    completedAt: GENERATED_AT,
    status: "completed",
    target: {
      kind: "external-local",
      toolRoot: "T:\\tool",
      targetRoot: "T:\\target",
      packageName: "pkg",
      packageVersion: "1.0.0",
      hasPackageJson: true,
      hasLockfile: true,
      branch: "main",
      commit: "abc",
      hasGit: true,
      isSelf: false,
      ...(redacted ? { privacyProjection: "external-local-redacted" } : {}),
    } as ExperimentRun["target"],
    variants: [{ id: "a", name: "A" }],
    cases: [],
    metrics: [],
    artifacts: [{ id: "x", label: "X", path: "T:\\out\\x.json", kind: "json" }],
    warnings: [],
    failures: [],
    summary: undefined,
    metadata: { outputRoot: "T:\\out" },
    ...(pluginId === "context-strategy-comparison" && withV043
      ? { v043StageContextExecutions: [], v043StageContextEvaluations: [], v043StageContextRunAssurance: [] }
      : {}),
  } as unknown as ExperimentRun;
}

function build(run: ExperimentRun): PluginExperimentReport {
  return buildPluginExperimentReport({
    run,
    plugin: { ...contextStrategyComparisonMetadata, id: run.pluginId },
    outputRoot: "T:\\out",
    generatedAt: GENERATED_AT,
  });
}

function stubDescriptor(overrides: Partial<ReportSectionDescriptorV1> = {}): ReportSectionDescriptorV1 {
  return {
    id: "test.section",
    order: 1,
    projectionKey: "warmIndexReuse",
    appliesTo: { pluginIds: ["x"] },
    text: { title: "Test", whenAbsent: "omit" },
    build: () => null,
    renderText: () => undefined,
    renderHtml: () => "",
    ...overrides,
  } as ReportSectionDescriptorV1;
}

beforeEach(() => {
  scalingControl.mode = "real";
});

describe("report section registry contract", () => {
  it("registers the eight specialized report families in deterministic order", () => {
    const registry = getSpecializedReportSectionRegistry();
    expect(registry.descriptors.map((descriptor) => descriptor.id)).toEqual(EXPECTED_ORDER);
    expect(new Set(registry.descriptors.map((descriptor) => descriptor.projectionKey)).size).toBe(8);
    expect(SPECIALIZED_REPORT_SECTION_DESCRIPTORS).toHaveLength(8);
  });

  it("orders by order then id regardless of registration order", () => {
    const registry = createReportSectionRegistry([
      stubDescriptor({ id: "b.second", order: 5, projectionKey: "warmIndexReuse" }),
      stubDescriptor({ id: "a.first", order: 5, projectionKey: "contextWindowScaling" }),
      stubDescriptor({ id: "c.zero", order: 1, projectionKey: "agentSuccessRate" }),
    ]);
    expect(registry.descriptors.map((descriptor) => descriptor.id)).toEqual(["c.zero", "a.first", "b.second"]);
  });

  it("rejects duplicate ids, duplicate projection keys and invalid descriptors", () => {
    expect(() => createReportSectionRegistry([stubDescriptor(), stubDescriptor({ projectionKey: "contextWindowScaling" })])).toThrow(
      /Duplicate report section registration: test\.section/
    );
    expect(() =>
      createReportSectionRegistry([stubDescriptor(), stubDescriptor({ id: "test.other" })])
    ).toThrow(/Duplicate report section projection key/);
    expect(() => createReportSectionRegistry([stubDescriptor({ id: "Bad Id" })])).toThrow(/Invalid report section registration/);
    expect(() => createReportSectionRegistry([stubDescriptor({ order: 1.5 })])).toThrow(/order must be an integer/);
    expect(() => createReportSectionRegistry([stubDescriptor({ appliesTo: { pluginIds: [] } })])).toThrow(/pluginIds/);
    expect(() =>
      createReportSectionRegistry([stubDescriptor({ build: undefined as unknown as ReportSectionDescriptorV1["build"] })])
    ).toThrow(/build must be a function/);
    expect(() =>
      createReportSectionRegistry([stubDescriptor({ text: { title: null, whenAbsent: "placeholder" } })])
    ).toThrow(/requires a title/);
  });

  it("is immutable after assembly", () => {
    const registry = getSpecializedReportSectionRegistry();
    expect(Object.isFrozen(registry)).toBe(true);
    expect(Object.isFrozen(registry.descriptors)).toBe(true);
    expect(Object.isFrozen(registry.descriptors[0])).toBe(true);
    expect(() => (registry.descriptors as ReportSectionDescriptorV1[]).push(stubDescriptor())).toThrow();
  });

  it("resolves availability from runtime evidence and reports unknown sections as unsupported", () => {
    const registry = getSpecializedReportSectionRegistry();
    const unknown = build(makeRun("custom-plugin"));
    expect(registry.resolve(unknown).every((section) => section.availability === "not-applicable")).toBe(true);
    expect(registry.resolveById("future.unknown-family", unknown)).toMatchObject({ availability: "unsupported", descriptor: null });

    const csc = build(makeRun("context-strategy-comparison"));
    expect(registry.resolveById("context-strategy.v043", csc).availability).toBe("available");
    expect(registry.resolveById("context-window.scaling", csc).availability).toBe("not-applicable");

    // Plugin applies but the projection is absent: unavailable evidence, not success and not not-applicable.
    const noEvidence = build(makeRun("context-strategy-comparison", false, false));
    expect(noEvidence.contextStrategyComparisonV043).toBeNull();
    expect(registry.resolveById("context-strategy.v043", noEvidence).availability).toBe("unavailable");
    const base = build(makeRun("custom-plugin"));
    const missing = { ...base, plugin: { ...base.plugin, id: "context-window-scaling" }, contextWindowScaling: null };
    expect(registry.resolveById("context-window.scaling", missing).availability).toBe("unavailable");
  });
});

describe("registry-driven report generation", () => {
  it("uses the registry descriptor to invoke the existing family builder", () => {
    scalingControl.mode = "sentinel";
    const report = build(makeRun("context-window-scaling"));
    expect(report.contextWindowScaling).toMatchObject({ sentinel: true, pluginId: "context-window-scaling" });
  });

  it("does not swallow required projection errors", () => {
    scalingControl.mode = "throw";
    expect(() => build(makeRun("context-window-scaling"))).toThrow("required projection failed");
  });

  it("renders context-strategy V043 evidence through the registry in both text and HTML", () => {
    const report = build(makeRun("context-strategy-comparison"));
    expect(report.contextStrategyComparisonV043).not.toBeNull();
    const text = renderPluginExperimentReportText(report);
    const html = renderPluginExperimentReportHtml(report);
    expect(text).toContain("V0.4.3 Stage-Context Evidence");
    expect(html).toContain("V0.4.3 Stage-Context Evidence");
    expect(text).not.toContain("V0.4.3 Stage-Context Evidence\nNot applicable");
  });

  it("text and HTML make the same specialization decision for an unknown plugin", () => {
    const report = build(makeRun("custom-plugin"));
    expect(report.interpretation.summary).toBe("Experiment custom-plugin finished with status completed.");
    const text = renderPluginExperimentReportText(report);
    const html = renderPluginExperimentReportHtml(report);
    for (const title of [
      "V0.4.3 Stage-Context Evidence",
      "Warm Index Reuse Evidence",
      "Incremental-Change And Staleness Evidence",
      "Context Window Scaling",
      "Retrieval Precision/Recall",
    ]) {
      expect(text).toContain(`${title}\nNot applicable to this plugin.`);
      expect(html).toMatch(new RegExp(`<h2>${title.replace("/", "\\/")}</h2>\\s*<p>Not applicable to this plugin.</p>`));
    }
    // Established presentation: the query-strategy text keeps its placeholder; HTML and the pack/agent
    // families stay silent for other plugins.
    expect(text).toContain("Retrieval Query Strategy Comparison\nNot applicable to this plugin.");
    expect(text).not.toContain("Context Pack Generation");
    expect(html).not.toContain("Context Pack Generation");
    expect(html).not.toContain("Retrieval Query Strategy Comparison");
  });

  it("keeps the JSON schema shape and external-local redaction", () => {
    const report = build(makeRun("custom-plugin", true));
    expect(Object.keys(report).sort()).toEqual(
      [
        "agentSuccessRate",
        "artifacts",
        "cases",
        "contextPackGeneration",
        "contextStrategyComparisonV043",
        "contextWindowScaling",
        "failures",
        "findings",
        "incrementalChangeStaleness",
        "interpretation",
        "metadata",
        "metrics",
        "plugin",
        "rawRun",
        "retrievalPrecisionRecall",
        "retrievalQueryStrategyComparison",
        "skippedOutcomes",
        "summary",
        "target",
        "variants",
        "warmIndexReuse",
        "warnings",
      ].sort()
    );
    expect(report.target.privacyProjection).toBe("external-local-redacted");
    expect(renderPluginExperimentReportHtml(report)).toContain("<td>redacted</td>");
  });
});
