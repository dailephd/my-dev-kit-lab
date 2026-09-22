import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  REQUIRED_BENCHMARK_PROJECT_IDS,
  validateAnswerKey,
  validateBenchmarkProjectProfiles,
  validateWarmIndexBenchmarkCases,
  validateWarmIndexBenchmarkSuiteCoverage
} from "../../src/evaluation/benchmarkMetadata.js";
import { PROJECT_COMPLEXITY_FORMULA, calculateProjectComplexityScore } from "../../src/evaluation/projectComplexity.js";
import type { BenchmarkProjectProfilesContract, EvaluationCaseInput } from "../../src/evaluation/types.js";

const rootDir = process.cwd();
const casesPath = path.join(rootDir, "benchmarks", "contracts", "todo-benchmark-case.json");
const profilesPath = path.join(rootDir, "benchmarks", "contracts", "benchmark-project-profiles.json");
const warmIndexCasesPath = path.join(rootDir, "benchmarks", "contracts", "warm-index-benchmark-cases.json");

describe("benchmark contracts", () => {
  it("parses todo-benchmark-case.json", () => {
    expect(() => JSON.parse(readFileSync(casesPath, "utf8"))).not.toThrow();
  });

  it("parses benchmark-project-profiles.json", () => {
    expect(() => JSON.parse(readFileSync(profilesPath, "utf8"))).not.toThrow();
  });

  it("uses unique case ids", () => {
    const cases = JSON.parse(readFileSync(casesPath, "utf8")) as Array<{ id: string }>;
    const ids = cases.map((benchmarkCase) => benchmarkCase.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("requires fields on every case", () => {
    const cases = JSON.parse(readFileSync(casesPath, "utf8")) as Array<Record<string, unknown>>;
    for (const benchmarkCase of cases) {
      expect(benchmarkCase.id).toBeTypeOf("string");
      expect(benchmarkCase.title).toBeTypeOf("string");
      expect(benchmarkCase.task).toBeTypeOf("string");
      expect(benchmarkCase.query).toBeTypeOf("string");
      expect(benchmarkCase.expectedOperation).toBeTypeOf("string");
      expect(Array.isArray(benchmarkCase.expectedSymbols)).toBe(true);
      expect(Array.isArray(benchmarkCase.rawIncludeGlobs)).toBe(true);
      expect(benchmarkCase.answerKey).toBeTypeOf("object");
      expect(benchmarkCase.notes).toBeTypeOf("string");
    }
  });

  it("requires valid answer keys on every case", () => {
    const cases = JSON.parse(readFileSync(casesPath, "utf8")) as Array<{ id: string; answerKey: unknown }>;
    for (const benchmarkCase of cases) {
      expect(validateAnswerKey(benchmarkCase.answerKey, benchmarkCase.id)).toEqual([]);
      const answerKey = benchmarkCase.answerKey as { expectedFacts: Array<{ id: string }>; minimumCorrectFacts: number };
      const factIds = answerKey.expectedFacts.map((fact) => fact.id);
      expect(new Set(factIds).size).toBe(factIds.length);
      expect(answerKey.minimumCorrectFacts).toBeLessThanOrEqual(answerKey.expectedFacts.length);
    }
  });

  it("uses only known project ids in expectedFilesByProject", () => {
    const cases = JSON.parse(readFileSync(casesPath, "utf8")) as Array<{ expectedFilesByProject: Record<string, string[]> }>;
    for (const benchmarkCase of cases) {
      expect(Object.keys(benchmarkCase.expectedFilesByProject).every((projectId) => REQUIRED_BENCHMARK_PROJECT_IDS.includes(projectId as never))).toBe(
        true
      );
    }
  });

  it("contains required benchmark project profiles", () => {
    const contract = JSON.parse(readFileSync(profilesPath, "utf8")) as BenchmarkProjectProfilesContract;
    expect(contract.profiles.map((profile) => profile.projectId).sort()).toEqual([...REQUIRED_BENCHMARK_PROJECT_IDS].sort());
    expect(validateBenchmarkProjectProfiles(contract.profiles, rootDir)).toEqual([]);
  });

  it("stores numeric nonnegative complexity metrics and formula scores", () => {
    const contract = JSON.parse(readFileSync(profilesPath, "utf8")) as BenchmarkProjectProfilesContract;
    for (const profile of contract.profiles) {
      expect(profile.complexityFormula.id).toBe(PROJECT_COMPLEXITY_FORMULA.id);
      expect(profile.complexityScore).toBeGreaterThanOrEqual(0);
      expect(profile.complexityScore).toBeLessThanOrEqual(100);
      expect(calculateProjectComplexityScore(profile.complexityMetrics)).toBe(profile.complexityScore);
      for (const value of Object.values(profile.complexityMetrics)) {
        if (typeof value === "number") {
          expect(value).toBeGreaterThanOrEqual(0);
        }
      }
    }
  });

  it("uses mixed-language complexity metadata for todo-mixed-ts-py", () => {
    const contract = JSON.parse(readFileSync(profilesPath, "utf8")) as BenchmarkProjectProfilesContract;
    const mixed = contract.profiles.find((profile) => profile.projectId === "todo-mixed-ts-py");
    expect(mixed?.complexityLevel).toBe("mixed-language");
    expect(mixed?.complexityMetrics.languageCount).toBeGreaterThan(1);
  });

  describe("warm-index benchmark corpus", () => {
    const readWarmIndexCases = () => JSON.parse(readFileSync(warmIndexCasesPath, "utf8")) as EvaluationCaseInput[];
    const findCase = (id: string) => readWarmIndexCases().find((benchmarkCase) => benchmarkCase.id === id)!;

    it("keeps the planner-defined case order, projects, and localities", () => {
      expect(readWarmIndexCases().map((benchmarkCase) => [benchmarkCase.id, benchmarkCase.benchmarkProject, benchmarkCase.taskLocality])).toEqual([
        ["warm-medium-import-dedupe", "task-workflow-medium-ts", "cross-module"],
        ["warm-medium-create-project-task", "task-workflow-medium-ts", "cross-module"],
        ["warm-medium-complete-idempotent", "task-workflow-medium-ts", "localized"],
        ["warm-medium-composite-filter", "task-workflow-medium-ts", "cross-module"],
        ["warm-medium-project-summary", "task-workflow-medium-ts", "cross-module"],
        ["warm-medium-broad-workflow-map", "task-workflow-medium-ts", "broad-change"],
        ["warm-large-health-label", "task-analytics-large-mixed", "cross-module"],
        ["warm-large-ts-analytics-snapshot", "task-analytics-large-mixed", "cross-module"],
        ["warm-large-ts-leaderboard", "task-analytics-large-mixed", "localized"],
        ["warm-large-python-parser-metrics", "task-analytics-large-mixed", "cross-module"],
        ["warm-large-python-pipeline", "task-analytics-large-mixed", "cross-module"],
        ["warm-large-broad-analytics-comparison", "task-analytics-large-mixed", "broad-change"]
      ]);
    });

    it.each(["task-workflow-medium-ts", "task-analytics-large-mixed"])("gives %s six cases with 1 localized, 4 cross-module, 1 broad-change", (projectId) => {
      const localities = readWarmIndexCases()
        .filter((benchmarkCase) => benchmarkCase.benchmarkProject === projectId)
        .map((benchmarkCase) => benchmarkCase.taskLocality);
      expect(localities).toHaveLength(6);
      expect({
        localized: localities.filter((locality) => locality === "localized").length,
        crossModule: localities.filter((locality) => locality === "cross-module").length,
        broadChange: localities.filter((locality) => locality === "broad-change").length
      }).toEqual({ localized: 1, crossModule: 4, broadChange: 1 });
    });

    it("classifies only the intended controls as localized", () => {
      expect(
        readWarmIndexCases()
          .filter((benchmarkCase) => benchmarkCase.taskLocality === "localized")
          .map((benchmarkCase) => benchmarkCase.id)
      ).toEqual(["warm-medium-complete-idempotent", "warm-large-ts-leaderboard"]);
    });

    it("passes strict validation, including file existence and answer-key parity, and suite coverage", () => {
      const contract = JSON.parse(readFileSync(profilesPath, "utf8")) as BenchmarkProjectProfilesContract;
      const warmIndexCases = readWarmIndexCases();
      expect(warmIndexCases).toHaveLength(12);
      expect(validateWarmIndexBenchmarkCases(warmIndexCases, contract.profiles, rootDir)).toEqual([]);
      expect(validateWarmIndexBenchmarkSuiteCoverage(warmIndexCases)).toEqual([]);
      for (const benchmarkCase of warmIndexCases) {
        expect(benchmarkCase.answerKey?.expectedFiles).toEqual(benchmarkCase.expectedFiles);
        expect(benchmarkCase.answerKey?.expectedSymbols).toEqual(benchmarkCase.expectedSymbols);
      }
    });

    it("keeps the medium broad workflow negative control wide", () => {
      const broad = findCase("warm-medium-broad-workflow-map");
      expect(broad.taskLocality).toBe("broad-change");
      expect(broad.expectedFiles).toEqual([
        "src/services/createTask.ts",
        "src/services/importTasks.ts",
        "src/services/filterTasks.ts",
        "src/services/completeTask.ts",
        "src/services/summarizeTasks.ts",
        "src/store/taskStore.ts",
        "src/validation/taskValidation.ts"
      ]);
      expect(broad.expectedSymbols).toEqual([
        "createTask",
        "importTasks",
        "filterTasks",
        "completeTask",
        "summarizeTasks",
        "TaskWorkflowStore",
        "validateImportInput"
      ]);
    });

    it("keeps the large broad analytics negative control across both languages without runtime coupling", () => {
      const broad = findCase("warm-large-broad-analytics-comparison");
      expect(broad.taskLocality).toBe("broad-change");
      expect(broad.expectedFiles.filter((file) => file.startsWith("ts/src/"))).toHaveLength(3);
      expect(broad.expectedFiles.filter((file) => file.startsWith("py/task_analytics/"))).toHaveLength(5);
      expect(broad.expectedSymbols).toEqual([
        "buildAnalyticsSnapshot",
        "formatTaskHealthReport",
        "buildProjectLeaderboard",
        "parse_task_rows",
        "calculate_project_metrics",
        "determine_quality_label",
        "build_health_report",
        "build_report_from_rows"
      ]);
      expect(broad.answerKey?.forbiddenWrongClaims).toEqual([
        "The TypeScript implementation invokes the Python analytics pipeline.",
        "Python is a runtime backend for the TypeScript analytics implementation.",
        "The TypeScript or Python implementation directly imports or calls the other."
      ]);
      expect(broad.answerKey?.expectedFacts.map((fact) => fact.id)).toContain("warm-large-broad-independent-implementations");
    });
  });
});
