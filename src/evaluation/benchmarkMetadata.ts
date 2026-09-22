import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { PROJECT_COMPLEXITY_FORMULA, calculateProjectComplexityScore, roundToTwo } from "./projectComplexity.js";
import { TASK_LOCALITIES } from "./types.js";
import type {
  BenchmarkProjectProfile,
  BenchmarkProjectProfilesContract,
  BenchmarkTaskAnswerKey,
  EvaluationCaseInput,
  ProjectComplexityMetrics,
  ProjectFileTreeEntry
} from "./types.js";

export type WarmIndexTaskStats = {
  taskCount: number;
  expectedRelevantFilesAverage: number;
  expectedRelevantSymbolsAverage: number;
};

export const REQUIRED_BENCHMARK_PROJECT_IDS = [
  "todo-ts",
  "todo-python",
  "todo-js",
  "todo-mixed-ts-py",
  "task-workflow-medium-ts",
  "task-analytics-large-mixed"
] as const;
export const VALID_COMPLEXITY_LEVELS = new Set(["small", "medium", "large", "mixed-language"]);
export const REQUIRED_WARM_INDEX_BENCHMARK_PROJECT_IDS = ["task-workflow-medium-ts", "task-analytics-large-mixed"] as const;
export const MIN_WARM_INDEX_TASKS_PER_PROJECT = 5;

export async function readBenchmarkProjectProfiles(
  profilesPath: string,
  repoRoot = process.cwd()
): Promise<BenchmarkProjectProfile[]> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(await readFile(profilesPath, "utf8"));
  } catch (error) {
    throw new Error(`Failed to parse benchmark project profiles: ${(error as Error).message}`);
  }
  const profiles = parseBenchmarkProjectProfiles(parsed);
  const errors = validateBenchmarkProjectProfiles(profiles, repoRoot);
  if (errors.length > 0) {
    throw new Error(`Invalid benchmark project profiles:\n${errors.join("\n")}`);
  }
  return profiles;
}

export function parseBenchmarkProjectProfiles(value: unknown): BenchmarkProjectProfile[] {
  if (!value || typeof value !== "object") {
    throw new Error("Benchmark project profiles file must contain an object.");
  }
  const contract = value as BenchmarkProjectProfilesContract;
  if (!Array.isArray(contract.profiles)) {
    throw new Error("Benchmark project profiles file must contain a profiles array.");
  }
  return contract.profiles;
}

export function validateAnswerKey(answerKey: unknown, label: string): string[] {
  const errors: string[] = [];
  if (!answerKey || typeof answerKey !== "object") {
    return [`${label}: answerKey must be an object.`];
  }
  const candidate = answerKey as BenchmarkTaskAnswerKey;
  for (const field of ["expectedFiles", "expectedSymbols", "expectedFacts"] as const) {
    if (!Array.isArray(candidate[field])) {
      errors.push(`${label}: answerKey.${field} must be an array.`);
    }
  }
  if (!Number.isInteger(candidate.minimumCorrectFacts) || candidate.minimumCorrectFacts < 0) {
    errors.push(`${label}: answerKey.minimumCorrectFacts must be a nonnegative integer.`);
  }
  if (Array.isArray(candidate.expectedFacts)) {
    const factIds = new Set<string>();
    let requiredFactCount = 0;
    for (const fact of candidate.expectedFacts) {
      if (!fact || typeof fact !== "object") {
        errors.push(`${label}: expectedFacts entries must be objects.`);
        continue;
      }
      if (typeof fact.id !== "string" || fact.id.length === 0) {
        errors.push(`${label}: expectedFacts entries must include id.`);
      } else if (factIds.has(fact.id)) {
        errors.push(`${label}: duplicate expected fact id ${fact.id}.`);
      } else {
        factIds.add(fact.id);
      }
      if (typeof fact.text !== "string" || fact.text.length === 0) {
        errors.push(`${label}: expected fact ${fact.id ?? "<unknown>"} must include text.`);
      }
      if (typeof fact.weight !== "number" || fact.weight <= 0) {
        errors.push(`${label}: expected fact ${fact.id ?? "<unknown>"} must include positive weight.`);
      }
      if (typeof fact.required !== "boolean") {
        errors.push(`${label}: expected fact ${fact.id ?? "<unknown>"} must include required boolean.`);
      }
      if (fact.required === true) {
        requiredFactCount += 1;
      }
    }
    if (Number.isInteger(candidate.minimumCorrectFacts) && candidate.minimumCorrectFacts > candidate.expectedFacts.length) {
      errors.push(`${label}: answerKey.minimumCorrectFacts cannot exceed expectedFacts length.`);
    }
    if (requiredFactCount > 0 && candidate.minimumCorrectFacts > requiredFactCount + (candidate.expectedFacts.length - requiredFactCount)) {
      errors.push(`${label}: answerKey.minimumCorrectFacts is not satisfiable.`);
    }
  }
  if (Array.isArray(candidate.expectedFiles) && candidate.expectedFiles.length === 0) {
    errors.push(`${label}: answerKey.expectedFiles must not be empty.`);
  }
  if (Array.isArray(candidate.expectedSymbols) && candidate.expectedSymbols.length === 0) {
    errors.push(`${label}: answerKey.expectedSymbols must not be empty.`);
  }
  return errors;
}

export function validateTaskLocality(value: unknown, label: string): string[] {
  if (typeof value === "string" && (TASK_LOCALITIES as readonly string[]).includes(value)) {
    return [];
  }
  return [`${label}: taskLocality must be one of ${TASK_LOCALITIES.join(", ")} (received ${JSON.stringify(value)}).`];
}

export function deriveWarmIndexTaskStats(cases: EvaluationCaseInput[], projectId: string): WarmIndexTaskStats {
  const projectCases = cases.filter((benchmarkCase) => benchmarkCase?.benchmarkProject === projectId);
  if (projectCases.length === 0) {
    return { taskCount: 0, expectedRelevantFilesAverage: 0, expectedRelevantSymbolsAverage: 0 };
  }
  const fileCounts = projectCases.map((benchmarkCase) => (Array.isArray(benchmarkCase.expectedFiles) ? benchmarkCase.expectedFiles.length : 0));
  const symbolCounts = projectCases.map((benchmarkCase) =>
    Array.isArray(benchmarkCase.expectedSymbols) ? benchmarkCase.expectedSymbols.length : 0
  );
  return {
    taskCount: projectCases.length,
    expectedRelevantFilesAverage: roundToTwo(fileCounts.reduce((total, count) => total + count, 0) / projectCases.length),
    expectedRelevantSymbolsAverage: roundToTwo(symbolCounts.reduce((total, count) => total + count, 0) / projectCases.length)
  };
}

export function validateWarmIndexBenchmarkCases(
  cases: EvaluationCaseInput[],
  profiles: BenchmarkProjectProfile[],
  repoRoot = process.cwd()
): string[] {
  const errors: string[] = [];
  const profilesById = new Map(profiles.map((profile) => [profile.projectId, profile]));
  const ids = new Set<string>();
  const sourceRootsByProject = new Map<string, { caseLabel: string; sourceRoots: string[] }>();

  cases.forEach((benchmarkCase, index) => {
    if (!benchmarkCase || typeof benchmarkCase !== "object") {
      errors.push(`warm-index case at index ${index}: must be an object.`);
      return;
    }
    const id = typeof benchmarkCase.id === "string" && benchmarkCase.id.length > 0 ? benchmarkCase.id : undefined;
    const label = id === undefined ? `warm-index case at index ${index}` : `warm-index case ${id}`;
    if (id === undefined) {
      errors.push(`${label}: id must be a nonempty string.`);
    } else if (ids.has(id)) {
      errors.push(`${label}: duplicate case id.`);
    } else {
      ids.add(id);
    }

    const projectId =
      typeof benchmarkCase.benchmarkProject === "string" && benchmarkCase.benchmarkProject.length > 0
        ? benchmarkCase.benchmarkProject
        : undefined;
    if (projectId === undefined) {
      errors.push(`${label}: benchmarkProject must be a nonempty string.`);
    }
    if (typeof benchmarkCase.projectProfileRef !== "string" || benchmarkCase.projectProfileRef.length === 0) {
      errors.push(`${label}: missing projectProfileRef.`);
    } else if (benchmarkCase.projectProfileRef !== projectId) {
      errors.push(`${label}: projectProfileRef ${benchmarkCase.projectProfileRef} must equal benchmarkProject ${projectId ?? "<missing>"}.`);
    }
    const profile = projectId === undefined ? undefined : profilesById.get(projectId);
    if (projectId !== undefined && profile === undefined) {
      errors.push(`${label}: unknown benchmark project profile ${projectId}.`);
    }

    if (benchmarkCase.taskLocality === undefined) {
      errors.push(`${label}: missing taskLocality; expected one of ${TASK_LOCALITIES.join(", ")}.`);
    } else {
      errors.push(...validateTaskLocality(benchmarkCase.taskLocality, label));
    }

    const targetRoot = typeof benchmarkCase.targetRoot === "string" && benchmarkCase.targetRoot.length > 0 ? benchmarkCase.targetRoot : undefined;
    if (targetRoot === undefined) {
      errors.push(`${label}: targetRoot must be a nonempty string.`);
    } else if (profile !== undefined && normalizeRelativeRoot(targetRoot) !== normalizeRelativeRoot(profile.rootPath ?? "")) {
      errors.push(`${label}: targetRoot ${targetRoot} does not match profile ${profile.projectId} rootPath ${profile.rootPath}.`);
    }

    if (!Array.isArray(benchmarkCase.sourceRoots) || benchmarkCase.sourceRoots.length === 0) {
      errors.push(`${label}: sourceRoots must be a nonempty array.`);
    } else {
      if (profile !== undefined) {
        errors.push(...validateWarmIndexSourceRoots(benchmarkCase.sourceRoots, profile, label));
      }
      if (projectId !== undefined) {
        const reference = sourceRootsByProject.get(projectId);
        if (reference === undefined) {
          sourceRootsByProject.set(projectId, { caseLabel: label, sourceRoots: benchmarkCase.sourceRoots });
        } else if (!sameOrderedValues(reference.sourceRoots, benchmarkCase.sourceRoots)) {
          errors.push(
            `${label}: sourceRoots ${JSON.stringify(benchmarkCase.sourceRoots)} must match the ordered sourceRoots ${JSON.stringify(reference.sourceRoots)} of ${reference.caseLabel} for project ${projectId}.`
          );
        }
      }
    }

    const expectedFiles = Array.isArray(benchmarkCase.expectedFiles) ? benchmarkCase.expectedFiles : undefined;
    const expectedSymbols = Array.isArray(benchmarkCase.expectedSymbols) ? benchmarkCase.expectedSymbols : undefined;
    if (expectedFiles === undefined || expectedFiles.length === 0) {
      errors.push(`${label}: expectedFiles must be a nonempty array.`);
    }
    if (expectedSymbols === undefined || expectedSymbols.length === 0) {
      errors.push(`${label}: expectedSymbols must be a nonempty array.`);
    }

    if (benchmarkCase.answerKey === undefined) {
      errors.push(`${label}: missing answerKey.`);
    } else {
      errors.push(...validateAnswerKey(benchmarkCase.answerKey, label));
      const answerKey = benchmarkCase.answerKey as Partial<BenchmarkTaskAnswerKey> | null;
      if (answerKey && typeof answerKey === "object") {
        if (expectedFiles !== undefined && Array.isArray(answerKey.expectedFiles) && !sameOrderedValues(expectedFiles, answerKey.expectedFiles)) {
          errors.push(`${label}: expectedFiles must exactly match answerKey.expectedFiles (same values in the same order).`);
        }
        if (
          expectedSymbols !== undefined &&
          Array.isArray(answerKey.expectedSymbols) &&
          !sameOrderedValues(expectedSymbols, answerKey.expectedSymbols)
        ) {
          errors.push(`${label}: expectedSymbols must exactly match answerKey.expectedSymbols (same values in the same order).`);
        }
      }
    }

    if (expectedFiles !== undefined && targetRoot !== undefined) {
      for (const expectedFile of expectedFiles) {
        if (typeof expectedFile !== "string" || expectedFile.length === 0 || path.isAbsolute(expectedFile) || expectedFile.includes("..")) {
          errors.push(`${label}: expected file must be a safe relative path: ${String(expectedFile)}.`);
        } else if (!existsSync(path.resolve(repoRoot, targetRoot, expectedFile))) {
          errors.push(`${label}: expected file does not exist in ${projectId ?? targetRoot}: ${expectedFile}.`);
        }
      }
    }
  });

  const representedProjectIds = [
    ...new Set(
      cases
        .map((benchmarkCase) => benchmarkCase?.benchmarkProject)
        .filter((projectId): projectId is string => typeof projectId === "string" && projectId.length > 0)
    )
  ].sort();
  for (const projectId of representedProjectIds) {
    const profile = profilesById.get(projectId);
    if (profile === undefined || !profile.complexityMetrics || typeof profile.complexityMetrics !== "object") {
      continue;
    }
    const derived = deriveWarmIndexTaskStats(cases, projectId);
    for (const field of ["taskCount", "expectedRelevantFilesAverage", "expectedRelevantSymbolsAverage"] as const) {
      if (profile.complexityMetrics[field] !== derived[field]) {
        errors.push(
          `profile ${projectId}: complexityMetrics.${field} ${profile.complexityMetrics[field]} does not match warm-index corpus value ${derived[field]}.`
        );
      }
    }
  }
  return errors;
}

export function validateWarmIndexBenchmarkSuiteCoverage(cases: EvaluationCaseInput[]): string[] {
  const errors: string[] = [];
  for (const projectId of REQUIRED_WARM_INDEX_BENCHMARK_PROJECT_IDS) {
    const projectCases = cases.filter((benchmarkCase) => benchmarkCase?.benchmarkProject === projectId);
    if (projectCases.length === 0) {
      errors.push(`warm-index suite: missing required benchmark project ${projectId}.`);
      continue;
    }
    if (projectCases.length < MIN_WARM_INDEX_TASKS_PER_PROJECT) {
      errors.push(
        `warm-index suite: project ${projectId} has ${projectCases.length} cases; at least ${MIN_WARM_INDEX_TASKS_PER_PROJECT} are required.`
      );
    }
    for (const locality of TASK_LOCALITIES) {
      if (!projectCases.some((benchmarkCase) => benchmarkCase.taskLocality === locality)) {
        errors.push(`warm-index suite: project ${projectId} has no ${locality} case.`);
      }
    }
  }
  return errors;
}

function validateWarmIndexSourceRoots(sourceRoots: unknown[], profile: BenchmarkProjectProfile, label: string): string[] {
  const errors: string[] = [];
  const allowedRoots = [...(profile.sourceRoots ?? []), ...(profile.testRoots ?? [])];
  const seen = new Set<unknown>();
  for (const sourceRoot of sourceRoots) {
    if (seen.has(sourceRoot)) {
      errors.push(`${label}: duplicate source root ${JSON.stringify(sourceRoot)}.`);
      continue;
    }
    seen.add(sourceRoot);
    if (typeof sourceRoot !== "string" || !allowedRoots.includes(sourceRoot)) {
      errors.push(`${label}: unknown source root ${JSON.stringify(sourceRoot)} for profile ${profile.projectId}; allowed roots: ${allowedRoots.join(", ")}.`);
    }
  }
  for (const allowedRoot of allowedRoots) {
    if (!seen.has(allowedRoot)) {
      errors.push(`${label}: missing profile source/test root ${allowedRoot} for profile ${profile.projectId}.`);
    }
  }
  return errors;
}

function normalizeRelativeRoot(value: string): string {
  return path.posix.normalize(value.replace(/\\/g, "/")).replace(/\/+$/, "");
}

function sameOrderedValues(left: readonly unknown[], right: readonly unknown[]): boolean {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

export function validateBenchmarkProjectProfiles(profiles: BenchmarkProjectProfile[], repoRoot = process.cwd()): string[] {
  const errors: string[] = [];
  const ids = new Set(profiles.map((profile) => profile.projectId));
  for (const requiredProjectId of REQUIRED_BENCHMARK_PROJECT_IDS) {
    if (!ids.has(requiredProjectId)) {
      errors.push(`Missing benchmark project profile: ${requiredProjectId}.`);
    }
  }
  for (const profile of profiles) {
    errors.push(...validateBenchmarkProjectProfile(profile, repoRoot));
  }
  return errors;
}

function validateBenchmarkProjectProfile(profile: BenchmarkProjectProfile, repoRoot: string): string[] {
  const errors: string[] = [];
  const label = `profile ${profile.projectId ?? "<unknown>"}`;
  for (const field of ["projectId", "displayName", "description", "languageMix", "primaryLanguage", "rootPath", "benchmarkPurpose"] as const) {
    if (typeof profile[field] !== "string" || profile[field].length === 0) {
      errors.push(`${label}: ${field} must be a nonempty string.`);
    }
  }
  for (const field of ["languages", "sourceRoots", "testRoots", "expectedUseCases"] as const) {
    if (!Array.isArray(profile[field]) || profile[field].length === 0) {
      errors.push(`${label}: ${field} must be a nonempty array.`);
    }
  }
  if (!VALID_COMPLEXITY_LEVELS.has(profile.complexityLevel)) {
    errors.push(`${label}: complexityLevel must be one of ${[...VALID_COMPLEXITY_LEVELS].join(", ")}.`);
  }
  if (typeof profile.complexityScore !== "number" || profile.complexityScore < 0 || profile.complexityScore > 100) {
    errors.push(`${label}: complexityScore must be between 0 and 100.`);
  }
  if (!profile.complexityMetrics || typeof profile.complexityMetrics !== "object") {
    errors.push(`${label}: complexityMetrics must be an object.`);
  } else {
    errors.push(...validateComplexityMetrics(profile.complexityMetrics, label));
    const calculatedScore = calculateProjectComplexityScore(profile.complexityMetrics);
    if (profile.complexityScore !== calculatedScore) {
      errors.push(`${label}: complexityScore ${profile.complexityScore} does not match formula score ${calculatedScore}.`);
    }
  }
  if (profile.complexityFormula?.id !== PROJECT_COMPLEXITY_FORMULA.id) {
    errors.push(`${label}: complexityFormula.id must be ${PROJECT_COMPLEXITY_FORMULA.id}.`);
  }
  const projectRoot = path.resolve(repoRoot, profile.rootPath ?? "");
  if (!existsSync(projectRoot)) {
    errors.push(`${label}: rootPath does not exist: ${profile.rootPath}.`);
  }
  if (!profile.fileTree || !Array.isArray(profile.fileTree.entries)) {
    errors.push(`${label}: fileTree.entries must be an array.`);
  } else {
    errors.push(...validateFileTreeEntries(profile.fileTree.entries, projectRoot, label));
  }
  return errors;
}

function validateComplexityMetrics(metrics: ProjectComplexityMetrics, label: string): string[] {
  const errors: string[] = [];
  const requiredMetricFields: Array<keyof ProjectComplexityMetrics> = [
    "fileCount",
    "sourceFileCount",
    "testFileCount",
    "totalLinesOfCode",
    "sourceLinesOfCode",
    "testLinesOfCode",
    "languageCount",
    "dependencyFileCount",
    "internalImportCount",
    "exportedSymbolEstimate",
    "taskCount",
    "expectedRelevantFilesAverage",
    "expectedRelevantSymbolsAverage",
    "maxFileLines",
    "averageFileLines"
  ];
  for (const field of requiredMetricFields) {
    if (typeof metrics[field] !== "number" || metrics[field] < 0) {
      errors.push(`${label}: complexityMetrics.${field} must be a nonnegative number.`);
    }
  }
  return errors;
}

function validateFileTreeEntries(entries: ProjectFileTreeEntry[], projectRoot: string, label: string): string[] {
  const errors: string[] = [];
  const paths = new Set<string>();
  for (const entry of entries) {
    if (typeof entry.path !== "string" || entry.path.length === 0) {
      errors.push(`${label}: fileTree entries must include path.`);
      continue;
    }
    if (path.isAbsolute(entry.path) || entry.path.includes("..")) {
      errors.push(`${label}: fileTree path must be a safe relative path: ${entry.path}.`);
    }
    if (paths.has(entry.path)) {
      errors.push(`${label}: duplicate fileTree path: ${entry.path}.`);
    }
    paths.add(entry.path);
    if (entry.kind !== "file" && entry.kind !== "directory") {
      errors.push(`${label}: fileTree path ${entry.path} has invalid kind.`);
    }
    if (!existsSync(path.join(projectRoot, entry.path))) {
      errors.push(`${label}: fileTree path does not exist: ${entry.path}.`);
    }
    if (entry.kind === "file" && (typeof entry.lines !== "number" || entry.lines < 0)) {
      errors.push(`${label}: fileTree file ${entry.path} must include nonnegative lines.`);
    }
  }
  return errors;
}
