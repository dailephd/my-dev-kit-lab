import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { REQUIRED_BENCHMARK_PROJECT_IDS, validateAnswerKey, validateBenchmarkProjectProfiles } from "../../src/evaluation/benchmarkMetadata.js";
import { PROJECT_COMPLEXITY_FORMULA, calculateProjectComplexityScore } from "../../src/evaluation/projectComplexity.js";
import type { BenchmarkProjectProfilesContract } from "../../src/evaluation/types.js";

const rootDir = process.cwd();
const casesPath = path.join(rootDir, "benchmarks", "contracts", "todo-benchmark-case.json");
const profilesPath = path.join(rootDir, "benchmarks", "contracts", "benchmark-project-profiles.json");

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
});
