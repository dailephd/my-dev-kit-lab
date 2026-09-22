import { copyFileSync, cpSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { afterEach, describe, expect, it } from "vitest";
import { validateBenchmarks } from "../../scripts/verify-benchmarks.js";

const tempDirs: string[] = [];

afterEach(() => {
  while (tempDirs.length > 0) {
    rmSync(tempDirs.pop()!, { recursive: true, force: true });
  }
});

describe("verify-benchmarks", () => {
  it("succeeds on the current benchmark suite", () => {
    expect(validateBenchmarks(process.cwd()).ok).toBe(true);
  });

  it("validates the warm-index benchmark corpus alongside the todo contract", () => {
    const result = validateBenchmarks(process.cwd());
    expect(result.errors).toEqual([]);
    expect(result.checks).toContain("parsed todo-benchmark-case.json");
    expect(result.checks).toContain("validated warm-index-benchmark-cases.json (12 cases)");
    expect(result.checks).toContain("validated warm-index benchmark suite coverage");
  });

  function copyBenchmarksWithWarmIndexCases(
    mutate: (cases: Array<Record<string, unknown>>) => Array<Record<string, unknown>>
  ): string {
    const tempRoot = mkdtempSync(path.join(os.tmpdir(), "my-dev-kit-lab-"));
    tempDirs.push(tempRoot);
    const contractsDir = path.join(tempRoot, "benchmarks", "contracts");
    mkdirSync(contractsDir, { recursive: true });
    for (const name of ["todo-behavior.md", "todo-benchmark-case.json", "benchmark-project-profiles.json"]) {
      copyFileSync(path.join(process.cwd(), "benchmarks", "contracts", name), path.join(contractsDir, name));
    }
    cpSync(path.join(process.cwd(), "benchmarks", "projects"), path.join(tempRoot, "benchmarks", "projects"), { recursive: true });
    const warmIndexCases = JSON.parse(
      readFileSync(path.join(process.cwd(), "benchmarks", "contracts", "warm-index-benchmark-cases.json"), "utf8")
    ) as Array<Record<string, unknown>>;
    writeFileSync(path.join(contractsDir, "warm-index-benchmark-cases.json"), JSON.stringify(mutate(warmIndexCases)));
    return tempRoot;
  }

  it("fails when the warm-index benchmark corpus is invalid", () => {
    const tempRoot = copyBenchmarksWithWarmIndexCases((cases) => {
      delete cases[0].taskLocality;
      return cases;
    });

    const result = validateBenchmarks(tempRoot);
    expect(result.ok).toBe(false);
    expect(result.errors).toEqual([
      "warm-index case warm-medium-import-dedupe: missing taskLocality; expected one of localized, cross-module, broad-change."
    ]);
  });

  it("fails when a required warm-index project falls below the minimum suite size", () => {
    const tempRoot = copyBenchmarksWithWarmIndexCases((cases) =>
      cases.filter((benchmarkCase) => !["warm-medium-composite-filter", "warm-medium-project-summary"].includes(benchmarkCase.id as string))
    );

    const result = validateBenchmarks(tempRoot);
    expect(result.ok).toBe(false);
    expect(result.errors).toContain("warm-index suite: project task-workflow-medium-ts has 4 cases; at least 5 are required.");
    expect(result.checks).not.toContain("validated warm-index benchmark suite coverage");
  });

  it("fails when a required warm-index project loses its broad-change control", () => {
    const tempRoot = copyBenchmarksWithWarmIndexCases((cases) =>
      cases.filter((benchmarkCase) => benchmarkCase.id !== "warm-large-broad-analytics-comparison")
    );

    const result = validateBenchmarks(tempRoot);
    expect(result.ok).toBe(false);
    expect(result.errors).toContain("warm-index suite: project task-analytics-large-mixed has no broad-change case.");
  });

  it("fails when the warm-index benchmark corpus is missing", () => {
    const tempRoot = mkdtempSync(path.join(os.tmpdir(), "my-dev-kit-lab-"));
    tempDirs.push(tempRoot);
    mkdirSync(path.join(tempRoot, "benchmarks", "contracts"), { recursive: true });
    mkdirSync(path.join(tempRoot, "benchmarks", "projects"), { recursive: true });

    const result = validateBenchmarks(tempRoot);
    expect(result.errors).toContain("Missing contract file: benchmarks/contracts/warm-index-benchmark-cases.json");
  });

  it("fails on a broken fixture", () => {
    const tempRoot = mkdtempSync(path.join(os.tmpdir(), "my-dev-kit-lab-"));
    tempDirs.push(tempRoot);
    mkdirSync(path.join(tempRoot, "benchmarks", "contracts"), { recursive: true });
    mkdirSync(path.join(tempRoot, "benchmarks", "projects"), { recursive: true });
    writeFileSync(path.join(tempRoot, "benchmarks", "contracts", "todo-behavior.md"), "# x");
    writeFileSync(
      path.join(tempRoot, "benchmarks", "contracts", "todo-benchmark-case.json"),
      JSON.stringify([{ id: "duplicate", expectedFilesByProject: {} }, { id: "duplicate", expectedFilesByProject: {} }])
    );

    const result = validateBenchmarks(tempRoot);
    expect(result.ok).toBe(false);
    expect(result.errors.some((error) => error.includes("Duplicate benchmark case id"))).toBe(true);
  });

  it("runs from the command line", () => {
    const result = spawnSync(process.execPath, ["node_modules/tsx/dist/cli.mjs", "scripts/verify-benchmarks.ts"], {
      cwd: process.cwd(),
      encoding: "utf8"
    });
    expect(result.status).toBe(0);
    expect(result.stdout).toContain("Benchmark verification passed.");
  });
});
