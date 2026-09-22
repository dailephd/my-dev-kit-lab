import { mkdtempSync, readFileSync } from "node:fs";
import { rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import {
  contextStrategyComparisonMetadata,
  createDefaultExperimentPluginRegistry,
  runExperiment,
  type ExperimentRun,
} from "../../../src/experiments/index.js";
import {
  calculateWarmIndexMetrics,
  type WarmIndexAgentSideEvidenceV1,
  type WarmIndexProjectAgentEvidenceV1,
  warmIndexReuseMetadata,
  type WarmIndexProjectSummaryV1,
  type WarmIndexReuseRun,
} from "../../../src/experiments/plugins/warmIndexReuse/index.js";
import {
  buildPluginExperimentReport,
  buildWarmIndexReuseReport,
  renderPluginExperimentReportHtml,
  renderPluginExperimentReportText,
  writePluginExperimentReports,
} from "../../../src/report/index.js";
import {
  fakeKitCommand,
  loadBundledProjectProfiles,
  loadProductionWarmIndexCases,
  makeCase,
} from "../../experiments/warmIndexReuse/warmIndexTestHelpers.js";

const tempDirs: string[] = [];
afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

const METHOD = "estimated_chars_div_4";

function taskSummary(caseId: string, overrides: Partial<WarmIndexProjectSummaryV1["tasks"][number]> = {}) {
  return {
    caseId,
    status: "completed" as const,
    rawStatus: "completed" as const,
    warmStatus: "completed" as const,
    rawBaseline: {
      targetRoot: "/t",
      filesIncluded: ["a.ts"],
      totalFiles: 1,
      totalChars: 400,
      totalEstimatedTokens: 100,
      tokenCountMethod: METHOD,
      durationMs: 10,
    },
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

function projectSummary(overrides: Partial<WarmIndexProjectSummaryV1> = {}): WarmIndexProjectSummaryV1 {
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
    tasks: [taskSummary("t1"), taskSummary("t2")],
    warnings: [],
    errors: [],
    ...overrides,
  };
}

function agentSide(variantId: WarmIndexAgentSideEvidenceV1["variantId"], totalTokens: number | null = 250): WarmIndexAgentSideEvidenceV1 {
  return {
    variantId,
    agentId: "fake-agent",
    promptStrategy: variantId === "raw-full-file" ? "raw-full-file" : "my-dev-kit-guided",
    status: "completed",
    correctness: { available: true, score: 1, passed: true, failureReasons: [] },
    tokenUsage: {
      totalTokens,
      source: totalTokens === null ? "unavailable" : "agent-reported",
      reliability: totalTokens === null ? "unavailable" : "high",
    },
    durationMs: 1,
    warnings: [],
    errors: [],
    artifactPaths: {},
  };
}

function defaultAgentEvidence(projects: WarmIndexProjectSummaryV1[]): WarmIndexProjectAgentEvidenceV1[] {
  return projects.map((project) => ({
    benchmarkProject: project.benchmarkProject,
    tasks: project.tasks.map((task) => ({
      caseId: task.caseId,
      raw: task.rawBaseline ? agentSide("raw-full-file") : null,
      warm: task.warmRetrieval ? agentSide("warm-index-reuse") : null,
    })),
  }));
}

function makeWarmRun(
  projects: WarmIndexProjectSummaryV1[],
  status: ExperimentRun["status"] = "completed",
  agentEvidence: WarmIndexProjectAgentEvidenceV1[] = defaultAgentEvidence(projects)
): WarmIndexReuseRun {
  return {
    runId: "run-1",
    pluginId: "warm-index-reuse",
    startedAt: "2026-09-21T00:00:00.000Z",
    completedAt: "2026-09-21T00:00:01.000Z",
    status,
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
    agentEvidence,
    warmIndexMetrics: calculateWarmIndexMetrics(projects, agentEvidence),
  };
}

describe("buildWarmIndexReuseReport", () => {
  it("builds a summary, cost model, limitations, and ordered projects/tasks for warm runs", () => {
    const section = buildWarmIndexReuseReport(
      makeWarmRun([
        projectSummary(),
        projectSummary({ benchmarkProject: "todo-js", sessionKey: "todo-js", sessionPrepared: false, status: "partial" }),
      ])
    )!;
    expect(section.summary).toEqual(
      expect.objectContaining({ projectCount: 2, taskCount: 4, preparedSessionProjectCount: 1, incompleteProjectCount: 1 })
    );
    expect(section.projects.map((project) => [project.benchmarkProject, project.taskCount])).toEqual([
      ["todo-ts", 2],
      ["todo-js", 2],
    ]);
    expect(section.projects[0].tasks.map((task) => [task.taskOrdinal, task.caseId, task.rawStatus, task.warmStatus])).toEqual([
      [1, "t1", "completed", "completed"],
      [2, "t2", "completed", "completed"],
    ]);
    expect(section.costModel.join(" ")).toContain("one-time index build plus the first retrieval");
    expect(section.costModel.join(" ")).toContain("divided by N");
    expect(section.limitations).toHaveLength(7);
    expect(section.limitations.join(" ")).not.toContain("does not execute agents");
    expect(section.limitations.join(" ")).toContain("deterministic fake agent only");
    expect(section.limitations.join(" ")).toContain("simulated harness telemetry, not provider billing telemetry");
    expect(section.summary).toEqual(
      expect.objectContaining({ agentSideCount: 8, agentCorrectnessAvailableCount: 8, agentTotalTokensAvailableCount: 8 })
    );
    expect(section.projects[0].tasks[0].warmAgent).toEqual({
      status: "completed",
      passed: true,
      tokenUsageSource: "agent-reported",
      tokenUsageReliability: "high",
      warnings: [],
      errors: [],
    });
  });

  it("returns null for other plugins", () => {
    expect(buildWarmIndexReuseReport({ ...makeWarmRun([]), pluginId: "context-strategy-comparison" })).toBeNull();
  });

  it("renders the precomputed metrics instead of recalculating formulas", () => {
    const run = makeWarmRun([projectSummary()]);
    const sentinel = run.warmIndexMetrics.projects[0].tasks[1].warm;
    sentinel.amortizedIndexBuildDurationMs = { ...sentinel.amortizedIndexBuildDurationMs, value: 999 };
    sentinel.cumulativeComponentDurationMs = { ...sentinel.cumulativeComponentDurationMs, value: 777 };
    const section = buildWarmIndexReuseReport(run)!;
    expect(section.projects[0].tasks[1].warm.amortizedIndexBuildDurationMs.value).toBe(999);
    expect(section.projects[0].tasks[1].warm.cumulativeComponentDurationMs.value).toBe(777);
  });

  it("rejects inconsistent execution and metric sources", () => {
    const run = makeWarmRun([projectSummary()]);
    run.warmIndexMetrics.projects[0].tasks.pop();
    expect(() => buildWarmIndexReuseReport(run)).toThrow("inconsistent");
  });
});

describe("plugin report integration", () => {
  it("adds warmIndexReuse to warm reports and null to other plugins while keeping v0.4.3 key order", () => {
    const warm = buildPluginExperimentReport({ run: makeWarmRun([projectSummary()]), plugin: warmIndexReuseMetadata });
    expect(warm.warmIndexReuse?.summary.projectCount).toBe(1);
    const keys = Object.keys(warm);
    expect(keys.indexOf("interpretation")).toBe(keys.indexOf("contextStrategyComparisonV043") + 1);

    const other = buildPluginExperimentReport({
      run: { ...makeWarmRun([]), pluginId: "context-strategy-comparison" },
      plugin: contextStrategyComparisonMetadata,
    });
    expect(other.warmIndexReuse).toBeNull();
  });

  it("gives a neutral interpretation without winner, speed, or savings claims", () => {
    const completed = buildPluginExperimentReport({ run: makeWarmRun([projectSummary()]), plugin: warmIndexReuseMetadata });
    expect(completed.interpretation.summary).toContain("prepared 1 of 1 project indexes and evaluated 2 tasks");
    expect(completed.interpretation.summary).toContain("not provider token usage");
    expect(completed.interpretation.summary).toContain("Deterministic fake-agent correctness is available for 4 of 4 task sides");
    const partial = buildPluginExperimentReport({
      run: makeWarmRun([projectSummary({ sessionPrepared: false, status: "partial" })], "partial"),
      plugin: warmIndexReuseMetadata,
    });
    expect(partial.interpretation.recommendedNextStep).toContain("Inspect unavailable metrics");
    for (const report of [completed, partial]) {
      const text = `${report.interpretation.summary} ${report.interpretation.recommendedNextStep}`;
      expect(text).not.toMatch(/is better|winner|best-supported|faster overall|cheaper overall|saves tokens|speedup/i);
    }
  });

  it("renders the text section with metrics, availability reasons, limitations, and cost model", () => {
    const report = buildPluginExperimentReport({
      run: makeWarmRun([
        projectSummary(),
        projectSummary({ benchmarkProject: "broken", sessionKey: "broken", sessionPrepared: false, buildDurationMs: null, status: "partial", errors: ["roots differ"] }),
      ]),
      plugin: warmIndexReuseMetadata,
    });
    const text = renderPluginExperimentReportText(report);
    const sectionStart = text.indexOf("Warm Index Reuse Evidence");
    expect(sectionStart).toBeGreaterThan(text.indexOf("V0.4.3 Stage-Context Evidence"));
    expect(text.indexOf("Warnings, Skips, And Failures")).toBeGreaterThan(sectionStart);
    expect(text).toContain("Warm Index Project 1: todo-ts");
    expect(text).toContain("Index Build Duration: 100 ms (measured)");
    expect(text).toContain("Amortized Index Build Duration: 50 ms (derived)");
    expect(text).toContain("Cumulative Warm Component Duration: 104 ms (derived)");
    expect(text).toContain("Raw Estimated Context Tokens (estimate): 100 estimated-tokens (estimated-chars-div-4, method estimated_chars_div_4)");
    expect(text).toContain("Warm Agent Correctness (fake agent): 1 score (agent)");
    expect(text).toContain("Raw Agent Total Tokens (fake-agent simulated): 250 tokens (agent)");
    expect(text).toContain("Cumulative Warm Agent Total Tokens (fake-agent simulated): 500 tokens (agent)");
    expect(text).toContain("Warm Fake-Agent Evaluation: status completed, passed true, token source agent-reported, reliability high");
    expect(text).not.toContain("does not execute agents");
    expect(text).toContain("Index Build Duration: unavailable (No index setup was attempted because the project group was structurally inconsistent.)");
    expect(text).toContain("Cold Start And Warm Reuse:");
    expect(text).toContain("No composite score, winner, ranking, or break-even task is calculated.");
  });

  it("prints not applicable in text for other plugins", () => {
    const report = buildPluginExperimentReport({
      run: { ...makeWarmRun([]), pluginId: "context-strategy-comparison" },
      plugin: contextStrategyComparisonMetadata,
    });
    const text = renderPluginExperimentReportText(report);
    const section = text.slice(text.indexOf("Warm Index Reuse Evidence"), text.indexOf("Warnings, Skips, And Failures"));
    expect(section).toContain("Not applicable to this plugin.");
  });

  it("renders an escaped HTML section with task tables, estimates labeling, and unavailable reasons", () => {
    const report = buildPluginExperimentReport({
      run: makeWarmRun([
        projectSummary({ benchmarkProject: "<b>proj&</b>", sessionPrepared: false, status: "partial", tasks: [taskSummary("<t1>", { warmRetrieval: null, warmStatus: "failed" })] }),
      ], "partial"),
      plugin: warmIndexReuseMetadata,
    });
    const html = renderPluginExperimentReportHtml(report);
    const section = html.slice(html.indexOf("<h2>Warm Index Reuse Evidence</h2>"), html.indexOf("<h2>Warnings, Skips, And Failures</h2>"));
    expect(section).toContain("&lt;b&gt;proj&amp;&lt;/b&gt;");
    expect(section).toContain("1. &lt;t1&gt;");
    expect(section).not.toContain("<b>proj");
    expect(section).toContain("<th>Amortized index cost</th>");
    expect(section).toContain("<th>Cumulative warm duration</th>");
    expect(section).toContain("400 chars");
    expect(section).toContain("100 est. tokens");
    expect(section).toContain("not provider token usage");
    expect(section).toContain("No valid warm index session was prepared");
    expect(section).toContain("<th>Raw agent tokens</th>");
    expect(section).toContain("<td>250 tokens</td>");
    expect(section).toContain("simulated harness telemetry, not provider billing telemetry");
    expect(section).toContain("The fake agent was not run because this side produced no context evidence.");
    expect(section).not.toContain("<script");
  });
});

describe("warm report files from a real run", () => {
  it("writes report.json/txt/html with the warm section and without context or command output bodies", async () => {
    const outputRoot = mkdtempSync(path.join(os.tmpdir(), "warm-report-"));
    tempDirs.push(outputRoot);
    const registry = createDefaultExperimentPluginRegistry();
    const run = await runExperiment({
      pluginId: "warm-index-reuse",
      registry,
      outputRoot,
      config: { kitCommand: fakeKitCommand },
      inputs: { cases: [makeCase({ id: "task-a" }), makeCase({ id: "task-b" })], projectProfiles: await loadBundledProjectProfiles() },
      toolRoot: process.cwd(),
      runId: "warm-report-run",
    });
    const { outputPaths } = await writePluginExperimentReports({ run, plugin: registry.describe("warm-index-reuse") });

    const jsonText = readFileSync(outputPaths.jsonPath, "utf8");
    const parsed = JSON.parse(jsonText) as { report: { warmIndexReuse: { projects: unknown[] }; rawRun: { warmIndexMetrics: unknown } } };
    expect(parsed.report.warmIndexReuse.projects).toHaveLength(1);
    expect(parsed.report.rawRun.warmIndexMetrics).toBeTruthy();
    const taskServiceSource = readFileSync(path.resolve("benchmarks/projects/todo-ts/src/taskService.ts"), "utf8");
    const sourceLine = taskServiceSource.split("\n").find((line) => line.trim().length > 30)!.trim();
    for (const text of [jsonText, readFileSync(outputPaths.textPath, "utf8"), readFileSync(outputPaths.htmlPath, "utf8")]) {
      expect(text).not.toContain("contextText");
      expect(text).not.toContain("createTask(title: string)");
      expect(text).not.toContain(sourceLine);
      expect(text).not.toContain('"stdout"');
      expect(text).not.toContain('"stderr"');
    }
    expect(readFileSync(outputPaths.textPath, "utf8")).toContain("Warm Index Reuse Evidence");
  });
});

describe("warm report for the real v0.5.1 production corpus", () => {
  const MEDIUM_ORDER = [
    "warm-medium-import-dedupe",
    "warm-medium-create-project-task",
    "warm-medium-complete-idempotent",
    "warm-medium-composite-filter",
    "warm-medium-project-summary",
    "warm-medium-broad-workflow-map",
  ];
  const LARGE_ORDER = [
    "warm-large-health-label",
    "warm-large-ts-analytics-snapshot",
    "warm-large-ts-leaderboard",
    "warm-large-python-parser-metrics",
    "warm-large-python-pipeline",
    "warm-large-broad-analytics-comparison",
  ];

  let production: Promise<{ run: WarmIndexReuseRun; outputPaths: { jsonPath: string; textPath: string; htmlPath: string } }>;
  beforeAll(() => {
    production = (async () => {
      const outputRoot = mkdtempSync(path.join(os.tmpdir(), "warm-report-prod-"));
      tempDirsAll.push(outputRoot);
      const registry = createDefaultExperimentPluginRegistry();
      const run = (await runExperiment({
        pluginId: "warm-index-reuse",
        registry,
        outputRoot,
        config: { kitCommand: fakeKitCommand },
        inputs: { cases: await loadProductionWarmIndexCases(), projectProfiles: await loadBundledProjectProfiles() },
        toolRoot: process.cwd(),
        runId: "warm-report-production-run",
      })) as WarmIndexReuseRun;
      const { outputPaths } = await writePluginExperimentReports({ run, plugin: registry.describe("warm-index-reuse") });
      return { run, outputPaths };
    })();
  });
  const tempDirsAll: string[] = [];
  afterAll(async () => {
    await production.catch(() => undefined);
    await Promise.all(tempDirsAll.map((dir) => rm(dir, { recursive: true, force: true })));
  });

  it("summarizes two six-task projects in production corpus order with ordinals 1..6 each", async () => {
    const { run } = await production;
    const section = buildWarmIndexReuseReport(run)!;
    expect(section.schemaVersion).toBe("my-dev-kit-lab-warm-index-report-v1");
    expect(section.summary).toEqual({
      projectCount: 2,
      taskCount: 12,
      preparedSessionProjectCount: 2,
      incompleteProjectCount: 0,
      agentSideCount: 24,
      agentCorrectnessAvailableCount: 24,
      agentTotalTokensAvailableCount: 24,
    });
    expect(section.projects.map((project) => [project.benchmarkProject, project.taskCount])).toEqual([
      ["task-workflow-medium-ts", 6],
      ["task-analytics-large-mixed", 6],
    ]);
    expect(section.projects.map((project) => project.tasks.map((task) => task.caseId))).toEqual([MEDIUM_ORDER, LARGE_ORDER]);
    for (const project of section.projects) {
      expect(project.tasks.map((task) => task.taskOrdinal)).toEqual([1, 2, 3, 4, 5, 6]);
      for (const task of project.tasks) {
        expect([task.rawAgent?.status, task.warmAgent?.status]).toEqual(["completed", "completed"]);
      }
    }
    // The report carries the metric owner's precomputed series unchanged.
    expect(section.projects.map((project) => project.tasks.map((task) => task.warm))).toEqual(
      run.warmIndexMetrics.projects.map((project) => project.tasks.map((task) => task.warm))
    );
    expect(JSON.stringify(section)).not.toMatch(/locality/i);
  }, 120_000);

  it("writes bounded report.json/txt/html exposing both projects, all ordinals, and case IDs", async () => {
    const { outputPaths } = await production;
    const jsonText = readFileSync(outputPaths.jsonPath, "utf8");
    const text = readFileSync(outputPaths.textPath, "utf8");
    const html = readFileSync(outputPaths.htmlPath, "utf8");
    const parsed = JSON.parse(jsonText) as { report: { warmIndexReuse: { summary: { taskCount: number }; projects: Array<{ taskCount: number }> } } };
    expect(parsed.report.warmIndexReuse.summary.taskCount).toBe(12);
    expect(parsed.report.warmIndexReuse.projects.map((project) => project.taskCount)).toEqual([6, 6]);

    expect(text).toContain("Warm Index Project 1: task-workflow-medium-ts");
    expect(text).toContain("Warm Index Project 2: task-analytics-large-mixed");
    expect(text).toContain("Task Count: 12");
    expect(text).toContain("Task Count: 6");
    expect(text).toContain("Amortized Index Build Duration:");
    expect(text).toContain("Cumulative Warm Component Duration:");
    expect(text).toContain("(fake agent)");
    for (const [ordinal, caseId] of [...MEDIUM_ORDER.entries(), ...LARGE_ORDER.entries()]) {
      expect(text).toContain(`Task ${ordinal + 1}: ${caseId}`);
      expect(html).toContain(`${ordinal + 1}. ${caseId}`);
      expect(jsonText).toContain(`"caseId": "${caseId}"`);
    }
    expect(html).toContain("task-workflow-medium-ts");
    expect(html).toContain("task-analytics-large-mixed");
    expect(html).toContain("simulated harness telemetry, not provider billing telemetry");

    const fixtureLine = readFileSync(path.resolve("benchmarks/projects/task-workflow-medium-ts/src/services/importTasks.ts"), "utf8")
      .split("\n")[9]
      .trim();
    for (const content of [jsonText, text, html]) {
      expect(content).not.toContain("contextText");
      expect(content).not.toContain("source for unknown");
      expect(content).not.toContain(fixtureLine);
      expect(content).not.toContain('"stdout"');
      expect(content).not.toContain('"stderr"');
      expect(content).not.toContain("promptText");
      expect(content).not.toContain("finalAnswerText");
    }
  }, 120_000);

  it("keeps the expanded-corpus interpretation neutral", async () => {
    const { outputPaths } = await production;
    const { report } = JSON.parse(readFileSync(outputPaths.jsonPath, "utf8")) as {
      report: { interpretation: { summary: string; recommendedNextStep: string } };
    };
    const interpretation = `${report.interpretation.summary} ${report.interpretation.recommendedNextStep}`;
    expect(interpretation).toContain("prepared 2 of 2 project indexes and evaluated 12 tasks");
    expect(interpretation).not.toMatch(
      /winner|best strategy|best-supported|is better|cheaper overall|faster overall|saves tokens|break-even|ranked first|ranks first|top-ranked|recommended winning/i
    );
    // The only ranking wording is the explicit neutral disclaimer.
    expect(interpretation).toContain("are not ranked");
  }, 120_000);
});
