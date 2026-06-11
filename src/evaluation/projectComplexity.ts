import { readFileSync } from "node:fs";
import path from "node:path";
import type { ProjectComplexityFormula, ProjectComplexityMetrics, ProjectFileTree } from "./types.js";

export const PROJECT_COMPLEXITY_FORMULA: ProjectComplexityFormula = {
  id: "benchmark-project-complexity-v1",
  description:
    "Weighted score using capped normalized source files, source lines, language count, internal imports, max file lines, expected relevant files, and expected relevant symbols.",
  scoreRange: [0, 100],
  normalizedValue: "min(value / cap, 1)",
  weights: {
    sourceFileCount: 0.2,
    sourceLinesOfCode: 0.2,
    languageCount: 0.15,
    internalImportCount: 0.15,
    maxFileLines: 0.1,
    expectedRelevantFilesAverage: 0.1,
    expectedRelevantSymbolsAverage: 0.1
  },
  caps: {
    sourceFileCount: 20,
    sourceLinesOfCode: 2000,
    languageCount: 4,
    internalImportCount: 50,
    maxFileLines: 300,
    expectedRelevantFilesAverage: 10,
    expectedRelevantSymbolsAverage: 20
  }
};

export function calculateProjectComplexityScore(metrics: ProjectComplexityMetrics): number {
  const { weights, caps } = PROJECT_COMPLEXITY_FORMULA;
  const normalizedScore =
    weights.sourceFileCount * normalize(metrics.sourceFileCount, caps.sourceFileCount) +
    weights.sourceLinesOfCode * normalize(metrics.sourceLinesOfCode, caps.sourceLinesOfCode) +
    weights.languageCount * normalize(metrics.languageCount, caps.languageCount) +
    weights.internalImportCount * normalize(metrics.internalImportCount, caps.internalImportCount) +
    weights.maxFileLines * normalize(metrics.maxFileLines, caps.maxFileLines) +
    weights.expectedRelevantFilesAverage * normalize(metrics.expectedRelevantFilesAverage, caps.expectedRelevantFilesAverage) +
    weights.expectedRelevantSymbolsAverage * normalize(metrics.expectedRelevantSymbolsAverage, caps.expectedRelevantSymbolsAverage);
  return Math.round(normalizedScore * 100);
}

export function computeProjectComplexityMetrics(
  projectRoot: string,
  fileTree: ProjectFileTree,
  taskStats: {
    taskCount: number;
    expectedRelevantFilesAverage: number;
    expectedRelevantSymbolsAverage: number;
  }
): ProjectComplexityMetrics {
  const fileEntries = fileTree.entries.filter((entry) => entry.kind === "file");
  const codeEntries = fileEntries.filter((entry) => entry.role === "source" || entry.role === "test");
  const sourceEntries = fileEntries.filter((entry) => entry.role === "source");
  const testEntries = fileEntries.filter((entry) => entry.role === "test");
  const languages = new Set(codeEntries.map((entry) => entry.language).filter((language): language is string => Boolean(language)));
  const codeLineCounts = new Map<string, number>();

  for (const entry of codeEntries) {
    codeLineCounts.set(entry.path, countApproximateCodeLines(path.join(projectRoot, entry.path)));
  }

  const totalLinesOfCode = sum([...codeLineCounts.values()]);
  const sourceLinesOfCode = sum(sourceEntries.map((entry) => codeLineCounts.get(entry.path) ?? 0));
  const testLinesOfCode = sum(testEntries.map((entry) => codeLineCounts.get(entry.path) ?? 0));
  const fileLineCounts = codeEntries.map((entry) => entry.lines ?? 0);
  const metrics: ProjectComplexityMetrics = {
    fileCount: fileEntries.length,
    sourceFileCount: sourceEntries.length,
    testFileCount: testEntries.length,
    totalLinesOfCode,
    sourceLinesOfCode,
    testLinesOfCode,
    languageCount: languages.size,
    dependencyFileCount: fileEntries.filter((entry) => isDependencyFile(entry.path)).length,
    internalImportCount: sum(sourceEntries.map((entry) => countInternalImports(path.join(projectRoot, entry.path)))),
    exportedSymbolEstimate: sum(sourceEntries.map((entry) => countExportedSymbols(path.join(projectRoot, entry.path)))),
    taskCount: taskStats.taskCount,
    expectedRelevantFilesAverage: roundToTwo(taskStats.expectedRelevantFilesAverage),
    expectedRelevantSymbolsAverage: roundToTwo(taskStats.expectedRelevantSymbolsAverage),
    maxFileLines: fileLineCounts.length > 0 ? Math.max(...fileLineCounts) : 0,
    averageFileLines: fileLineCounts.length > 0 ? roundToTwo(sum(fileLineCounts) / fileLineCounts.length) : 0,
    packageDependencyCount: sum(fileEntries.map((entry) => countPackageDependencies(path.join(projectRoot, entry.path)))),
    functionOrClassEstimate: sum(sourceEntries.map((entry) => countFunctionsOrClasses(path.join(projectRoot, entry.path))))
  };
  return metrics;
}

function normalize(value: number, cap: number): number {
  return Math.min(value / cap, 1);
}

function roundToTwo(value: number): number {
  return Math.round(value * 100) / 100;
}

function sum(values: number[]): number {
  return values.reduce((total, value) => total + value, 0);
}

function readLines(filePath: string): string[] {
  return readFileSync(filePath, "utf8").split(/\r?\n/);
}

function countApproximateCodeLines(filePath: string): number {
  return readLines(filePath).filter((line) => {
    const trimmed = line.trim();
    return trimmed.length > 0 && !trimmed.startsWith("//") && !trimmed.startsWith("#") && !trimmed.startsWith("*");
  }).length;
}

function countInternalImports(filePath: string): number {
  return readLines(filePath).filter((line) => {
    const trimmed = line.trim();
    return (
      /^import\s+.*from\s+["']\./.test(trimmed) ||
      /^import\s+["']\./.test(trimmed) ||
      /require\(["']\./.test(trimmed) ||
      /^from\s+\./.test(trimmed) ||
      /^from\s+(task_|task|src|python)/.test(trimmed)
    );
  }).length;
}

function countExportedSymbols(filePath: string): number {
  const lines = readLines(filePath);
  return lines.filter((line) => {
    const trimmed = line.trim();
    return (
      /^export\s+(function|class|const|let|var|type|interface)/.test(trimmed) ||
      /^module\.exports\s*=/.test(trimmed) ||
      /^exports\./.test(trimmed) ||
      /^__all__\s*=/.test(trimmed) ||
      /^(def|class)\s+\w+/.test(trimmed)
    );
  }).length;
}

function countFunctionsOrClasses(filePath: string): number {
  return readLines(filePath).filter((line) => /^(export\s+)?(async\s+)?function\s+\w+|^(export\s+)?class\s+\w+|^\s*(def|class)\s+\w+/.test(line.trim()))
    .length;
}

function isDependencyFile(relativePath: string): boolean {
  const basename = path.posix.basename(relativePath);
  return ["package.json", "package-lock.json", "requirements.txt", "pyproject.toml"].includes(basename);
}

function countPackageDependencies(filePath: string): number {
  if (path.basename(filePath) !== "package.json") {
    return 0;
  }
  const parsed = JSON.parse(readFileSync(filePath, "utf8")) as { dependencies?: Record<string, unknown>; devDependencies?: Record<string, unknown> };
  return Object.keys(parsed.dependencies ?? {}).length + Object.keys(parsed.devDependencies ?? {}).length;
}
