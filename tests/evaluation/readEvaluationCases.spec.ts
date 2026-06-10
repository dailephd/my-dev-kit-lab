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
});
