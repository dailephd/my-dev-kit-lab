import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { collectFilesForGlobs } from "../../src/core/fileGlobs.js";
import { resolveWithinRoot } from "../../src/core/pathSafety.js";

const tempDirs: string[] = [];
afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

function setupFixture() {
  const dir = mkdtempSync(path.join(os.tmpdir(), "globs-"));
  tempDirs.push(dir);
  mkdirSync(path.join(dir, "src"), { recursive: true });
  mkdirSync(path.join(dir, "tests"), { recursive: true });
  mkdirSync(path.join(dir, "node_modules", "x"), { recursive: true });
  mkdirSync(path.join(dir, "dist"), { recursive: true });
  mkdirSync(path.join(dir, "lab-output"), { recursive: true });
  writeFileSync(path.join(dir, "src", "a.ts"), "a");
  writeFileSync(path.join(dir, "tests", "b.ts"), "b");
  writeFileSync(path.join(dir, "node_modules", "x", "c.ts"), "c");
  writeFileSync(path.join(dir, "dist", "d.ts"), "d");
  writeFileSync(path.join(dir, "lab-output", "e.ts"), "e");
  return dir;
}

describe("fileGlobs and pathSafety", () => {
  it("includes expected source files and sorts deterministically", () => {
    const dir = setupFixture();
    const files = collectFilesForGlobs(dir, ["src/**/*", "tests/**/*"]);
    expect(files.map((file) => file.relativePath)).toEqual(["src/a.ts", "tests/b.ts"]);
  });

  it("excludes node_modules, dist, build, coverage, and lab-output", () => {
    const dir = setupFixture();
    const files = collectFilesForGlobs(dir, ["**/*"]);
    expect(files.some((file) => file.relativePath.includes("node_modules"))).toBe(false);
    expect(files.some((file) => file.relativePath.includes("dist"))).toBe(false);
    expect(files.some((file) => file.relativePath.includes("lab-output"))).toBe(false);
  });

  it("prevents path traversal outside targetRoot", () => {
    const dir = setupFixture();
    expect(() => resolveWithinRoot(dir, "../outside")).toThrow();
  });
});
