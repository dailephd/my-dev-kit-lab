import { describe, expect, it } from "vitest";
import { renderExperimentHtmlReport } from "../../src/report/index.js";
import type { ExperimentReportInput } from "../../src/report/experimentReportTypes.js";
import { makeExperimentRun } from "../evaluation/experimentTestHelpers.js";

function reportInput(): ExperimentReportInput {
  const run = makeExperimentRun({ statusReason: "<script>alert(1)</script>" });
  return {
    generatedAt: "2026-01-01T00:00:00.000Z",
    sourceExperimentDir: "lab-output/experiment",
    title: "Experiment <Report>",
    subtitle: "Subtitle",
    executiveSummary: {
      doesMyDevKitSaveTokens: "yes",
      doesMyDevKitPreserveCorrectness: "yes",
      doesMyDevKitReduceExecutionTime: "yes",
      completedRuns: 2,
      failedRuns: 0,
      unavailableRuns: 0,
      limitReachedRuns: 0,
      timeoutRuns: 0,
      invalidOutputRuns: 0,
      comparisonReliabilityCounts: { strong: 1 },
      summaryText: "Executive summary"
    },
    methodology: ["Methodology text"],
    projectProfiles: [
      {
        profile: {
          projectId: "todo-ts",
          displayName: "Todo TS",
          description: "Project description",
          languageMix: "TypeScript",
          primaryLanguage: "typescript",
          languages: ["typescript"],
          complexityLevel: "small",
          complexityScore: 12,
          complexityMetrics: {
            fileCount: 1,
            sourceFileCount: 1,
            testFileCount: 0,
            totalLinesOfCode: 10,
            sourceLinesOfCode: 10,
            testLinesOfCode: 0,
            languageCount: 1,
            dependencyFileCount: 0,
            internalImportCount: 0,
            exportedSymbolEstimate: 1,
            taskCount: 1,
            expectedRelevantFilesAverage: 1,
            expectedRelevantSymbolsAverage: 1,
            maxFileLines: 10,
            averageFileLines: 10
          },
          complexityFormula: {
            id: "formula",
            description: "formula",
            scoreRange: [0, 100],
            normalizedValue: "x",
            weights: {
              sourceFileCount: 0,
              sourceLinesOfCode: 0,
              languageCount: 0,
              internalImportCount: 0,
              maxFileLines: 0,
              expectedRelevantFilesAverage: 0,
              expectedRelevantSymbolsAverage: 0
            },
            caps: {
              sourceFileCount: 1,
              sourceLinesOfCode: 1,
              languageCount: 1,
              internalImportCount: 1,
              maxFileLines: 1,
              expectedRelevantFilesAverage: 1,
              expectedRelevantSymbolsAverage: 1
            }
          },
          rootPath: "benchmarks/projects/todo-ts",
          sourceRoots: ["src"],
          testRoots: ["tests"],
          fileTree: { entries: [] },
          benchmarkPurpose: "purpose",
          expectedUseCases: ["use"]
        },
        complexityMetrics: { fileCount: 1 }
      }
    ],
    benchmarkCases: [
      {
        caseId: "case",
        title: "Task",
        benchmarkProject: "todo-ts",
        query: "query",
        expectedFiles: ["src/taskService.ts"],
        expectedSymbols: ["createTask"],
        expectedFacts: [{ id: "fact", required: true, weight: 1, text: "fact text" }],
        minimumCorrectFacts: 1
      }
    ],
    fileTreeSections: [{ projectId: "todo-ts", entries: [{ path: "src/taskService.ts", kind: "file", role: "source", language: "typescript", lines: 10 }], totalEntries: 1, truncated: false }],
    promptComparisonSections: [{ runId: run.runId, caseId: run.caseId, agentId: run.agentId, strategy: run.promptStrategy, complexityLevel: run.promptComplexityLevel, promptExcerpt: "Prompt text", promptWasTruncated: false, metrics: run.promptMetrics }],
    agentRunSections: [run],
    correctnessSections: [run],
    tokenSections: [{ comparisonId: "c", caseId: "case", benchmarkProject: "todo-ts", agentId: "fake-agent", complexityLevel: "short", sameCorrectnessPass: true, tokenComparisonAvailable: true, tokenSavingsPercent: 10, durationReductionPercent: 10, reliabilityLabel: "strong", warnings: [] }],
    timingSections: [{ comparisonId: "c", caseId: "case", benchmarkProject: "todo-ts", agentId: "fake-agent", complexityLevel: "short", sameCorrectnessPass: true, tokenComparisonAvailable: true, tokenSavingsPercent: 10, durationReductionPercent: 10, reliabilityLabel: "strong", warnings: [] }],
    comparisonSections: [{ comparisonId: "c", caseId: "case", benchmarkProject: "todo-ts", agentId: "fake-agent", complexityLevel: "short", sameCorrectnessPass: true, tokenComparisonAvailable: true, tokenSavingsPercent: 10, durationReductionPercent: 10, reliabilityLabel: "strong", warnings: [] }],
    plotSections: [],
    visualizationSections: [],
    formulaSections: [
      { id: "correctness", title: "Correctness Score", formula: "correctnessScore = 0.25 * fileMatchScore + 0.25 * symbolMatchScore + 0.50 * factMatchScore", notes: ["pass"] },
      { id: "tokens", title: "Token Savings", formula: "tokenDelta = rawTotalTokens - myDevKitTotalTokens", notes: ["tokens"] },
      { id: "timing", title: "Execution Time Reduction", formula: "durationDeltaMs = rawDurationMs - myDevKitDurationMs", notes: ["timing"] }
    ],
    limitations: ["limitation"],
    warnings: ["warning"],
    artifactLinks: [{ label: "summary", path: "experiment-summary.json", kind: "json" }],
    nextSteps: ["next"],
    rawArtifacts: {
      summary: {
        generatedAt: "2026-01-01T00:00:00.000Z",
        casesPath: "examples/token-savings-cases.json",
        agents: ["fake-agent"],
        strategies: ["raw-full-file"],
        complexityLevels: ["short"],
        totalRuns: 1,
        completedRuns: 1,
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
      },
      runs: [run],
      comparisons: [],
      config: {}
    }
  };
}

describe("renderExperimentHtmlReport", () => {
  it("renders required sections and formulas without external assets", () => {
    const html = renderExperimentHtmlReport(reportInput());
    expect(html).toContain("Experiment &lt;Report&gt;");
    expect(html).toContain("Executive Summary");
    expect(html).toContain("Methodology");
    expect(html).toContain("Benchmark Projects");
    expect(html).toContain("File Trees");
    expect(html).toContain("Prompt Strategies");
    expect(html).toContain("Agent Runs");
    expect(html).toContain("correctnessScore");
    expect(html).toContain("tokenDelta");
    expect(html).toContain("durationDeltaMs");
    expect(html).toContain("Positive means my-dev-kit used fewer tokens");
    expect(html).toContain("Negative means my-dev-kit used more tokens");
    expect(html).toContain("Correctness score is deterministic");
    expect(html).toContain("Complexity score is a 0-100 weighted score");
    expect(html).toContain("Run status records");
    expect(html).toContain("Reliability label");
    expect(html).toContain("Warnings and Limitations");
    expect(html).not.toContain("<script>alert");
    expect(html).not.toMatch(/https?:\/\//);
    expect(html).not.toContain("cdn");
  });
});
