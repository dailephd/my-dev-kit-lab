import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  MIN_WARM_INDEX_TASKS_PER_PROJECT,
  REQUIRED_WARM_INDEX_BENCHMARK_PROJECT_IDS,
  deriveWarmIndexTaskStats,
  readBenchmarkProjectProfiles,
  validateBenchmarkProjectProfiles,
  validateWarmIndexBenchmarkCases,
  validateWarmIndexBenchmarkSuiteCoverage
} from "../../src/evaluation/benchmarkMetadata.js";
import { calculateProjectComplexityScore } from "../../src/evaluation/projectComplexity.js";
import { TASK_LOCALITIES } from "../../src/evaluation/types.js";
import type { BenchmarkProjectProfile, EvaluationCaseInput, TaskLocality } from "../../src/evaluation/types.js";

describe("benchmark metadata helpers", () => {
  it("reads benchmark project profiles", async () => {
    const profiles = await readBenchmarkProjectProfiles(
      path.join(process.cwd(), "benchmarks", "contracts", "benchmark-project-profiles.json"),
      process.cwd()
    );
    expect(profiles).toHaveLength(6);
    expect(profiles.map((profile) => profile.projectId).sort()).toEqual([
      "task-analytics-large-mixed",
      "task-workflow-medium-ts",
      "todo-js",
      "todo-mixed-ts-py",
      "todo-python",
      "todo-ts"
    ]);
  });

  it("keeps complexity scores stable for current benchmark projects", async () => {
    const profiles = await readBenchmarkProjectProfiles(
      path.join(process.cwd(), "benchmarks", "contracts", "benchmark-project-profiles.json"),
      process.cwd()
    );
    const scores = Object.fromEntries(profiles.map((profile) => [profile.projectId, calculateProjectComplexityScore(profile.complexityMetrics)]));
    expect(scores["todo-js"]).toBe(12);
    expect(scores["todo-python"]).toBe(12);
    expect(scores["todo-ts"]).toBe(12);
    expect(scores["todo-mixed-ts-py"]).toBe(16);
    expect(scores["task-workflow-medium-ts"]).toBeGreaterThan(scores["todo-ts"]);
    expect(scores["task-analytics-large-mixed"]).toBeGreaterThan(scores["task-workflow-medium-ts"]);
  });

  it("still rejects a complexityScore that disagrees with the formula", async () => {
    const profiles = await readProfiles();
    expect(validateBenchmarkProjectProfiles(profiles, rootDir)).toEqual([]);
    const medium = profiles.find((profile) => profile.projectId === "task-workflow-medium-ts")!;
    medium.complexityScore += 1;
    expect(validateBenchmarkProjectProfiles(profiles, rootDir)).toContain(
      `profile task-workflow-medium-ts: complexityScore ${medium.complexityScore} does not match formula score ${medium.complexityScore - 1}.`
    );
  });
});

const rootDir = process.cwd();

async function readProfiles(): Promise<BenchmarkProjectProfile[]> {
  return readBenchmarkProjectProfiles(path.join(rootDir, "benchmarks", "contracts", "benchmark-project-profiles.json"), rootDir);
}

function readWarmIndexCases(): EvaluationCaseInput[] {
  return JSON.parse(readFileSync(path.join(rootDir, "benchmarks", "contracts", "warm-index-benchmark-cases.json"), "utf8")) as EvaluationCaseInput[];
}

function syntheticCase(projectId: string, fileCount: number, symbolCount: number): EvaluationCaseInput {
  return {
    id: `${projectId}-${fileCount}-${symbolCount}`,
    title: "Synthetic",
    benchmarkProject: projectId,
    targetRoot: ".",
    sourceRoots: ["src"],
    query: "q",
    expectedFiles: Array.from({ length: fileCount }, (_, index) => `src/file${index}.ts`),
    expectedSymbols: Array.from({ length: symbolCount }, (_, index) => `symbol${index}`),
    rawIncludeGlobs: ["src/**/*"]
  };
}

describe("warm-index benchmark corpus validation", () => {
  async function validateMutated(mutate: (cases: EvaluationCaseInput[], profiles: BenchmarkProjectProfile[]) => void): Promise<string[]> {
    const profiles = await readProfiles();
    const cases = readWarmIndexCases();
    mutate(cases, profiles);
    return validateWarmIndexBenchmarkCases(cases, profiles, rootDir);
  }

  const medium = (cases: EvaluationCaseInput[]) => cases.find((benchmarkCase) => benchmarkCase.id === "warm-medium-import-dedupe")!;
  const large = (cases: EvaluationCaseInput[]) => cases.find((benchmarkCase) => benchmarkCase.id === "warm-large-health-label")!;

  it("accepts the production seed corpus", async () => {
    expect(await validateMutated(() => undefined)).toEqual([]);
  });

  it("requires taskLocality on every strict corpus case", async () => {
    const errors = await validateMutated((cases) => {
      delete medium(cases).taskLocality;
    });
    expect(errors).toEqual([
      "warm-index case warm-medium-import-dedupe: missing taskLocality; expected one of localized, cross-module, broad-change."
    ]);
  });

  it("rejects an invalid taskLocality in the strict corpus", async () => {
    const errors = await validateMutated((cases) => {
      (medium(cases) as Record<string, unknown>).taskLocality = "cross-language";
    });
    expect(errors).toEqual([
      'warm-index case warm-medium-import-dedupe: taskLocality must be one of localized, cross-module, broad-change (received "cross-language").'
    ]);
  });

  it("rejects duplicate case ids", async () => {
    const errors = await validateMutated((cases) => {
      large(cases).id = "warm-medium-import-dedupe";
    });
    expect(errors).toContain("warm-index case warm-medium-import-dedupe: duplicate case id.");
  });

  it("requires projectProfileRef to equal benchmarkProject", async () => {
    const mismatched = await validateMutated((cases) => {
      medium(cases).projectProfileRef = "task-analytics-large-mixed";
    });
    expect(mismatched).toEqual([
      "warm-index case warm-medium-import-dedupe: projectProfileRef task-analytics-large-mixed must equal benchmarkProject task-workflow-medium-ts."
    ]);
    const missing = await validateMutated((cases) => {
      delete medium(cases).projectProfileRef;
    });
    expect(missing).toEqual(["warm-index case warm-medium-import-dedupe: missing projectProfileRef."]);
  });

  it("rejects an unknown benchmark project profile", async () => {
    const errors = await validateMutated((cases) => {
      medium(cases).benchmarkProject = "missing-project";
      medium(cases).projectProfileRef = "missing-project";
    });
    expect(errors).toContain("warm-index case warm-medium-import-dedupe: unknown benchmark project profile missing-project.");
  });

  it("requires targetRoot to match the profile rootPath", async () => {
    const errors = await validateMutated((cases) => {
      medium(cases).targetRoot = "benchmarks/projects/todo-ts";
    });
    expect(errors).toContain(
      "warm-index case warm-medium-import-dedupe: targetRoot benchmarks/projects/todo-ts does not match profile task-workflow-medium-ts rootPath benchmarks/projects/task-workflow-medium-ts."
    );
    const normalized = await validateMutated((cases) => {
      medium(cases).targetRoot = "./benchmarks/projects/task-workflow-medium-ts/";
    });
    expect(normalized).toEqual([]);
  });

  it("rejects unknown, missing, and duplicate source roots", async () => {
    const unknown = await validateMutated((cases) => {
      medium(cases).sourceRoots = ["src", "tests", "lib"];
    });
    expect(unknown).toContain(
      'warm-index case warm-medium-import-dedupe: unknown source root "lib" for profile task-workflow-medium-ts; allowed roots: src, tests.'
    );
    const missing = await validateMutated((cases) => {
      large(cases).sourceRoots = ["ts/src", "ts/tests", "py/task_analytics"];
    });
    expect(missing).toContain(
      "warm-index case warm-large-health-label: missing profile source/test root py/tests for profile task-analytics-large-mixed."
    );
    const duplicate = await validateMutated((cases) => {
      medium(cases).sourceRoots = ["src", "tests", "src"];
    });
    expect(duplicate).toContain('warm-index case warm-medium-import-dedupe: duplicate source root "src".');
  });

  it("accepts a reordered source-root layout that still covers every profile root", async () => {
    const errors = await validateMutated((cases) => {
      for (const benchmarkCase of cases.filter((candidate) => candidate.benchmarkProject === "task-analytics-large-mixed")) {
        benchmarkCase.sourceRoots = ["py/tests", "py/task_analytics", "ts/tests", "ts/src"];
      }
    });
    expect(errors).toEqual([]);
  });

  it("requires one ordered sourceRoots layout per benchmark project", async () => {
    const errors = await validateMutated((cases) => {
      const second = structuredClone(medium(cases));
      second.id = "warm-medium-second";
      second.sourceRoots = ["tests", "src"];
      cases.push(second);
    });
    expect(errors).toContain(
      'warm-index case warm-medium-second: sourceRoots ["tests","src"] must match the ordered sourceRoots ["src","tests"] of warm-index case warm-medium-import-dedupe for project task-workflow-medium-ts.'
    );
  });

  it("keeps source-root ordering independent across benchmark projects", async () => {
    const profiles = await readProfiles();
    const todoTs = { ...syntheticCase("todo-ts", 1, 1), id: "todo-ts-case", targetRoot: "benchmarks/projects/todo-ts", sourceRoots: ["src", "tests"] };
    const todoJs = { ...syntheticCase("todo-js", 1, 1), id: "todo-js-case", targetRoot: "benchmarks/projects/todo-js", sourceRoots: ["tests", "src"] };
    const errors = validateWarmIndexBenchmarkCases([todoTs, todoJs], profiles, rootDir);
    expect(errors.filter((error) => error.includes("ordered sourceRoots"))).toEqual([]);
  });

  it("requires an answerKey", async () => {
    const errors = await validateMutated((cases) => {
      delete medium(cases).answerKey;
    });
    expect(errors).toEqual(["warm-index case warm-medium-import-dedupe: missing answerKey."]);
  });

  it("reuses answer-key validation", async () => {
    const errors = await validateMutated((cases) => {
      medium(cases).answerKey!.minimumCorrectFacts = 10;
    });
    expect(errors).toContain("warm-index case warm-medium-import-dedupe: answerKey.minimumCorrectFacts cannot exceed expectedFacts length.");
  });

  it("requires nonempty expectedFiles and expectedSymbols", async () => {
    const errors = await validateMutated((cases) => {
      large(cases).expectedFiles = [];
      large(cases).expectedSymbols = [];
    });
    expect(errors).toContain("warm-index case warm-large-health-label: expectedFiles must be a nonempty array.");
    expect(errors).toContain("warm-index case warm-large-health-label: expectedSymbols must be a nonempty array.");
  });

  const fileParity = "warm-index case warm-large-health-label: expectedFiles must exactly match answerKey.expectedFiles (same values in the same order).";
  const symbolParity =
    "warm-index case warm-large-health-label: expectedSymbols must exactly match answerKey.expectedSymbols (same values in the same order).";

  it.each([
    ["missing value", (values: string[]) => values.slice(1)],
    ["extra value", (values: string[]) => [...values, "ts/src/index.ts"]],
    ["ordering mismatch", (values: string[]) => [...values].reverse()]
  ])("rejects expectedFiles/answerKey drift: %s", async (_label, change) => {
    const errors = await validateMutated((cases) => {
      large(cases).answerKey!.expectedFiles = change(large(cases).answerKey!.expectedFiles);
    });
    expect(errors).toEqual([fileParity]);
  });

  it.each([
    ["missing value", (values: string[]) => values.slice(1)],
    ["extra value", (values: string[]) => [...values, "extraSymbol"]],
    ["ordering mismatch", (values: string[]) => [...values].reverse()]
  ])("rejects expectedSymbols/answerKey drift: %s", async (_label, change) => {
    const errors = await validateMutated((cases) => {
      large(cases).answerKey!.expectedSymbols = change(large(cases).answerKey!.expectedSymbols);
    });
    expect(errors).toEqual([symbolParity]);
  });

  it("requires expected files to exist under the case target root", async () => {
    const errors = await validateMutated((cases) => {
      medium(cases).expectedFiles[0] = "src/services/missingImport.ts";
      medium(cases).answerKey!.expectedFiles[0] = "src/services/missingImport.ts";
    });
    expect(errors).toEqual([
      "warm-index case warm-medium-import-dedupe: expected file does not exist in task-workflow-medium-ts: src/services/missingImport.ts."
    ]);
  });

  it("derives task statistics from matching cases rounded to two decimals", () => {
    const cases = [syntheticCase("p", 1, 1), syntheticCase("p", 2, 1), syntheticCase("p", 2, 2), syntheticCase("other", 9, 9)];
    expect(deriveWarmIndexTaskStats(cases, "p")).toEqual({
      taskCount: 3,
      expectedRelevantFilesAverage: 1.67,
      expectedRelevantSymbolsAverage: 1.33
    });
    expect(deriveWarmIndexTaskStats(cases, "missing")).toEqual({
      taskCount: 0,
      expectedRelevantFilesAverage: 0,
      expectedRelevantSymbolsAverage: 0
    });
  });

  it.each([
    ["task-workflow-medium-ts", { taskCount: 6, expectedRelevantFilesAverage: 3.83, expectedRelevantSymbolsAverage: 4.33 }, 31],
    ["task-analytics-large-mixed", { taskCount: 6, expectedRelevantFilesAverage: 4.5, expectedRelevantSymbolsAverage: 4.67 }, 47]
  ] as const)("derives %s corpus statistics that match its profile and formula score", async (projectId, expectedStats, expectedScore) => {
    const stats = deriveWarmIndexTaskStats(readWarmIndexCases(), projectId);
    expect(stats).toEqual(expectedStats);
    const profile = (await readProfiles()).find((candidate) => candidate.projectId === projectId)!;
    expect({
      taskCount: profile.complexityMetrics.taskCount,
      expectedRelevantFilesAverage: profile.complexityMetrics.expectedRelevantFilesAverage,
      expectedRelevantSymbolsAverage: profile.complexityMetrics.expectedRelevantSymbolsAverage
    }).toEqual(stats);
    expect(profile.complexityScore).toBe(expectedScore);
    expect(calculateProjectComplexityScore(profile.complexityMetrics)).toBe(expectedScore);
  });

  it.each([
    ["taskCount", 5, "profile task-workflow-medium-ts: complexityMetrics.taskCount 5 does not match warm-index corpus value 6."],
    [
      "expectedRelevantFilesAverage",
      3.5,
      "profile task-workflow-medium-ts: complexityMetrics.expectedRelevantFilesAverage 3.5 does not match warm-index corpus value 3.83."
    ],
    [
      "expectedRelevantSymbolsAverage",
      4.5,
      "profile task-workflow-medium-ts: complexityMetrics.expectedRelevantSymbolsAverage 4.5 does not match warm-index corpus value 4.33."
    ]
  ] as const)("rejects profile %s drift from the corpus", async (field, value, message) => {
    const errors = await validateMutated((_cases, profiles) => {
      profiles.find((profile) => profile.projectId === "task-workflow-medium-ts")!.complexityMetrics[field] = value;
    });
    expect(errors).toEqual([message]);
  });
});

describe("warm-index benchmark suite coverage", () => {
  const coverageCase = (projectId: string, index: number, taskLocality: TaskLocality): EvaluationCaseInput => ({
    ...syntheticCase(projectId, 1, 1),
    id: `${projectId}-${index}`,
    taskLocality
  });
  const coveredProject = (projectId: string, count = 5): EvaluationCaseInput[] =>
    Array.from({ length: count }, (_, index) =>
      coverageCase(projectId, index, index === 0 ? "localized" : index === count - 1 ? "broad-change" : "cross-module")
    );

  it("requires the medium and large warm-index projects with a minimum of five tasks", () => {
    expect([...REQUIRED_WARM_INDEX_BENCHMARK_PROJECT_IDS]).toEqual(["task-workflow-medium-ts", "task-analytics-large-mixed"]);
    expect(MIN_WARM_INDEX_TASKS_PER_PROJECT).toBe(5);
  });

  it("accepts the production corpus", () => {
    expect(validateWarmIndexBenchmarkSuiteCoverage(readWarmIndexCases())).toEqual([]);
  });

  it("accepts the minimum and larger project suites", () => {
    expect(
      validateWarmIndexBenchmarkSuiteCoverage([
        ...coveredProject("task-workflow-medium-ts", 5),
        ...coveredProject("task-analytics-large-mixed", 9)
      ])
    ).toEqual([]);
  });

  it.each(["task-workflow-medium-ts", "task-analytics-large-mixed"])("rejects %s with only four cases", (projectId) => {
    const cases = [
      ...coveredProject("task-workflow-medium-ts"),
      ...coveredProject("task-analytics-large-mixed")
    ].filter((benchmarkCase) => benchmarkCase.benchmarkProject !== projectId);
    cases.push(...coveredProject(projectId, 4));
    expect(validateWarmIndexBenchmarkSuiteCoverage(cases)).toEqual([
      `warm-index suite: project ${projectId} has 4 cases; at least 5 are required.`
    ]);
  });

  it.each(TASK_LOCALITIES.map((locality) => [locality]))("rejects a required project without any %s case", (locality) => {
    const replacement: TaskLocality = locality === "cross-module" ? "localized" : "cross-module";
    const medium = coveredProject("task-workflow-medium-ts").map((benchmarkCase) =>
      benchmarkCase.taskLocality === locality ? { ...benchmarkCase, taskLocality: replacement } : benchmarkCase
    );
    expect(validateWarmIndexBenchmarkSuiteCoverage([...medium, ...coveredProject("task-analytics-large-mixed")])).toEqual([
      `warm-index suite: project task-workflow-medium-ts has no ${locality} case.`
    ]);
  });

  it.each(["task-workflow-medium-ts", "task-analytics-large-mixed"])("rejects a corpus missing %s", (projectId) => {
    const cases = [...coveredProject("task-workflow-medium-ts"), ...coveredProject("task-analytics-large-mixed")].filter(
      (benchmarkCase) => benchmarkCase.benchmarkProject !== projectId
    );
    expect(validateWarmIndexBenchmarkSuiteCoverage(cases)).toEqual([`warm-index suite: missing required benchmark project ${projectId}.`]);
  });

  it("does not apply suite coverage to other benchmark projects", () => {
    const cases = [
      ...coveredProject("task-workflow-medium-ts"),
      ...coveredProject("task-analytics-large-mixed"),
      coverageCase("todo-ts", 0, "localized")
    ];
    expect(validateWarmIndexBenchmarkSuiteCoverage(cases)).toEqual([]);
  });
});
