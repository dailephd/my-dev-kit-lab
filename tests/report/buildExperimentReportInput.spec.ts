import { rm, rename } from "node:fs/promises";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { buildAggregateAnswers, buildExperimentReportInput } from "../../src/report/index.js";
import { makeExperimentRun } from "../evaluation/experimentTestHelpers.js";
import type { ExperimentComparison, ExperimentSummary } from "../../src/evaluation/controlledExperimentTypes.js";
import { createFakeExperimentFixture } from "./experimentReportTestHelpers.js";

const tempDirs: string[] = [];

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

describe("buildExperimentReportInput", () => {
  it("builds report input from fake controlled experiment artifacts", async () => {
    const experimentDir = await createFakeExperimentFixture();
    tempDirs.push(experimentDir);
    const report = await buildExperimentReportInput({ experimentDir, maxPromptChars: 80, maxFileTreeEntries: 3 });
    expect(report.executiveSummary.summaryText).toContain("Completed");
    expect(report.projectProfiles[0].profile.projectId).toBe("todo-ts");
    expect(report.projectProfiles[0].complexityMetrics.fileCount).toBeGreaterThan(0);
    expect(report.fileTreeSections[0].entries.length).toBeLessThanOrEqual(3);
    expect(report.benchmarkCases[0].caseId).toBe("todo-ts-create-task");
    expect(report.promptComparisonSections.map((section) => section.strategy)).toEqual(["raw-full-file", "my-dev-kit-guided"]);
    expect(report.agentRunSections).toHaveLength(2);
    expect(report.correctnessSections[0].correctness.formula).toContain("correctnessScore");
    expect(report.tokenSections).toHaveLength(1);
    expect(report.timingSections).toHaveLength(1);
    expect(report.formulaSections.map((section) => section.id)).toEqual(["correctness", "tokens", "timing"]);
    expect(report.limitations.join(" ")).toContain("fake-agent");
    expect(report.artifactLinks.length).toBeGreaterThan(0);
  });

  it("warns when an optional prompt file is missing", async () => {
    const experimentDir = await createFakeExperimentFixture();
    tempDirs.push(experimentDir);
    await rename(
      path.join(experimentDir, "runs", "todo-ts-create-task.todo-ts.fake-agent.raw-full-file.short", "prompt.txt"),
      path.join(experimentDir, "runs", "todo-ts-create-task.todo-ts.fake-agent.raw-full-file.short", "prompt.missing")
    );
    const report = await buildExperimentReportInput({ experimentDir });
    expect(report.warnings.some((warning) => warning.includes("Optional prompt artifact missing"))).toBe(true);
  });

  it("fails clearly when required experiment artifacts are missing", async () => {
    const experimentDir = await createFakeExperimentFixture();
    tempDirs.push(experimentDir);
    await rm(path.join(experimentDir, "experiment-summary.json"));
    await expect(buildExperimentReportInput({ experimentDir })).rejects.toThrow("experiment-summary.json");

    const experimentDir2 = await createFakeExperimentFixture();
    tempDirs.push(experimentDir2);
    await rm(path.join(experimentDir2, "experiment-runs.json"));
    await expect(buildExperimentReportInput({ experimentDir: experimentDir2 })).rejects.toThrow("experiment-runs.json");

    const experimentDir3 = await createFakeExperimentFixture();
    tempDirs.push(experimentDir3);
    await rm(path.join(experimentDir3, "experiment-comparisons.json"));
    await expect(buildExperimentReportInput({ experimentDir: experimentDir3 })).rejects.toThrow("experiment-comparisons.json");
  }, 15000);
});

describe("buildAggregateAnswers", () => {
  const summary: ExperimentSummary = {
    generatedAt: "2026-01-01T00:00:00.000Z",
    casesPath: "examples/token-savings-cases.json",
    agents: ["fake-agent"],
    strategies: ["raw-full-file", "my-dev-kit-guided"],
    complexityLevels: ["short"],
    totalRuns: 2,
    completedRuns: 2,
    failedRuns: 0,
    skippedRuns: 0,
    unavailableRuns: 0,
    limitReachedRuns: 0,
    timeoutRuns: 0,
    invalidOutputRuns: 0,
    totalComparisons: 1,
    averageTokenSavingsPercent: 10,
    averageDurationReductionPercent: 10,
    averageCorrectnessDelta: 0,
    answerDoesMyDevKitSaveTokens: true,
    answerDoesMyDevKitPreserveCorrectness: true,
    answerDoesMyDevKitReduceExecutionTime: true,
    warnings: []
  };

  function comparison(overrides: Partial<ExperimentComparison> = {}): ExperimentComparison {
    return {
      comparisonId: "c",
      caseId: "case",
      benchmarkProject: "todo-ts",
      agentId: "fake-agent",
      complexityLevel: "short",
      rawStatus: "completed",
      myDevKitStatus: "completed",
      rawCorrectnessScore: 1,
      myDevKitCorrectnessScore: 1,
      sameCorrectnessPass: true,
      tokenComparisonAvailable: true,
      tokenSavingsPercent: 10,
      durationReductionPercent: 10,
      reliabilityLabel: "strong",
      warnings: [],
      ...overrides
    };
  }

  it("answers token savings yes, no, and unavailable", () => {
    expect(buildAggregateAnswers({ summary, runs: [makeExperimentRun()], comparisons: [comparison({ tokenSavingsPercent: 5 })] }).doesMyDevKitSaveTokens).toBe("yes");
    expect(buildAggregateAnswers({ summary, runs: [makeExperimentRun()], comparisons: [comparison({ tokenSavingsPercent: -5 })] }).doesMyDevKitSaveTokens).toBe("no");
    expect(
      buildAggregateAnswers({
        summary,
        runs: [makeExperimentRun()],
        comparisons: [comparison({ tokenComparisonAvailable: false, tokenSavingsPercent: undefined })]
      }).doesMyDevKitSaveTokens
    ).toBe("unavailable");
  });

  it("answers correctness preserved yes and mixed", () => {
    expect(buildAggregateAnswers({ summary, runs: [makeExperimentRun()], comparisons: [comparison()] }).doesMyDevKitPreserveCorrectness).toBe("yes");
    expect(
      buildAggregateAnswers({
        summary,
        runs: [makeExperimentRun()],
        comparisons: [comparison(), comparison({ comparisonId: "c2", sameCorrectnessPass: false })]
      }).doesMyDevKitPreserveCorrectness
    ).toBe("mixed");
  });

  it("answers execution time reduced yes and inconclusive with external outcomes", () => {
    expect(buildAggregateAnswers({ summary, runs: [makeExperimentRun()], comparisons: [comparison({ durationReductionPercent: 20 })] }).doesMyDevKitReduceExecutionTime).toBe("yes");
    expect(
      buildAggregateAnswers({
        summary: { ...summary, timeoutRuns: 1, completedRuns: 1 },
        runs: [makeExperimentRun({ status: "timeout" })],
        comparisons: [comparison({ rawStatus: "completed", myDevKitStatus: "timeout", durationReductionPercent: undefined })]
      }).doesMyDevKitPreserveCorrectness
    ).toBe("inconclusive");
  });
});
