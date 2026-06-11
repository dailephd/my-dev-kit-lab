import { mkdtempSync, writeFileSync } from "node:fs";
import { rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { readEvaluationCases } from "../../src/evaluation/readEvaluationCases.js";

const tempDirs: string[] = [];
afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

describe("readEvaluationCases", () => {
  it("parses a valid case file and resolves relative paths", async () => {
    const dir = mkdtempSync(path.join(os.tmpdir(), "cases-"));
    tempDirs.push(dir);
    writeFileSync(
      path.join(dir, "cases.json"),
      JSON.stringify([
        {
          id: "case-1",
          title: "Case",
          benchmarkProject: "todo-ts",
          targetRoot: ".",
          sourceRoots: ["src"],
          query: "q",
          expectedFiles: ["src/x.ts"],
          expectedSymbols: ["x"],
          rawIncludeGlobs: ["src/**/*"]
        }
      ])
    );
    const cases = await readEvaluationCases(path.join(dir, "cases.json"), dir);
    expect(cases[0].absoluteTargetRoot).toBe(path.resolve(dir));
  });

  it("parses optional answer keys without breaking the existing case shape", async () => {
    const dir = mkdtempSync(path.join(os.tmpdir(), "cases-"));
    tempDirs.push(dir);
    writeFileSync(
      path.join(dir, "cases.json"),
      JSON.stringify([
        {
          id: "case-1",
          title: "Case",
          benchmarkProject: "todo-ts",
          projectProfileRef: "todo-ts",
          targetRoot: ".",
          sourceRoots: ["src"],
          query: "q",
          expectedFiles: ["src/x.ts"],
          expectedSymbols: ["x"],
          answerKey: {
            expectedFiles: ["src/x.ts"],
            expectedSymbols: ["x"],
            expectedFacts: [{ id: "fact-1", text: "x is present", weight: 1, required: true }],
            minimumCorrectFacts: 1
          },
          rawIncludeGlobs: ["src/**/*"]
        }
      ])
    );
    const cases = await readEvaluationCases(path.join(dir, "cases.json"), dir);
    expect(cases[0].answerKey?.expectedFacts[0]?.id).toBe("fact-1");
  });

  it("rejects invalid JSON", async () => {
    const dir = mkdtempSync(path.join(os.tmpdir(), "cases-"));
    tempDirs.push(dir);
    writeFileSync(path.join(dir, "cases.json"), "{ invalid");
    await expect(readEvaluationCases(path.join(dir, "cases.json"), dir)).rejects.toThrow("Failed to parse evaluation cases");
  });

  it("rejects duplicate ids and missing required fields", async () => {
    const dir = mkdtempSync(path.join(os.tmpdir(), "cases-"));
    tempDirs.push(dir);
    writeFileSync(path.join(dir, "cases.json"), JSON.stringify([{ id: "x" }, { id: "x" }]));
    await expect(readEvaluationCases(path.join(dir, "cases.json"), dir)).rejects.toThrow();
  });

  it("rejects malformed answer keys and duplicate expected fact ids", async () => {
    const dir = mkdtempSync(path.join(os.tmpdir(), "cases-"));
    tempDirs.push(dir);
    const baseCase = {
      id: "case-1",
      title: "Case",
      benchmarkProject: "todo-ts",
      targetRoot: ".",
      sourceRoots: ["src"],
      query: "q",
      expectedFiles: ["src/x.ts"],
      expectedSymbols: ["x"],
      rawIncludeGlobs: ["src/**/*"]
    };
    writeFileSync(
      path.join(dir, "cases.json"),
      JSON.stringify([
        {
          ...baseCase,
          answerKey: {
            expectedFiles: ["src/x.ts"],
            expectedSymbols: ["x"],
            expectedFacts: [
              { id: "fact-1", text: "x is present", weight: 1, required: true },
              { id: "fact-1", text: "x is still present", weight: 1, required: false }
            ],
            minimumCorrectFacts: 1
          }
        }
      ])
    );
    await expect(readEvaluationCases(path.join(dir, "cases.json"), dir)).rejects.toThrow("duplicate expected fact id fact-1");
  });

  it("requires projectProfileRef only when profile resolution is requested", async () => {
    const dir = mkdtempSync(path.join(os.tmpdir(), "cases-"));
    tempDirs.push(dir);
    writeFileSync(
      path.join(dir, "cases.json"),
      JSON.stringify([
        {
          id: "case-1",
          title: "Case",
          benchmarkProject: "todo-ts",
          targetRoot: ".",
          sourceRoots: ["src"],
          query: "q",
          expectedFiles: ["src/x.ts"],
          expectedSymbols: ["x"],
          rawIncludeGlobs: ["src/**/*"]
        }
      ])
    );
    await expect(readEvaluationCases(path.join(dir, "cases.json"), dir)).resolves.toHaveLength(1);
    await expect(
      readEvaluationCases(path.join(dir, "cases.json"), dir, { requireProjectProfileRef: true, projectProfiles: [] })
    ).rejects.toThrow("missing projectProfileRef");
  });

  it("fails clearly for unknown projectProfileRef when profile resolution is requested", async () => {
    const dir = mkdtempSync(path.join(os.tmpdir(), "cases-"));
    tempDirs.push(dir);
    writeFileSync(
      path.join(dir, "cases.json"),
      JSON.stringify([
        {
          id: "case-1",
          title: "Case",
          benchmarkProject: "todo-ts",
          projectProfileRef: "missing-profile",
          targetRoot: ".",
          sourceRoots: ["src"],
          query: "q",
          expectedFiles: ["src/x.ts"],
          expectedSymbols: ["x"],
          rawIncludeGlobs: ["src/**/*"]
        }
      ])
    );
    await expect(
      readEvaluationCases(path.join(dir, "cases.json"), dir, {
        requireProjectProfileRef: true,
        projectProfiles: [
          {
            projectId: "todo-ts",
            displayName: "Todo TS",
            description: "fixture",
            languageMix: "single-language TypeScript",
            primaryLanguage: "typescript",
            languages: ["typescript"],
            complexityLevel: "small",
            complexityScore: 0,
            complexityMetrics: {
              fileCount: 0,
              sourceFileCount: 0,
              testFileCount: 0,
              totalLinesOfCode: 0,
              sourceLinesOfCode: 0,
              testLinesOfCode: 0,
              languageCount: 0,
              dependencyFileCount: 0,
              internalImportCount: 0,
              exportedSymbolEstimate: 0,
              taskCount: 0,
              expectedRelevantFilesAverage: 0,
              expectedRelevantSymbolsAverage: 0,
              maxFileLines: 0,
              averageFileLines: 0
            },
            complexityFormula: {
              id: "benchmark-project-complexity-v1",
              description: "test",
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
            },
            rootPath: ".",
            sourceRoots: ["src"],
            testRoots: ["tests"],
            fileTree: { entries: [] },
            benchmarkPurpose: "test",
            expectedUseCases: ["test"]
          }
        ]
      })
    ).rejects.toThrow("unknown projectProfileRef missing-profile");
  });
});
