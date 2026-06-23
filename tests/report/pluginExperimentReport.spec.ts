import { existsSync, mkdtempSync } from "node:fs";
import { readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { ExperimentRun, ExperimentTarget } from "../../src/experiments/index.js";
import { contextStrategyComparisonMetadata } from "../../src/experiments/plugins/contextStrategyComparison/index.js";
import {
  buildPluginExperimentReport,
  renderPluginExperimentReportHtml,
  writePluginExperimentReports,
} from "../../src/report/index.js";

const tempDirs: string[] = [];

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

describe("plugin-aware experiment reports", () => {
  it("builds a structured JSON model with plugin, target, variants, cases, metrics, artifacts, warnings, skips, and failures", () => {
    const run = makePluginRun({ target: makeTarget({ isSelf: false }) });
    const report = buildPluginExperimentReport({
      run,
      plugin: contextStrategyComparisonMetadata,
      outputRoot: "lab-output/experiments/context-strategy-comparison/target/run",
      generatedAt: "2026-06-23T00:00:00.000Z",
    });

    expect(report.plugin.id).toBe("context-strategy-comparison");
    expect(report.target.mode).toBe("external target");
    expect(report.target.packageName).toBe("@dailephd/my-dev-kit");
    expect(report.variants.map((variant) => variant.id).sort()).toEqual([
      "my-dev-kit-guided",
      "raw-full-file",
    ]);
    expect(report.cases[0]).toEqual(expect.objectContaining({ id: "case-1", status: "partial" }));
    expect(report.metrics.map((metric) => metric.id)).toContain("average-token-savings-percent");
    expect(report.artifacts[0].path).toBe("experiment-summary.json");
    expect(report.warnings).toHaveLength(1);
    expect(report.failures).toHaveLength(1);
    expect(report.skippedOutcomes).toHaveLength(1);
    expect(report.findings.map((finding) => finding.severity).sort()).toEqual([
      "failure",
      "skip",
      "warning",
    ]);
  });

  it("renders human-readable HTML with plugin and target summaries", () => {
    const report = buildPluginExperimentReport({
      run: makePluginRun({ target: makeTarget({ isSelf: true }) }),
      plugin: contextStrategyComparisonMetadata,
      outputRoot: "lab-output/experiments/context-strategy-comparison/self/run",
      generatedAt: "2026-06-23T00:00:00.000Z",
    });
    const html = renderPluginExperimentReportHtml(report);

    expect(html).toContain("Context Strategy Comparison");
    expect(html).toContain("context-strategy-comparison");
    expect(html).toContain("Mode");
    expect(html).toContain("self");
    expect(html).toContain("Tool root");
    expect(html).toContain("Target root");
    expect(html).toContain("raw-full-file vs my-dev-kit-guided");
    expect(html).toContain("Warnings, Skips, And Failures");
    expect(html).toContain("outcome-skipped");
    expect(html).not.toContain("<script>");
    expect(html).not.toMatch(/https?:\/\//);
  });

  it("writes report.json and report.html under the output root", async () => {
    const outDir = mkdtempSync(path.join(os.tmpdir(), "plugin-report-"));
    tempDirs.push(outDir);
    const result = await writePluginExperimentReports({
      run: makePluginRun({ target: makeTarget({ isSelf: false }), outputRoot: outDir }),
      plugin: contextStrategyComparisonMetadata,
      outputRoot: outDir,
      generatedAt: "2026-06-23T00:00:00.000Z",
    });

    expect(result.outputPaths.jsonPath).toBe(path.join(outDir, "report.json"));
    expect(result.outputPaths.htmlPath).toBe(path.join(outDir, "report.html"));
    expect(existsSync(result.outputPaths.jsonPath)).toBe(true);
    expect(existsSync(result.outputPaths.htmlPath)).toBe(true);
    const payload = JSON.parse(await readFile(result.outputPaths.jsonPath, "utf8")) as {
      report: { plugin: { id: string }; target: { targetRoot: string }; artifacts: Array<{ path?: string }> };
    };
    expect(payload.report.plugin.id).toBe("context-strategy-comparison");
    expect(payload.report.target.targetRoot).toBe("Z:\\Users\\newuser\\Projects\\my-dev-kit-v1");
    expect(payload.report.artifacts[0].path).toBe("experiment-summary.json");
  });

  it("keeps reports for different targets in separate output roots", async () => {
    const root = mkdtempSync(path.join(os.tmpdir(), "plugin-report-roots-"));
    tempDirs.push(root);
    const firstOut = path.join(root, "target-one", "run-1");
    const secondOut = path.join(root, "target-two", "run-1");
    const first = await writePluginExperimentReports({
      run: makePluginRun({ target: makeTarget({ targetRoot: "Z:\\Projects\\one" }), outputRoot: firstOut }),
      plugin: contextStrategyComparisonMetadata,
      outputRoot: firstOut,
    });
    const second = await writePluginExperimentReports({
      run: makePluginRun({ target: makeTarget({ targetRoot: "Z:\\Projects\\two" }), outputRoot: secondOut }),
      plugin: contextStrategyComparisonMetadata,
      outputRoot: secondOut,
    });

    expect(first.outputPaths.jsonPath).not.toBe(second.outputPaths.jsonPath);
    expect(existsSync(first.outputPaths.jsonPath)).toBe(true);
    expect(existsSync(second.outputPaths.jsonPath)).toBe(true);
  });
});

function makePluginRun(args: { target: ExperimentTarget; outputRoot?: string }): ExperimentRun {
  const outputRoot = args.outputRoot ?? "lab-output/experiments/context-strategy-comparison/target/run";
  return {
    runId: "context-run",
    pluginId: "context-strategy-comparison",
    startedAt: "2026-06-23T00:00:00.000Z",
    completedAt: "2026-06-23T00:00:01.000Z",
    status: "partial",
    target: args.target,
    variants: [
      { id: "raw-full-file", name: "Raw Full File" },
      { id: "my-dev-kit-guided", name: "My Dev Kit Guided" },
    ],
    cases: [
      {
        id: "case-1",
        name: "Case 1",
        outcomes: [
          {
            id: "raw-run",
            caseId: "case-1",
            variantId: "raw-full-file",
            status: "completed",
            metrics: [{ id: "correctness-score", name: "Correctness score", value: 1 }],
            artifacts: [],
            warnings: [],
            failures: [],
          },
          {
            id: "guided-run",
            caseId: "case-1",
            variantId: "my-dev-kit-guided",
            status: "skipped",
            metrics: [],
            artifacts: [],
            warnings: [{ code: "agent-skipped", message: "Agent unavailable" }],
            failures: [],
          },
        ],
      },
    ],
    metrics: [
      { id: "average-token-savings-percent", name: "Average token savings", value: 42, unit: "percent" },
      { id: "average-correctness-delta", name: "Average correctness delta", value: 0 },
      { id: "average-duration-reduction-percent", name: "Average duration reduction", value: 10, unit: "percent" },
    ],
    artifacts: [
      {
        id: "legacy-summary",
        label: "Experiment summary",
        path: path.join(outputRoot, "experiment-summary.json"),
        kind: "json",
      },
    ],
    warnings: [{ code: "sample-warning", message: "A warning" }],
    failures: [{ code: "sample-failure", message: "A failure", recoverable: true }],
    summary: {
      status: "partial",
      totalCases: 1,
      completedCases: 0,
      partialCases: 1,
      failedCases: 0,
      skippedCases: 0,
      metrics: [],
      warnings: [],
      failures: [],
    },
    metadata: {
      outputRoot,
      pluginSchemaVersion: "1.0.0",
    },
  };
}

function makeTarget(overrides: Partial<ExperimentTarget> = {}): ExperimentTarget {
  const isSelf = overrides.isSelf ?? false;
  const targetRoot = overrides.targetRoot ?? (isSelf
    ? "Z:\\Users\\newuser\\Projects\\my-dev-kit-lab"
    : "Z:\\Users\\newuser\\Projects\\my-dev-kit-v1");
  return {
    kind: isSelf ? "self" : "external-local",
    toolRoot: "Z:\\Users\\newuser\\Projects\\my-dev-kit-lab",
    targetRoot,
    packageName: "@dailephd/my-dev-kit",
    packageVersion: "1.2.0",
    hasPackageJson: true,
    hasLockfile: true,
    branch: "main",
    commit: "abc1234",
    hasGit: true,
    isSelf,
    ...overrides,
  };
}

