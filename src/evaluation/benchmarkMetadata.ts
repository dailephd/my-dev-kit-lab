import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { PROJECT_COMPLEXITY_FORMULA, calculateProjectComplexityScore } from "./projectComplexity.js";
import type {
  BenchmarkProjectProfile,
  BenchmarkProjectProfilesContract,
  BenchmarkTaskAnswerKey,
  ProjectComplexityMetrics,
  ProjectFileTreeEntry
} from "./types.js";

export const REQUIRED_BENCHMARK_PROJECT_IDS = ["todo-ts", "todo-python", "todo-js", "todo-mixed-ts-py"] as const;
export const VALID_COMPLEXITY_LEVELS = new Set(["small", "medium", "large", "mixed-language"]);

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
