import { readdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { readBenchmarkProjectProfiles } from "../../../src/evaluation/index.js";
import { readEvaluationCases } from "../../../src/evaluation/readEvaluationCases.js";
import type { BenchmarkProjectProfile, EvaluationCase } from "../../../src/evaluation/types.js";

export const bundledProjectProfilesPath = path.resolve(process.cwd(), "benchmarks/contracts/benchmark-project-profiles.json");

export function loadBundledProjectProfiles(): Promise<BenchmarkProjectProfile[]> {
  return readBenchmarkProjectProfiles(bundledProjectProfilesPath, process.cwd());
}

export const fakeKitPath = path.resolve(process.cwd(), "tests/fixtures/fake-my-dev-kit-cli.js");
export const fakeKitCommand = `node ${fakeKitPath}`;
export const multiTaskCasesPath = path.resolve(process.cwd(), "tests/fixtures/warm-index-reuse/multi-task-cases.json");

/** The real v0.5.1 production warm-index corpus, read through the normal evaluation-case reader. */
export const productionWarmIndexCasesPath = path.resolve(process.cwd(), "benchmarks/contracts/warm-index-benchmark-cases.json");

export function loadProductionWarmIndexCases(): Promise<EvaluationCase[]> {
  return readEvaluationCases(productionWarmIndexCasesPath, process.cwd());
}

/** Deterministic same-project cases `<prefix>-1` .. `<prefix>-<count>` in order. */
export function makeCases(count: number, prefix = "task", overrides: Partial<EvaluationCase> = {}): EvaluationCase[] {
  return Array.from({ length: count }, (_, index) => makeCase({ ...overrides, id: `${prefix}-${index + 1}` }));
}

export function makeCase(overrides: Partial<EvaluationCase> & Pick<EvaluationCase, "id">): EvaluationCase {
  const benchmarkProject = overrides.benchmarkProject ?? "todo-ts";
  const targetRoot = overrides.targetRoot ?? `benchmarks/projects/${benchmarkProject}`;
  return {
    title: `Case ${overrides.id}`,
    benchmarkProject,
    targetRoot,
    absoluteTargetRoot: path.resolve(process.cwd(), targetRoot),
    sourceRoots: ["src", "tests"],
    query: `query for ${overrides.id}`,
    // A non-empty answer key so the deterministic fake agent produces a fully scoreable answer.
    expectedFiles: ["src/taskService.ts"],
    expectedSymbols: ["createTask"],
    expectedFacts: [{ id: "create-task", text: "createTask creates a task.", weight: 1, required: true }],
    rawIncludeGlobs: ["src/**/*", "tests/**/*"],
    ...overrides,
  };
}

/**
 * Wraps the shared fake CLI. `failOn` makes that subcommand exit 1; `failIndexWhenOutContains`
 * fails `index` only for matching --out paths; `failSearchWhenQueryContains` fails `search` only
 * for a matching --query (one task); `emptySearch` returns no candidates.
 */
export function writeFakeKitVariant(
  dir: string,
  options: { failOn?: string; failIndexWhenOutContains?: string; failSearchWhenQueryContains?: string; emptySearch?: boolean }
): string {
  const scriptPath = path.join(dir, "fake-kit-variant.mjs");
  writeFileSync(
    scriptPath,
    [
      `const command = process.argv[2];`,
      `const outIndex = process.argv.indexOf("--out");`,
      `const out = outIndex >= 0 ? String(process.argv[outIndex + 1]).replace(/\\\\/g, "/") : "";`,
      `const queryIndex = process.argv.indexOf("--query");`,
      `const query = queryIndex >= 0 ? String(process.argv[queryIndex + 1]) : "";`,
      `if (command === ${JSON.stringify(options.failOn ?? "")}) { process.stderr.write("forced failure"); process.exit(1); }`,
      options.failIndexWhenOutContains
        ? `if (command === "index" && out.includes(${JSON.stringify(options.failIndexWhenOutContains)})) { process.stderr.write("forced index failure"); process.exit(1); }`
        : "",
      options.failSearchWhenQueryContains
        ? `if (command === "search" && query.includes(${JSON.stringify(options.failSearchWhenQueryContains)})) { process.stderr.write("forced search failure"); process.exit(1); }`
        : "",
      options.emptySearch ? `if (command === "search") { console.log(JSON.stringify({ results: [] })); process.exit(0); }` : "",
      `await import(${JSON.stringify(pathToFileURL(fakeKitPath).href)});`,
    ].join("\n")
  );
  return `node ${scriptPath}`;
}

/** Recursively lists files with the given name, as paths relative to root with forward slashes. */
export function findFiles(root: string, fileName: string): string[] {
  const found: string[] = [];
  const walk = (dir: string) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (entry.name === fileName) found.push(path.relative(root, full).replace(/\\/g, "/"));
    }
  };
  walk(root);
  return found.sort();
}
