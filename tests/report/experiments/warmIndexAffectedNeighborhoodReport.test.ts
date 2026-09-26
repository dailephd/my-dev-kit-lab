import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { ExperimentRun } from "../../../src/experiments/index.js";
import { executeWarmIndexReuse } from "../../../src/experiments/plugins/warmIndexReuse/execution.js";
import { summarizeProjectExecution } from "../../../src/experiments/plugins/warmIndexReuse/executionArtifact.js";
import {
  availableMetric,
  calculateWarmIndexMetrics,
  warmIndexReuseMetadata,
  type WarmIndexProjectSummaryV1,
  type WarmIndexReuseRun,
  type WarmIndexTaskSummaryV1,
} from "../../../src/experiments/plugins/warmIndexReuse/index.js";
import {
  buildPluginExperimentReport,
  buildWarmIndexReuseReport,
  renderPluginExperimentReportHtml,
  renderPluginExperimentReportText,
} from "../../../src/report/index.js";
import { makeAssessment } from "../../experiments/warmIndexReuse/affectedNeighborhoodTestHelpers.js";
import { makeCase, writeGraphFakeKit } from "../../experiments/warmIndexReuse/warmIndexTestHelpers.js";

const tempDirs: string[] = [];
afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});
function tempDir(prefix: string): string {
  const dir = mkdtempSync(path.join(os.tmpdir(), prefix));
  tempDirs.push(dir);
  return dir;
}

const METHOD = "estimated_chars_div_4";

function taskSummary(caseId: string, overrides: Partial<WarmIndexTaskSummaryV1> = {}): WarmIndexTaskSummaryV1 {
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

function projectSummary(tasks: WarmIndexTaskSummaryV1[]): WarmIndexProjectSummaryV1 {
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

function makeRun(projects: WarmIndexProjectSummaryV1[]): WarmIndexReuseRun {
  return {
    runId: "run-1",
    pluginId: "warm-index-reuse",
    startedAt: "2026-09-26T00:00:00.000Z",
    completedAt: "2026-09-26T00:00:01.000Z",
    status: "completed",
    target: {
      kind: "self",
      targetRoot: "/t",
      toolRoot: "/t",
      packageName: null,
      packageVersion: null,
      hasPackageJson: false,
      hasLockfile: false,
      branch: null,
      commit: null,
      hasGit: false,
      isSelf: true,
    },
    variants: [],
    cases: [],
    metrics: [],
    artifacts: [],
    warnings: [],
    failures: [],
    projectExecutions: projects,
    warmIndexMetrics: calculateWarmIndexMetrics(projects),
  } as unknown as WarmIndexReuseRun;
}

const build = (tasks: WarmIndexTaskSummaryV1[]) => buildWarmIndexReuseReport(makeRun([projectSummary(tasks)]))!;

const partialTaskMapping = () => ({
  ...makeAssessment().taskMapping,
  status: "partial" as const,
  unresolvedCount: 1,
  unresolved: [{ subject: "expected-symbol" as const, name: "ghost", reason: "graph-node-missing" as const }],
  resolvedTaskNodeIds: ["file:src/a.ts"],
  resolvableTaskNodeCount: 1,
});

describe("warm-index report affected-neighborhood presentation", () => {
  // TST-B3-026, TST-B3-037
  it("presents the persisted status, relationship, and recommendation exactly, including partial + related", () => {
    const persisted = makeAssessment({
      status: "partial",
      freshnessStatus: "partially-stale",
      seedMappingStatus: "partial",
      graphEvidenceStatus: "partial",
      neighborhoodStatus: "partial",
      changedFileCount: 1,
      changedSymbolCount: 2,
      seedNodeCount: 1,
      affectedNodeCount: 3,
      affectedEdgeCount: 2,
      affectedNodeIds: ["file:src/a.ts", "file:src/b.ts", "symbol:src/a.ts#alpha"],
      participatingEdgeIds: ["e1", "e2"],
      taskOverlapCount: 1,
      taskOverlapNodeIds: ["file:src/a.ts"],
      taskOverlapPercent: 100,
      taskMapping: partialTaskMapping(),
      relationship: "related",
      reindexRecommendation: "recommended",
    });

    const block = build([taskSummary("t1", { affectedNeighborhood: persisted })]).projects[0].tasks[0].affectedNeighborhood!;

    expect(block).toMatchObject({
      status: "partial",
      freshnessStatus: "partially-stale",
      seedMappingStatus: "partial",
      graphEvidenceStatus: "partial",
      neighborhoodStatus: "partial",
      taskMappingStatus: "partial",
      resolvableTaskNodeCount: 1,
      relationship: "related",
      reindexRecommendation: "recommended",
    });
    expect(block.unresolvedTaskMappings).toEqual({ totalCount: 1, displayedCount: 1, omittedCount: 0, items: [{ subject: "expected-symbol", name: "ghost", reason: "graph-node-missing" }] });
  });

  // TST-B3-027
  it("renders the metric owner's objects, not values re-derived from the assessment", () => {
    const run = makeRun([projectSummary([taskSummary("t1", { affectedNeighborhood: makeAssessment({ taskOverlapCount: 3 }) })])]);
    // The metric layer is the sole owner: a different owner-provided value must be what the report shows.
    run.warmIndexMetrics!.projects[0].tasks[0].warm.taskOverlapCount = availableMetric(42, "count", "derived");

    const block = buildWarmIndexReuseReport(run)!.projects[0].tasks[0].affectedNeighborhood!;

    expect(block.metrics.taskOverlapCount.value).toBe(42);
    expect(block.metrics.taskOverlapCount).toBe(run.warmIndexMetrics!.projects[0].tasks[0].warm.taskOverlapCount);
    expect(block.metrics.changedFileCount).toBe(run.warmIndexMetrics!.projects[0].tasks[0].warm.changedFileCount);
  });

  // TST-B3-028, TST-B3-029, TST-B3-030
  it.each([
    ["recommended", "related", "Reindex recommended: the task has confirmed overlap with the affected one-hop baseline graph neighborhood."],
    ["not-indicated", "unrelated", "Reindex not indicated by this bounded analysis: complete evidence found no task-node overlap with the affected neighborhood."],
    [
      "unknown",
      "unknown",
      "Reindex recommendation unknown: evidence is incomplete or unavailable, so absence of observed overlap is not sufficient to conclude that the task is unaffected.",
    ],
  ] as const)("explains %s with the fixed neutral wording", (recommendation, relationship, wording) => {
    const block = build([taskSummary("t1", { affectedNeighborhood: makeAssessment({ relationship, reindexRecommendation: recommendation }) })]).projects[0].tasks[0].affectedNeighborhood!;

    expect(block.recommendationExplanation).toBe(wording);
    expect(wording).not.toMatch(/mandatory|guarantee|always safe|universally|whole repository is fresh/i);
  });

  // TST-B3-031
  it("reports fresh + complete empty neighborhood + incomplete task mapping as unknown / unknown", () => {
    const persisted = makeAssessment({ status: "partial", taskMapping: partialTaskMapping(), relationship: "unknown", reindexRecommendation: "unknown" });

    const report = build([taskSummary("t1", { affectedNeighborhood: persisted })]);
    const block = report.projects[0].tasks[0].affectedNeighborhood!;

    expect(block).toMatchObject({ freshnessStatus: "fresh", neighborhoodStatus: "complete", taskMappingStatus: "partial", relationship: "unknown", reindexRecommendation: "unknown" });
    expect(block.reindexRecommendation).not.toBe("not-indicated");
    expect(report.affectedNeighborhoodSummary.notIndicatedReindexCount).toBe(0);
  });

  // TST-B3-032
  it("counts assessed/unassessed, status, relationship, and recommendation categories", () => {
    const report = build([
      taskSummary("t1", { affectedNeighborhood: makeAssessment() }),
      taskSummary("t2", { affectedNeighborhood: makeAssessment({ status: "partial", relationship: "related", reindexRecommendation: "recommended" }) }),
      taskSummary("t3", { affectedNeighborhood: makeAssessment({ status: "unavailable", relationship: "unknown", reindexRecommendation: "unknown" }) }),
      taskSummary("t4", { affectedNeighborhood: null }),
      taskSummary("t5"),
    ]);

    expect(report.affectedNeighborhoodSummary).toEqual({
      assessedTaskCount: 3,
      unassessedTaskCount: 2,
      completeAssessmentCount: 1,
      partialAssessmentCount: 1,
      unavailableAssessmentCount: 1,
      relatedTaskCount: 1,
      unrelatedTaskCount: 1,
      unknownRelationshipTaskCount: 1,
      recommendedReindexCount: 1,
      notIndicatedReindexCount: 1,
      unknownReindexRecommendationCount: 1,
    });
  });

  // TST-B3-033
  it("bounds displayed identities and diagnostics while preserving totals and omitted counts", () => {
    const ids = (prefix: string, count: number) => Array.from({ length: count }, (_, index) => `${prefix}${String(index).padStart(3, "0")}`);
    const unresolved = Array.from({ length: 15 }, (_, index) => ({ subject: "expected-symbol" as const, name: `s${index}`, reason: "graph-node-missing" as const }));
    const ambiguous = Array.from({ length: 12 }, (_, index) => ({ name: `d${index}`, candidateNodeIds: ["x", "y"] }));
    const warnings = Array.from({ length: 14 }, (_, index) => ({ code: "task-mapping-partial" as const, message: `w${index}` }));
    const persisted = makeAssessment({
      affectedNodeIds: ids("n", 45),
      participatingEdgeIds: ids("e", 33),
      taskMapping: { ...makeAssessment().taskMapping, unresolvedCount: 25, unresolved, ambiguousCount: 12, ambiguousSymbols: ambiguous },
      warningCount: 14,
      warnings,
    });

    const block = build([taskSummary("t1", { affectedNeighborhood: persisted })]).projects[0].tasks[0].affectedNeighborhood!;

    expect(block.affectedNodeIds).toMatchObject({ totalCount: 45, displayedCount: 20, omittedCount: 25 });
    expect(block.participatingEdgeIds).toMatchObject({ totalCount: 33, displayedCount: 20, omittedCount: 13 });
    // The persisted total (25) exceeds the persisted list (15); the total is preserved.
    expect(block.unresolvedTaskMappings).toMatchObject({ totalCount: 25, displayedCount: 10, omittedCount: 15 });
    expect(block.ambiguousTaskSymbols).toMatchObject({ totalCount: 12, displayedCount: 10, omittedCount: 2 });
    expect(block.warnings).toMatchObject({ totalCount: 14, displayedCount: 10, omittedCount: 4 });
    // The persisted evidence itself is untouched.
    expect(persisted.affectedNodeIds).toHaveLength(45);
  });

  // TST-B3-034
  it("is presentation-only: it copies persisted evidence and its module has no runtime filesystem, process, or analysis imports", () => {
    // An internally inconsistent persisted assessment is echoed as persisted, proving nothing is recomputed.
    const inconsistent = makeAssessment({ freshnessStatus: "stale", seedNodeCount: 0, affectedNodeCount: 99, taskOverlapCount: 7, relationship: "unrelated", reindexRecommendation: "not-indicated" });
    const block = build([taskSummary("t1", { affectedNeighborhood: inconsistent })]).projects[0].tasks[0].affectedNeighborhood!;

    expect(block.freshnessStatus).toBe("stale");
    expect(block.relationship).toBe("unrelated");
    expect(block.reindexRecommendation).toBe("not-indicated");

    const source = readFileSync(path.resolve(process.cwd(), "src/report/experiments/buildWarmIndexReuseReport.ts"), "utf8");
    const runtimeImports = source.split(/\r?\n/).filter((line) => /^import\s+(?!type\b)/.test(line));
    expect(runtimeImports.join("\n")).not.toMatch(/node:fs|node:child_process|node:path|node:crypto|affectedNeighborhood|indexFreshness|indexSnapshot|runMyDevKit/);
    expect(source).not.toMatch(/readFileSync|createReadStream|spawn\(|execFile/);
  });

  // TST-B3-035
  it("treats a legacy task without the key, or a null, as not assessed rather than unknown", () => {
    const legacy = taskSummary("t1");
    expect("affectedNeighborhood" in legacy).toBe(false);

    const report = build([legacy, taskSummary("t2", { affectedNeighborhood: null })]);

    expect(report.projects[0].tasks.map((task) => task.affectedNeighborhood)).toEqual([null, null]);
    expect(report.affectedNeighborhoodSummary).toMatchObject({ assessedTaskCount: 0, unassessedTaskCount: 2, unknownRelationshipTaskCount: 0 });
    const parsed = JSON.parse(JSON.stringify(report)) as typeof report;
    expect(parsed.projects[0].tasks[0].affectedNeighborhood).toBeNull();
  });

  it("renders older serialized reports that lack the new summary field as having no assessment", () => {
    const report = build([taskSummary("t1")]);
    const legacyReport = JSON.parse(JSON.stringify(report)) as Record<string, unknown>;
    delete legacyReport.affectedNeighborhoodSummary;
    const run = makeRun([projectSummary([taskSummary("t1")])]);
    const pluginReport = buildPluginExperimentReport({ run, plugin: warmIndexReuseMetadata });
    const withLegacy = { ...pluginReport, warmIndexReuse: legacyReport as unknown as typeof report };

    expect(renderPluginExperimentReportText(withLegacy)).toContain("Unassessed Tasks: 1");
    expect(renderPluginExperimentReportHtml(withLegacy)).toContain("Unassessed tasks");
  });

  // TST-B3-036
  it("keeps unavailable affected-neighborhood metrics unavailable with null values in the report model", () => {
    const unavailable = makeAssessment({ status: "unavailable", seedMappingStatus: "unavailable", neighborhoodStatus: "unavailable", affectedNodeCount: null, affectedEdgeCount: null, taskOverlapCount: null, taskOverlapPercent: null, relationship: "unknown", reindexRecommendation: "unknown" });

    const block = build([taskSummary("t1", { affectedNeighborhood: unavailable })]).projects[0].tasks[0].affectedNeighborhood!;

    for (const metric of [block.metrics.affectedNodeCount, block.metrics.affectedEdgeCount, block.metrics.taskOverlapCount, block.metrics.taskOverlapPercent]) {
      expect(metric.availability).toBe("unavailable");
      expect(metric.value).toBeNull();
      expect(metric.reason).toBeTruthy();
    }
    expect(block.metrics.changedFileCount).toMatchObject({ availability: "available", value: 0 });
  });

  it("appears in report.json, the text report, and the HTML report with the neutral interpretation", () => {
    const run = makeRun([
      projectSummary([
        taskSummary("t1", { affectedNeighborhood: makeAssessment({ status: "partial", relationship: "related", reindexRecommendation: "recommended", taskOverlapCount: 1, taskOverlapPercent: 50 }) }),
        taskSummary("t2"),
      ]),
    ]);
    const report = buildPluginExperimentReport({ run, plugin: warmIndexReuseMetadata });
    const text = renderPluginExperimentReportText(report);
    const html = renderPluginExperimentReportHtml(report);

    expect(report.warmIndexReuse?.affectedNeighborhoodSummary.relatedTaskCount).toBe(1);
    expect(report.interpretation.summary).toContain("Affected-neighborhood evidence was available for 1 task boundary: complete=0, partial=1, unavailable=0;");
    expect(report.interpretation.summary).toContain("relationships were related=1, unrelated=0, unknown=0; reindex recommendations were recommended=1, not-indicated=0, unknown=0.");
    expect(report.interpretation.summary).toContain("It is observational and does not alter retrieval or execution status.");
    expect(report.interpretation.summary).not.toMatch(/winner|best|safe to skip/i);
    expect(text).toContain("Affected Neighborhood Summary");
    expect(text).toContain("Reindex Recommendation: recommended");
    expect(text).toContain("Task-Overlap Percent: 50 percent (derived)");
    expect(text).toContain("Affected Neighborhood Status: not assessed");
    expect(html).toContain("<h3>Affected Neighborhood</h3>");
    expect(html).toContain("Reindex recommended: the task has confirmed overlap");
    expect(html).toContain("not assessed");
    expect(JSON.stringify(report.warmIndexReuse)).toContain('"affectedNeighborhood"');
  });
});

describe("warm-index affected-neighborhood end to end (execution -> metrics -> report)", () => {
  const SYMBOLS = { "src/a.ts": ["alpha"], "src/b.ts": ["beta"] };
  function makeTarget() {
    const targetRoot = path.join(tempDir("warm-an-e2e-target-"), "target");
    mkdirSync(path.join(targetRoot, "src"), { recursive: true });
    writeFileSync(path.join(targetRoot, "src", "a.ts"), "export const alpha = 1;\n");
    writeFileSync(path.join(targetRoot, "src", "b.ts"), "export const beta = 2;\n");
    return { targetRoot, changed: path.join(targetRoot, "src", "a.ts") };
  }
  const caseOf = (targetRoot: string, id: string, files: string[], symbols: string[]) =>
    makeCase({ id, benchmarkProject: "todo-ts", targetRoot, absoluteTargetRoot: targetRoot, sourceRoots: ["src"], rawIncludeGlobs: ["src/**/*"], expectedFiles: files, expectedSymbols: symbols });

  async function runToReport(cases: (root: string) => ReturnType<typeof caseOf>[], mutate = false) {
    const { targetRoot, changed } = makeTarget();
    const kit = writeGraphFakeKit(tempDir("warm-an-e2e-kit-"), { symbols: SYMBOLS, edges: [["file:src/a.ts", "file:src/b.ts", "imports"]], mutateOnFirstSearch: mutate ? changed : undefined });
    const projects = await executeWarmIndexReuse({ cases: cases(targetRoot), kitCommand: kit.command, outputRoot: tempDir("warm-an-e2e-out-") });
    const summaries = projects.map(summarizeProjectExecution);
    return { report: buildWarmIndexReuseReport(makeRun(summaries))!, metrics: calculateWarmIndexMetrics(summaries), run: makeRun(summaries) };
  }

  // TST-B3-038
  it("carries a real confirmed changed-file overlap through metrics into a related / recommended report block", async () => {
    const { report, metrics } = await runToReport((root) => [caseOf(root, "e2e-1", ["src/a.ts"], ["alpha"]), caseOf(root, "e2e-2", ["src/a.ts"], ["alpha"])], true);
    const [first, second] = report.projects[0].tasks;

    expect(first.affectedNeighborhood).toMatchObject({ status: "complete", relationship: "unrelated", reindexRecommendation: "not-indicated" });
    expect(first.affectedNeighborhood?.metrics.taskOverlapPercent).toMatchObject({ availability: "available", value: 0, unit: "percent" });
    expect(second.affectedNeighborhood).toMatchObject({ status: "complete", freshnessStatus: "stale", relationship: "related", reindexRecommendation: "recommended" });
    expect(second.affectedNeighborhood?.metrics.taskOverlapCount).toMatchObject({ availability: "available", value: 2 });
    expect(second.affectedNeighborhood?.metrics.changedFileCount.value).toBe(1);
    expect(second.affectedNeighborhood?.metrics.affectedNodeCount.value).toBe(3);
    expect(second.affectedNeighborhood?.metrics.taskOverlapPercent.value).toBe(100);
    // The report's numbers are the metric owner's objects.
    expect(second.affectedNeighborhood?.metrics.taskOverlapCount).toEqual(metrics.projects[0].tasks[1].warm.taskOverlapCount);
    expect(report.affectedNeighborhoodSummary).toMatchObject({ assessedTaskCount: 2, relatedTaskCount: 1, unrelatedTaskCount: 1, recommendedReindexCount: 1, notIndicatedReindexCount: 1 });
  });

  // TST-B3-031, TST-B3-039
  it("keeps zero overlap under an unresolved expected symbol unknown / unknown, even on a fresh index", async () => {
    const { report } = await runToReport((root) => [caseOf(root, "e2e-1", ["src/a.ts", "src/b.ts"], ["alpha", "findDuplicate", "createTask"])]);
    const block = report.projects[0].tasks[0].affectedNeighborhood!;

    expect(block.freshnessStatus).toBe("fresh");
    expect(block.neighborhoodStatus).toBe("complete");
    expect(block.taskMappingStatus).toBe("partial");
    expect(block.unresolvedTaskMappings.items.map((entry) => entry.name)).toEqual(["createTask", "findDuplicate"]);
    expect(block.relationship).toBe("unknown");
    expect(block.reindexRecommendation).toBe("unknown");
    expect(block.metrics.taskOverlapCount).toMatchObject({ availability: "available", value: 0 });
  });

  // TST-B3-040
  it("leaves warm retrieval, statuses, and pre-v0.6.1 metrics unchanged", async () => {
    const { report } = await runToReport((root) => [caseOf(root, "e2e-1", ["src/a.ts"], ["alpha"])]);
    const [task] = report.projects[0].tasks;

    expect(task.rawStatus).toBe("completed");
    expect(task.warmStatus).toBe("completed");
    expect(task.warm.contextCharacters.availability).toBe("available");
    expect(task.warm.retrievalDurationMs.availability).toBe("available");
    expect(task.indexFreshness?.status).toBe("fresh");
  });

  it("is not part of the generic run metrics", async () => {
    const { run } = await runToReport((root) => [caseOf(root, "e2e-1", ["src/a.ts"], ["alpha"])]);

    expect((run as ExperimentRun).metrics.map((metric) => metric.id).join(" ")).not.toContain("affected-neighborhood");
  });
});
