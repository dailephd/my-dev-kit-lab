import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
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
