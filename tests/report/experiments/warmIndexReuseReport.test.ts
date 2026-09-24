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
import type { IndexFreshnessAssessmentV1, IndexFreshnessChangeV1 } from "../../../src/evaluation/indexFreshness.js";
import {
  fakeKitCommand,
  loadBundledProjectProfiles,
  loadProductionWarmIndexCases,
  makeCase,
  writeSnapshotFakeKit,
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

function agentSide(
  variantId: WarmIndexAgentSideEvidenceV1["variantId"],
  totalTokens: number | null = 250,
  overrides: Partial<WarmIndexAgentSideEvidenceV1> = {}
): WarmIndexAgentSideEvidenceV1 {
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
    ...overrides,
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

/** Builds a campaign-shaped run: metadata carries campaignPreset/campaignAgentId/campaignTimeoutMs. */
function makeCampaignRun(args: {
  agentId: "codex" | "claude";
  presetId?: string;
  timeoutMs?: number;
  projects?: WarmIndexProjectSummaryV1[];
  agentEvidence?: WarmIndexProjectAgentEvidenceV1[];
  status?: ExperimentRun["status"];
}): WarmIndexReuseRun {
  const projects = args.projects ?? [projectSummary()];
  const agentEvidence =
    args.agentEvidence ??
    projects.map((project) => ({
      benchmarkProject: project.benchmarkProject,
      tasks: project.tasks.map((task) => ({
        caseId: task.caseId,
        raw: task.rawBaseline ? agentSide("raw-full-file", 10, { agentId: args.agentId }) : null,
        warm: task.warmRetrieval ? agentSide("warm-index-reuse", 10, { agentId: args.agentId }) : null,
      })),
    }));
  const run = makeWarmRun(projects, args.status ?? "completed", agentEvidence);
  return {
    ...run,
    metadata: {
      campaignPreset: args.presetId ?? `${args.agentId}-full`,
      campaignAgentId: args.agentId,
      campaignTimeoutMs: args.timeoutMs ?? 240_000,
    },
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
    // 5 common + 2 fake-agent limitations, plus the 5 v0.6.0 Batch 3 freshness interpretation lines.
    expect(section.limitations).toHaveLength(7 + 5);
    expect(section.limitations.join(" ")).not.toContain("does not execute agents");
    expect(section.limitations.join(" ")).toContain("deterministic simulated fake-agent evidence");
    expect(section.limitations.join(" ")).toContain("simulated harness telemetry, not provider billing telemetry");
    expect(section.summary).toEqual(
      expect.objectContaining({ agentSideCount: 8, agentCorrectnessAvailableCount: 8, agentTotalTokensAvailableCount: 8 })
    );
    expect(section.agent).toEqual({ id: "fake-agent", mode: "deterministic-fake" });
    expect(section.agentCampaign).toBeNull();
    expect(section.projects[0].tasks[0].warmAgent).toEqual({
      agentId: "fake-agent",
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

describe("v0.5.2 Batch 4 -- campaign report construction", () => {
  it("builds a complete campaign summary for a fully executed, fully completed codex campaign", () => {
    const run = makeCampaignRun({ agentId: "codex" });
    const section = buildWarmIndexReuseReport(run)!;
    expect(section.agent).toEqual({ id: "codex", mode: "real-provider" });
    expect(section.agentCampaign).toEqual({
      presetId: "codex-full",
      agentId: "codex",
      timeoutMs: 240_000,
      selectedCaseCount: 2,
      scheduledSideCount: 4,
      executedSideCount: 4,
      notRunForMissingContextCount: 0,
      outcomeCounts: { completed: 4, failed: 0, timeout: 0, invalidOutput: 0, agentUnavailable: 0, agentLimitReached: 0, skipped: 0 },
      agentEvidenceStatus: "complete",
      tokenEvidenceStatus: "complete",
    });
    expect(section.limitations.join(" ")).toContain("Codex CLI campaign execution");
    expect(section.limitations.join(" ")).not.toContain("simulated fake-agent evidence");
  });

  it("builds a complete claude campaign summary and uses claude-specific limitations", () => {
    const run = makeCampaignRun({ agentId: "claude" });
    const section = buildWarmIndexReuseReport(run)!;
    expect(section.agent).toEqual({ id: "claude", mode: "real-provider" });
    expect(section.agentCampaign?.agentId).toBe("claude");
    expect(section.limitations.join(" ")).toContain("Claude CLI campaign execution");
  });

  it("computes agentEvidenceStatus=unavailable when zero campaign sides executed (section 16)", () => {
    const project = projectSummary({ tasks: [taskSummary("t1")] });
    const run = makeCampaignRun({
      agentId: "codex",
      projects: [project],
      agentEvidence: [{ benchmarkProject: project.benchmarkProject, tasks: [{ caseId: "t1", raw: null, warm: null }] }],
    });
    const section = buildWarmIndexReuseReport(run)!;
    expect(section.agentCampaign?.executedSideCount).toBe(0);
    expect(section.agentCampaign?.agentEvidenceStatus).toBe("unavailable");
    expect(section.agentCampaign?.tokenEvidenceStatus).toBe("unavailable");
  });

  it("marks a side not-run for missing context without fabricating a provider failure (section 34)", () => {
    const project = projectSummary({ tasks: [taskSummary("t1")] });
    const run = makeCampaignRun({
      agentId: "codex",
      projects: [project],
      agentEvidence: [
        {
          benchmarkProject: project.benchmarkProject,
          tasks: [{ caseId: "t1", raw: agentSide("raw-full-file", 10, { agentId: "codex" }), warm: null }],
        },
      ],
    });
    const section = buildWarmIndexReuseReport(run)!;
    expect(section.projects[0].tasks[0].warmAgent).toBeNull();
    expect(section.agentCampaign).toEqual(
      expect.objectContaining({
        scheduledSideCount: 2,
        executedSideCount: 1,
        notRunForMissingContextCount: 1,
        outcomeCounts: expect.objectContaining({ completed: 1, failed: 0 }),
        agentEvidenceStatus: "partial",
      })
    );
  });

  it("rejects a campaign status outside the closed outcome vocabulary", () => {
    const project = projectSummary({ tasks: [taskSummary("t1")] });
    const run = makeCampaignRun({
      agentId: "codex",
      projects: [project],
      agentEvidence: [
        {
          benchmarkProject: project.benchmarkProject,
          tasks: [{ caseId: "t1", raw: agentSide("raw-full-file", 10, { agentId: "codex", status: "unheard-of-status" }), warm: null }],
        },
      ],
    });
    expect(() => buildWarmIndexReuseReport(run)).toThrow(/unsupported campaign agent status/);
  });

  it("rejects a campaign whose metadata says codex but evidence says claude (section 35)", () => {
    const project = projectSummary({ tasks: [taskSummary("t1")] });
    const run = makeCampaignRun({
      agentId: "codex",
      projects: [project],
      agentEvidence: [
        {
          benchmarkProject: project.benchmarkProject,
          tasks: [{ caseId: "t1", raw: agentSide("raw-full-file", 10, { agentId: "claude" }), warm: null }],
        },
      ],
    });
    expect(() => buildWarmIndexReuseReport(run)).toThrow(/campaign metadata says codex but agent evidence contains claude/);
  });

  it("rejects a campaign whose metadata says claude but evidence says fake-agent (section 35)", () => {
    const project = projectSummary({ tasks: [taskSummary("t1")] });
    const run = makeCampaignRun({
      agentId: "claude",
      projects: [project],
      agentEvidence: [
        {
          benchmarkProject: project.benchmarkProject,
          tasks: [{ caseId: "t1", raw: agentSide("raw-full-file", 10, { agentId: "fake-agent" }), warm: null }],
        },
      ],
    });
    expect(() => buildWarmIndexReuseReport(run)).toThrow(/campaign metadata says claude but agent evidence contains fake-agent/);
  });

  it("rejects a legacy non-campaign run that contains codex or claude evidence (section 35)", () => {
    const project = projectSummary({ tasks: [taskSummary("t1")] });
    const run = makeWarmRun([project], "completed", [
      {
        benchmarkProject: project.benchmarkProject,
        tasks: project.tasks.map((task) => ({
          caseId: task.caseId,
          raw: agentSide("raw-full-file", 10, { agentId: "codex" }),
          warm: agentSide("warm-index-reuse", 10, { agentId: "codex" }),
        })),
      },
    ]);
    expect(() => buildWarmIndexReuseReport(run)).toThrow(/legacy non-campaign run must not contain non-fake agent evidence/);
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
    expect(completed.interpretation.summary).toContain("Deterministic fake-agent correctness/token evidence is available for 4 of 4 task sides");
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
    expect(text).toContain("Warm Agent Correctness: 1 score (agent)");
    expect(text).toContain("Raw Agent Total Tokens: 250 tokens (agent)");
    expect(text).toContain("Cumulative Warm Agent Total Tokens: 500 tokens (agent)");
    expect(text).toContain("Warm Agent Evaluation: agent fake-agent, status completed, passed true, token source agent-reported, reliability high");
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
    expect(section).toContain("The agent was not run because this side produced no usable context evidence.");
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
    // v0.6.0 Batch 3: all three report files expose the (conservative, shared-fake) freshness evidence.
    expect(jsonText).toContain('"indexFreshnessSummary"');
    expect(text).toContain("Index Freshness Summary");
    expect(text).toContain("Assessed Tasks: 12");
    expect(html).toContain("<h3>Index Freshness</h3>");

    expect(text).toContain("Warm Index Project 1: task-workflow-medium-ts");
    expect(text).toContain("Warm Index Project 2: task-analytics-large-mixed");
    expect(text).toContain("Task Count: 12");
    expect(text).toContain("Task Count: 6");
    expect(text).toContain("Amortized Index Build Duration:");
    expect(text).toContain("Cumulative Warm Component Duration:");
    expect(text).toContain("agent fake-agent");
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

// ---------------------------------------------------------------------------------------------
// v0.6.0 Batch 3 -- index freshness report presentation. Reports present only the persisted
// per-task assessment; they never re-read the filesystem or recompute a status.
// ---------------------------------------------------------------------------------------------

const HASH_A = "a".repeat(64);
const HASH_B = "b".repeat(64);

function freshness(overrides: Partial<IndexFreshnessAssessmentV1> = {}): IndexFreshnessAssessmentV1 {
  return {
    schemaVersion: "my-dev-kit-lab-index-freshness-v1",
    status: "fresh",
    assessedAt: "2026-09-24T00:00:00.000Z",
    baselineSnapshotStatus: "complete",
    indexedFileCount: 3,
    comparableFileCount: 3,
    unchangedFileCount: 3,
    changedFileCount: 0,
    missingFileCount: 0,
    unresolvedFileCount: 0,
    changes: [],
    changesTruncated: false,
    unresolved: [],
    unresolvedTruncated: false,
    warnings: [],
    ...overrides,
  };
}

function change(filePath: string, changeType: IndexFreshnessChangeV1["changeType"] = "modified"): IndexFreshnessChangeV1 {
  return {
    path: filePath,
    changeType,
    baselineSha256: HASH_A,
    baselineSizeBytes: 10,
    baselineModifiedAt: "2026-01-01T00:00:00.000Z",
    currentSha256: changeType === "missing" ? null : HASH_B,
    currentSizeBytes: changeType === "missing" ? null : 11,
    currentModifiedAt: changeType === "missing" ? null : "2026-02-01T00:00:00.000Z",
  };
}

function unresolvedEntry(filePath: string | null, message = "could not read"): IndexFreshnessAssessmentV1["unresolved"][number] {
  return { path: filePath, reasonCode: "file-read-failed", message };
}

const staleAssessment = () =>
  freshness({
    status: "stale",
    unchangedFileCount: 1,
    comparableFileCount: 2,
    changedFileCount: 1,
    missingFileCount: 1,
    changes: [change("src/a.ts"), change("src/b.ts", "missing")],
  });

/** t1 fresh, t2 stale, t3 partially-stale, t4 unknown, t5 with no assessment. */
function mixedFreshnessProject(): WarmIndexProjectSummaryV1 {
  return projectSummary({
    tasks: [
      taskSummary("t1", { indexFreshness: freshness() }),
      taskSummary("t2", { indexFreshness: staleAssessment() }),
      taskSummary("t3", {
        indexFreshness: freshness({
          status: "partially-stale",
          baselineSnapshotStatus: "partial",
          changedFileCount: 1,
          unresolvedFileCount: 1,
          changes: [change("src/c.ts")],
          unresolved: [unresolvedEntry("src/d.ts", "The index snapshot could not hash this indexed file (missing).")],
        }),
      }),
      taskSummary("t4", {
        indexFreshness: freshness({
          status: "unknown",
          baselineSnapshotStatus: "unavailable",
          indexedFileCount: 0,
          comparableFileCount: 0,
          unchangedFileCount: 0,
          unresolvedFileCount: 1,
          unresolved: [{ path: null, reasonCode: "snapshot-unavailable", message: "No index snapshot is available for this session." }],
        }),
      }),
      taskSummary("t5"),
    ],
  });
}

const manyChanges = (count: number) => Array.from({ length: count }, (_, index) => change(`src/gen/f${String(index).padStart(2, "0")}.ts`));
const manyUnresolved = (count: number) => Array.from({ length: count }, (_, index) => unresolvedEntry(`src/u${String(index).padStart(2, "0")}.ts`));

describe("v0.6.0 Batch 3 -- index freshness in the warm-index report model", () => {
  // TST-B3-001..006, TST-B3-026
  it("maps persisted statuses without reinterpretation and counts assessed versus unassessed tasks", () => {
    const section = buildWarmIndexReuseReport(makeWarmRun([mixedFreshnessProject()]))!;
    const tasks = section.projects[0].tasks;

    expect(section.schemaVersion).toBe("my-dev-kit-lab-warm-index-report-v1");
    expect(tasks.map((task) => task.indexFreshness?.status ?? null)).toEqual(["fresh", "stale", "partially-stale", "unknown", null]);
    expect(tasks[0].indexFreshness).toEqual(
      expect.objectContaining({ assessedAt: "2026-09-24T00:00:00.000Z", baselineSnapshotStatus: "complete", indexedFileCount: 3, unchangedFileCount: 3 })
    );
    expect(tasks[1].indexFreshness).toEqual(expect.objectContaining({ changedFileCount: 1, missingFileCount: 1, comparableFileCount: 2 }));
    expect(tasks[1].indexFreshness?.changes.items).toEqual([
      { path: "src/a.ts", changeType: "modified" },
      { path: "src/b.ts", changeType: "missing" },
    ]);
    expect(tasks[2].indexFreshness?.baselineSnapshotStatus).toBe("partial");
    expect(tasks[3].indexFreshness?.baselineSnapshotStatus).toBe("unavailable");
    expect(tasks[4].indexFreshness).toBeNull();

    const summary = section.indexFreshnessSummary;
    expect(summary).toEqual({
      assessedTaskCount: 4,
      unassessedTaskCount: 1,
      freshTaskCount: 1,
      staleTaskCount: 1,
      partiallyStaleTaskCount: 1,
      unknownTaskCount: 1,
    });
    expect(summary.assessedTaskCount).toBe(
      summary.freshTaskCount + summary.staleTaskCount + summary.partiallyStaleTaskCount + summary.unknownTaskCount
    );
    expect(summary.assessedTaskCount + summary.unassessedTaskCount).toBe(section.summary.taskCount);
    // Hashes and sizes are not part of the report presentation.
    expect(JSON.stringify(section.projects)).not.toContain(HASH_A);
    expect(JSON.stringify(section.projects)).not.toContain(HASH_B);
    expect(JSON.stringify(tasks[1].indexFreshness)).not.toMatch(/sha256|baselineSizeBytes|currentModifiedAt/i);
  });

  it("does not count an unassessed task as unknown", () => {
    const section = buildWarmIndexReuseReport(makeWarmRun([projectSummary()]))!;
    expect(section.indexFreshnessSummary).toEqual({
      assessedTaskCount: 0,
      unassessedTaskCount: 2,
      freshTaskCount: 0,
      staleTaskCount: 0,
      partiallyStaleTaskCount: 0,
      unknownTaskCount: 0,
    });
    expect(section.projects[0].tasks.every((task) => task.indexFreshness === null)).toBe(true);
  });

  // TST-B3-007, TST-B3-008
  it("bounds displayed changes at 20 and unresolved evidence at 10 while keeping persisted totals", () => {
    const section = buildWarmIndexReuseReport(
      makeWarmRun([
        projectSummary({
          tasks: [
            taskSummary("over", { indexFreshness: freshness({ status: "stale", changes: manyChanges(25), unresolved: manyUnresolved(12), unresolvedFileCount: 12 }) }),
            taskSummary("exact", { indexFreshness: freshness({ status: "stale", changes: manyChanges(20), unresolved: manyUnresolved(10), unresolvedFileCount: 10 }) }),
          ],
        }),
      ])
    )!;
    const [over, exact] = section.projects[0].tasks.map((task) => task.indexFreshness!);

    expect(over.changes).toEqual({
      totalCount: 25,
      displayedCount: 20,
      omittedCount: 5,
      items: manyChanges(25)
        .slice(0, 20)
        .map((entry) => ({ path: entry.path, changeType: entry.changeType })),
    });
    expect(over.unresolved.totalCount).toBe(12);
    expect(over.unresolved.displayedCount).toBe(10);
    expect(over.unresolved.omittedCount).toBe(2);
    expect(over.unresolved.items).toHaveLength(10);
    expect([exact.changes.omittedCount, exact.unresolved.omittedCount]).toEqual([0, 0]);
  });

  // TST-B3-009
  it("preserves persisted sentinel values instead of recalculating from the filesystem", () => {
    const sentinel = freshness({
      status: "fresh",
      assessedAt: "1999-12-31T23:59:59.000Z",
      indexedFileCount: 999,
      comparableFileCount: 998,
      unchangedFileCount: 997,
      changedFileCount: 7,
      missingFileCount: 3,
      changes: [change("/definitely/not/on/disk.ts")],
    });
    const section = buildWarmIndexReuseReport(makeWarmRun([projectSummary({ tasks: [taskSummary("s", { indexFreshness: sentinel })] })]))!;
    const presented = section.projects[0].tasks[0].indexFreshness!;

    expect(presented).toEqual(
      expect.objectContaining({
        status: "fresh",
        assessedAt: "1999-12-31T23:59:59.000Z",
        indexedFileCount: 999,
        comparableFileCount: 998,
        unchangedFileCount: 997,
        changedFileCount: 7,
        missingFileCount: 3,
      })
    );
    expect(presented.changes.items).toEqual([{ path: "/definitely/not/on/disk.ts", changeType: "modified" }]);
  });

  // TST-B3-025
  it("leaves campaign agent evidence untouched by freshness", () => {
    const plain = buildWarmIndexReuseReport(makeCampaignRun({ agentId: "codex" }))!;
    const withFreshness = buildWarmIndexReuseReport(
      makeCampaignRun({
        agentId: "codex",
        projects: [
          projectSummary({
            tasks: [
              taskSummary("t1", { indexFreshness: staleAssessment() }),
              taskSummary("t2", { indexFreshness: freshness({ status: "unknown", baselineSnapshotStatus: "unavailable" }) }),
            ],
          }),
        ],
      })
    )!;

    expect(withFreshness.agentCampaign).toEqual(plain.agentCampaign);
    expect(withFreshness.agentCampaign?.outcomeCounts).toEqual(plain.agentCampaign?.outcomeCounts);
    expect(withFreshness.summary).toEqual(plain.summary);
    expect(withFreshness.projects[0].tasks.map((task) => [task.rawStatus, task.warmStatus])).toEqual(
      plain.projects[0].tasks.map((task) => [task.rawStatus, task.warmStatus])
    );
  });

  it("adds the freshness interpretation limitations to every warm-index report", () => {
    const section = buildWarmIndexReuseReport(makeWarmRun([projectSummary()]))!;
    const text = section.limitations.join(" ");
    expect(text).toContain("only files proven by the index snapshot to have been indexed");
    expect(text).toContain("does not establish that the entire repository is unchanged");
    expect(text).toContain("not represented in the snapshot is outside the current freshness comparison");
    expect(text).toContain("SHA-256 is the comparison identity");
    expect(text).toContain("Modified timestamps are diagnostic metadata only");
    expect(text).toContain("does not trigger reindexing, suppress warm retrieval, alter execution status");
    for (const status of ["fresh means", "stale means", "partially-stale means", "unknown means"]) {
      expect(text).toContain(status);
    }
  });
});

describe("v0.6.0 Batch 3 -- index freshness text and HTML rendering", () => {
  const buildMixed = (extra: Partial<WarmIndexProjectSummaryV1> = {}) =>
    buildPluginExperimentReport({ run: makeWarmRun([{ ...mixedFreshnessProject(), ...extra }]), plugin: warmIndexReuseMetadata });

  // TST-B3-010..013, TST-B3-024
  it("renders the summary, per-task status, bounded evidence, and not-assessed tasks in text without hashes", () => {
    const text = renderPluginExperimentReportText(buildMixed());

    const summaryStart = text.indexOf("Index Freshness Summary");
    expect(summaryStart).toBeGreaterThan(text.indexOf("Agent Token Totals Available"));
    expect(summaryStart).toBeLessThan(text.indexOf("Cold Start And Warm Reuse:"));
    for (const line of ["Assessed Tasks: 4", "Unassessed Tasks: 1", "Fresh Tasks: 1", "Stale Tasks: 1", "Partially-Stale Tasks: 1", "Unknown Tasks: 1"]) {
      expect(text).toContain(line);
    }

    const t2 = text.slice(text.indexOf("Task 2: t2"), text.indexOf("Task 3: t3"));
    expect(t2.indexOf("Index Freshness Status: stale")).toBeGreaterThan(t2.indexOf("Warm Status:"));
    expect(t2.indexOf("Index Freshness Status: stale")).toBeLessThan(t2.indexOf("Raw Context Characters"));
    for (const line of [
      "Baseline Snapshot Status: complete",
      "Indexed Files: 3",
      "Comparable Files: 2",
      "Unchanged Files: 1",
      "Modified Files: 1",
      "Missing Files: 1",
      "Unresolved Comparisons: 0",
      "Freshness Changes:",
      "- modified src/a.ts",
      "- missing src/b.ts",
      "Freshness Unresolved Evidence:",
      "- none",
    ]) {
      expect(t2).toContain(line);
    }
    const t3 = text.slice(text.indexOf("Task 3: t3"), text.indexOf("Task 4: t4"));
    expect(t3).toContain("- src/d.ts [file-read-failed] The index snapshot could not hash this indexed file (missing).");
    const t4 = text.slice(text.indexOf("Task 4: t4"), text.indexOf("Task 5: t5"));
    expect(t4).toContain("- run-level [snapshot-unavailable] No index snapshot is available for this session.");
    expect(t4).toContain("Index Freshness Status: unknown");

    const t5 = text.slice(text.indexOf("Task 5: t5"));
    expect(t5).toContain("Index Freshness Status: not assessed");
    expect(t5).not.toContain("Index Freshness Status: unknown");
    expect(t5).not.toContain("Baseline Snapshot Status");

    expect(text).not.toContain(HASH_A);
    expect(text).not.toContain(HASH_B);
    expect(text).not.toMatch(/\b[0-9a-f]{64}\b/);
  });

  it("reports omitted text evidence only when the display limit was reached", () => {
    const text = renderPluginExperimentReportText(
      buildMixed({ tasks: [taskSummary("big", { indexFreshness: freshness({ status: "stale", changes: manyChanges(25), unresolved: manyUnresolved(11) }) })] })
    );
    expect(text).toContain("Displayed: 20 of 25");
    expect(text).toContain("Omitted: 5");
    expect(text).toContain("Displayed: 10 of 11");
    expect(text.match(/^- modified /gm)).toHaveLength(20);
    expect(renderPluginExperimentReportText(buildMixed())).not.toContain("Displayed: ");
  });

  // TST-B3-014, TST-B3-015, TST-B3-017
  it("renders an HTML summary and a per-project freshness table separate from the context table", () => {
    const html = renderPluginExperimentReportHtml(buildMixed());
    const section = html.slice(html.indexOf("<h2>Warm Index Reuse Evidence</h2>"), html.indexOf("<h2>Warnings, Skips, And Failures</h2>"));

    expect(section).toContain("<h3>Index Freshness</h3>");
    expect(section.indexOf("<h3>Index Freshness</h3>")).toBeGreaterThan(section.indexOf("Agent token totals available"));
    for (const cell of ["Assessed tasks", "Unassessed tasks", "Fresh tasks", "Stale tasks", "Partially-stale tasks", "Unknown tasks"]) {
      expect(section).toContain(`<td>${cell}</td>`);
    }
    const contextTable = section.indexOf("<th>Cumulative warm est. tokens</th>");
    const freshnessTable = section.indexOf("<th>Freshness</th>");
    const agentTable = section.indexOf("<th>Raw agent status</th>");
    expect(contextTable).toBeGreaterThan(-1);
    expect(freshnessTable).toBeGreaterThan(contextTable);
    expect(freshnessTable).toBeLessThan(agentTable);
    for (const header of ["Baseline", "Indexed", "Comparable", "Unchanged", "Modified", "Missing", "Unresolved", "Evidence type"]) {
      expect(section).toContain(`<th>${header}</th>`);
    }
    expect(section).toContain("<td>5. t5</td><td>not assessed</td><td>unavailable</td>");
    expect(section).toContain("<td>2. t2</td><td>stale</td><td>complete</td>");
    expect(section).toContain("<td>missing</td><td>src/b.ts</td>");
    expect(section).toContain("<td>unresolved</td><td>src/d.ts</td><td>file-read-failed: The index snapshot could not hash this indexed file (missing).</td>");
    expect(section).not.toContain(HASH_A);
    expect(section).not.toContain(HASH_B);
  });

  it("limits HTML detail rows to the report limits and states what was omitted", () => {
    const html = renderPluginExperimentReportHtml(
      buildMixed({ tasks: [taskSummary("big", { indexFreshness: freshness({ status: "stale", changes: manyChanges(25), unresolved: manyUnresolved(11) }) })] })
    );
    expect(html.match(/<td>modified<\/td>/g)).toHaveLength(20);
    expect(html.match(/<td>unresolved<\/td>/g)).toHaveLength(10);
    expect(html).toContain("Task 1: 5 of 25 changes omitted.");
    expect(html).toContain("Task 1: 1 of 11 unresolved entries omitted.");
  });

  // TST-B3-016
  it("escapes hostile evidence strings in HTML output", () => {
    const hostile = "<script>alert(1)</script>";
    const html = renderPluginExperimentReportHtml(
      buildMixed({
        tasks: [
          taskSummary(hostile, {
            indexFreshness: freshness({
              status: "partially-stale",
              changes: [change(hostile)],
              unresolved: [{ path: hostile, reasonCode: "unsafe-path", message: hostile }],
            }),
          }),
        ],
      })
    );
    const section = html.slice(html.indexOf("<h2>Warm Index Reuse Evidence</h2>"), html.indexOf("<h2>Warnings, Skips, And Failures</h2>"));
    expect(section).not.toContain("<script");
    expect(section).toContain("&lt;script&gt;alert(1)&lt;/script&gt;");
    expect(section).toContain("unsafe-path: &lt;script&gt;alert(1)&lt;/script&gt;");
  });

  it("renders reports serialized before Batch 3 as having no freshness assessment", () => {
    const report = buildMixed({ tasks: [taskSummary("legacy")] });
    const legacy = JSON.parse(JSON.stringify(report)) as typeof report;
    delete (legacy.warmIndexReuse as Partial<NonNullable<typeof legacy.warmIndexReuse>>).indexFreshnessSummary;
    for (const project of legacy.warmIndexReuse!.projects) {
      for (const task of project.tasks) delete (task as Partial<typeof task>).indexFreshness;
    }

    const text = renderPluginExperimentReportText(legacy);
    expect(text).toContain("Assessed Tasks: 0");
    expect(text).toContain("Unassessed Tasks: 1");
    expect(text).toContain("Index Freshness Status: not assessed");
    expect(text).not.toContain("Index Freshness Status: unknown");
    expect(renderPluginExperimentReportHtml(legacy)).toContain("<td>1. legacy</td><td>not assessed</td>");
  });
});

describe("v0.6.0 Batch 3 -- index freshness interpretation", () => {
  const FORBIDDEN = /should reindex|must reindex|safe to reuse|unsafe to reuse|winner|best|ranking|speedup|saves tokens|percent|%/i;

  // TST-B3-018, TST-B3-019
  it("appends a neutral count-only freshness sentence to the existing interpretation", () => {
    const report = buildPluginExperimentReport({ run: makeWarmRun([mixedFreshnessProject()]), plugin: warmIndexReuseMetadata });
    const summary = report.interpretation.summary;

    expect(summary).toContain("prepared 1 of 1 project indexes and evaluated 5 tasks");
    const sentence = summary.slice(summary.indexOf("Index freshness was assessed"));
    expect(sentence).toBe(
      "Index freshness was assessed for 4 task boundaries: fresh=1, stale=1, partially-stale=1, unknown=1. " +
        "Freshness is observational evidence over files represented by the index snapshot and does not change retrieval or provider status."
    );
    expect(sentence).not.toMatch(FORBIDDEN);
    expect(report.interpretation.recommendedNextStep).not.toMatch(/reindex|freshness/i);
  });

  it("states that no assessment was available for runs without per-task freshness", () => {
    const report = buildPluginExperimentReport({ run: makeWarmRun([projectSummary()]), plugin: warmIndexReuseMetadata });
    expect(report.interpretation.summary).toContain("No per-task index freshness assessment was available in this report.");
    expect(report.interpretation.summary).not.toContain("Index freshness was assessed");
  });

  it("appends the same sentence to the campaign interpretation without changing its agent wording", () => {
    const project = projectSummary({ tasks: [taskSummary("t1", { indexFreshness: freshness() })] });
    const report = buildPluginExperimentReport({ run: makeCampaignRun({ agentId: "claude", projects: [project] }), plugin: warmIndexReuseMetadata });
    expect(report.interpretation.summary).toContain("Agent evidence status: complete");
    expect(report.interpretation.summary).toContain("Index freshness was assessed for 1 task boundary: fresh=1, stale=0, partially-stale=0, unknown=0.");
  });

  it("keeps the added freshness limitation wording free of recommendation and ranking language", () => {
    const section = buildWarmIndexReuseReport(makeWarmRun([projectSummary()]))!;
    const added = section.limitations.slice(-5);
    expect(added[0]).toContain("Freshness compares only files");
    expect(added[4]).toContain("Freshness statuses:");
    for (const line of added) expect(line).not.toMatch(FORBIDDEN);
  });
});

describe("v0.6.0 Batch 3 -- freshness in report files from a deterministic run", () => {
  // TST-B3-020, TST-B3-023, TST-B3-024
  it("exposes fresh evidence in report.json, report.txt, and report.html without hashes or bodies, and adds no metric", async () => {
    const kitDir = mkdtempSync(path.join(os.tmpdir(), "warm-report-kit-"));
    const outputRoot = mkdtempSync(path.join(os.tmpdir(), "warm-report-fresh-"));
    tempDirs.push(kitDir, outputRoot);
    const kit = writeSnapshotFakeKit(kitDir);
    const registry = createDefaultExperimentPluginRegistry();
    const run = (await runExperiment({
      pluginId: "warm-index-reuse",
      registry,
      outputRoot,
      config: { kitCommand: kit.command },
      inputs: { cases: [makeCase({ id: "task-a" }), makeCase({ id: "task-b" })], projectProfiles: await loadBundledProjectProfiles() },
      toolRoot: process.cwd(),
      runId: "warm-report-fresh-run",
    })) as WarmIndexReuseRun;
    const { outputPaths } = await writePluginExperimentReports({ run, plugin: registry.describe("warm-index-reuse") });

    const jsonText = readFileSync(outputPaths.jsonPath, "utf8");
    const text = readFileSync(outputPaths.textPath, "utf8");
    const html = readFileSync(outputPaths.htmlPath, "utf8");
    const parsed = JSON.parse(jsonText) as {
      report: {
        warmIndexReuse: {
          schemaVersion: string;
          indexFreshnessSummary: Record<string, number>;
          projects: Array<{ tasks: Array<{ indexFreshness: { status: string } }> }>;
        };
      };
    };
    const warm = parsed.report.warmIndexReuse;

    expect(warm.schemaVersion).toBe("my-dev-kit-lab-warm-index-report-v1");
    expect(warm.indexFreshnessSummary).toEqual({
      assessedTaskCount: 2,
      unassessedTaskCount: 0,
      freshTaskCount: 2,
      staleTaskCount: 0,
      partiallyStaleTaskCount: 0,
      unknownTaskCount: 0,
    });
    expect(warm.projects[0].tasks.map((task) => task.indexFreshness.status)).toEqual(["fresh", "fresh"]);
    expect(text).toContain("Index Freshness Summary");
    expect(text).toContain("Index Freshness Status: fresh");
    expect(html).toContain("<h3>Index Freshness</h3>");
    expect(html).toContain("<td>1. task-a</td><td>fresh</td><td>complete</td>");

    // The dedicated presentation carries no content hashes; bodies never appear anywhere.
    expect(JSON.stringify(warm)).not.toMatch(/\b[0-9a-f]{64}\b/);
    expect(text).not.toMatch(/\b[0-9a-f]{64}\b/);
    expect(html).not.toMatch(/\b[0-9a-f]{64}\b/);
    for (const content of [jsonText, text, html]) {
      expect(content).not.toContain("contextText");
      expect(content).not.toContain("promptText");
      expect(content).not.toContain("finalAnswerText");
    }

    // No freshness ExperimentMetric was added.
    expect(run.metrics.map((metric) => metric.id).join(" ")).not.toMatch(/fresh|stale|changed|missing|unresolved/i);
    expect(JSON.stringify(run.warmIndexMetrics)).not.toMatch(/fresh|stale/i);
  }, 120_000);
});
