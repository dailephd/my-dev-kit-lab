import { existsSync, readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { tokenCountMethod } from "../../src/core/countTokens.js";
import { validateAnswerKey } from "../../src/evaluation/benchmarkMetadata.js";
import { readEvaluationCases } from "../../src/evaluation/readEvaluationCases.js";
import { runRawFullFileBaseline } from "../../src/evaluation/runRawFullFileBaseline.js";

const rootDir = process.cwd();
const scalingCasesPath = path.join(rootDir, "benchmarks", "contracts", "context-window-scaling-cases.json");
const warmCasesPath = path.join(rootDir, "benchmarks", "contracts", "warm-index-benchmark-cases.json");
const projectRoot = path.join(rootDir, "benchmarks", "projects", "context-window-scaling-fixed-ts");

// Planner-defined exclusive raw-context bands; never weaken to make a fixture pass.
const BANDS: Record<string, { min: number; max: number }> = {
  "ctx-scale-a-8k-16k": { min: 8192, max: 16384 },
  "ctx-scale-b-16k-32k": { min: 16384, max: 32768 },
  "ctx-scale-c-32k-64k": { min: 32768, max: 65536 },
  "ctx-scale-d-64k-plus": { min: 65536, max: Number.POSITIVE_INFINITY },
};

function walk(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    return entry.isDirectory() ? walk(full) : [full];
  });
}

describe("context-window-scaling fixed corpus", () => {
  it("parses through the evaluation-case owner with valid answer keys and existing expected files", async () => {
    const cases = await readEvaluationCases(scalingCasesPath, rootDir);
    expect(cases.map((c) => c.id)).toEqual(Object.keys(BANDS));
    for (const benchmarkCase of cases) {
      expect(validateAnswerKey(benchmarkCase.answerKey, benchmarkCase.id)).toEqual([]);
      for (const file of benchmarkCase.expectedFiles) {
        expect(existsSync(path.join(benchmarkCase.absoluteTargetRoot, file))).toBe(true);
      }
      expect(benchmarkCase.answerKey?.expectedFiles).toEqual(benchmarkCase.expectedFiles);
    }
  });

  it("places raw context in the four scale bands using the production baseline", async () => {
    const cases = await readEvaluationCases(scalingCasesPath, rootDir);
    for (const benchmarkCase of cases) {
      const band = BANDS[benchmarkCase.id]!;
      const result = await runRawFullFileBaseline(benchmarkCase);
      expect(result.tokenCountMethod).toBe(tokenCountMethod);
      expect(result.totalEstimatedTokens, benchmarkCase.id).toBeGreaterThan(band.min);
      expect(result.totalEstimatedTokens, benchmarkCase.id).toBeLessThan(band.max);
    }
  });

  it("measures deterministically across repeated runs", async () => {
    const cases = await readEvaluationCases(scalingCasesPath, rootDir);
    const measure = async () =>
      Promise.all(
        cases.map(async (benchmarkCase) => {
          const { caseId, filesIncluded, totalFiles, totalChars, totalEstimatedTokens } =
            await runRawFullFileBaseline(benchmarkCase);
          return { caseId, filesIncluded, totalFiles, totalChars, totalEstimatedTokens };
        })
      );
    expect(await measure()).toEqual(await measure());
  });

  it("grows raw context cumulatively while every raw scope contains the task surface", async () => {
    const cases = await readEvaluationCases(scalingCasesPath, rootDir);
    const results = await Promise.all(cases.map((c) => runRawFullFileBaseline(c)));
    for (let i = 1; i < results.length; i++) {
      expect(results[i]!.filesIncluded).toEqual(expect.arrayContaining(results[i - 1]!.filesIncluded));
      expect(results[i]!.totalEstimatedTokens).toBeGreaterThan(results[i - 1]!.totalEstimatedTokens);
    }
    results.forEach((result, index) => {
      for (const file of cases[index]!.expectedFiles) {
        expect(result.filesIncluded).toContain(file);
      }
    });
  });

  it("keeps the project a static tree without generated artifacts", () => {
    const files = walk(projectRoot).map((full) => path.relative(projectRoot, full).replace(/\\/g, "/"));
    expect(files.some((file) => /(^|\/)(node_modules|dist|build|coverage|lab-output)(\/|$)/.test(file))).toBe(false);
    expect(files.some((file) => /generat/i.test(path.basename(file)))).toBe(false);
  });

  it("checks out the frozen scaling corpus with LF line endings", () => {
    const corpusFiles = [...walk(projectRoot), scalingCasesPath];
    for (const file of corpusFiles) {
      expect(readFileSync(file).includes(0x0d), path.relative(rootDir, file)).toBe(false);
    }
  });

  it("keeps an existing shipped case below the smallest standard budget", async () => {
    const cases = await readEvaluationCases(warmCasesPath, rootDir);
    const existing = cases.find((c) => c.id === "warm-medium-import-dedupe")!;
    const result = await runRawFullFileBaseline(existing);
    expect(result.totalEstimatedTokens).toBeLessThan(8192);
  });
});
