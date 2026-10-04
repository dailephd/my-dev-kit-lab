import { writeFileSync } from "node:fs";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { readEvaluationCases } from "../../../src/evaluation/readEvaluationCases.js";
import { buildLocalRepositorySubjectEvaluationCases } from "../../../src/evaluation/localRepositorySubject/index.js";
import { makeTempDir, minimalCase, minimalConfig, removeTempDir } from "./fixtureRepository.js";
import { parseLocalRepositorySubjectConfig } from "../../../src/evaluation/localRepositorySubject/index.js";

let repoRoot: string;
let outside: string;
beforeEach(() => {
  repoRoot = makeTempDir("lrs-repo-");
  outside = makeTempDir("lrs-outside-");
});
afterEach(() => {
  removeTempDir(repoRoot);
  removeTempDir(outside);
});

function writeCases(targetRoot: string): string {
  const casesPath = path.join(repoRoot, "cases.json");
  writeFileSync(
    casesPath,
    JSON.stringify([
      { id: "c1", title: "t", benchmarkProject: "p", targetRoot, sourceRoots: ["src"], query: "q", expectedFiles: ["src/a.ts"], expectedSymbols: [], rawIncludeGlobs: ["src/**/*"] },
    ])
  );
  return casesPath;
}

describe("RSP-016 existing evaluation-case contracts are unchanged", () => {
  it("readEvaluationCases still rejects an absolute external target root", async () => {
    await expect(readEvaluationCases(writeCases(outside), repoRoot)).rejects.toThrow(/escapes target root/);
  });

  it("readEvaluationCases still rejects a parent-traversal target root", async () => {
    await expect(readEvaluationCases(writeCases("../outside"), repoRoot)).rejects.toThrow(/escapes target root/);
  });

  it("readEvaluationCases still resolves a repository-contained target root", async () => {
    const [evaluationCase] = await readEvaluationCases(writeCases("benchmarks/todo"), repoRoot);
    expect(evaluationCase.targetRoot).toBe("benchmarks/todo");
    expect(evaluationCase.absoluteTargetRoot).toBe(path.join(repoRoot, "benchmarks", "todo"));
  });

  it("the local-subject adapter yields objects with exactly the existing EvaluationCase vocabulary", () => {
    const config = parseLocalRepositorySubjectConfig(minimalConfig({ cases: [minimalCase()] }));
    const [evaluationCase] = buildLocalRepositorySubjectEvaluationCases(config, outside);
    expect(Object.keys(evaluationCase).sort()).toEqual(
      ["absoluteTargetRoot", "benchmarkProject", "expectedFiles", "expectedSymbols", "id", "query", "rawIncludeGlobs", "sourceRoots", "targetRoot", "title"].sort()
    );
  });
});
