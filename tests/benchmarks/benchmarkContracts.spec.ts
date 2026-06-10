import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const rootDir = process.cwd();
const casesPath = path.join(rootDir, "benchmarks", "contracts", "todo-benchmark-case.json");

describe("benchmark contracts", () => {
  it("parses todo-benchmark-case.json", () => {
    expect(() => JSON.parse(readFileSync(casesPath, "utf8"))).not.toThrow();
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
      expect(benchmarkCase.notes).toBeTypeOf("string");
    }
  });

  it("covers all four benchmark projects in expectedFilesByProject", () => {
    const cases = JSON.parse(readFileSync(casesPath, "utf8")) as Array<{ expectedFilesByProject: Record<string, string[]> }>;
    for (const benchmarkCase of cases) {
      expect(Object.keys(benchmarkCase.expectedFilesByProject).sort()).toEqual([
        "todo-js",
        "todo-mixed-ts-py",
        "todo-python",
        "todo-ts"
      ]);
    }
  });
});
