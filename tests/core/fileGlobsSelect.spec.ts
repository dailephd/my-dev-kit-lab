import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { collectFilesForGlobs, selectRelativePathsForGlobs } from "../../src/core/fileGlobs.js";

const FILES = [
  "README.md",
  "src/a.ts",
  "src/b/c.ts",
  "src/b/deep/d.ts",
  "src/b/notes.log",
  "src/dist/x.js",
  "src/node_modules/m.js",
  "src/build/o.js",
  "src/scratch.tmp",
  "src/backup~",
  "src/mod.pyc",
  "tests/t.test.ts",
  "dist/top.js",
  ".my-dev-kit/idx.json",
  "docs/guide.md",
];

let root: string;
beforeEach(() => {
  root = mkdtempSync(path.join(os.tmpdir(), "lrs-globs-"));
  for (const file of FILES) {
    mkdirSync(path.dirname(path.join(root, file)), { recursive: true });
    writeFileSync(path.join(root, file), `content of ${file}\n`);
  }
});
afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

const GLOB_SETS: string[][] = [
  ["src/**/*"],
  ["**/*"],
  ["src/**/*.ts"],
  ["src/a.ts"],
  ["dist/**/*"],
  ["src/b/*"],
  ["README.md"],
  ["tests/**/*"],
  ["src/a.ts", "tests/**/*"],
  ["src/dist/x.js"],
  ["docs/*.md", "src/**/*.js"],
  ["src/**/*", "src/**/*"],
];

describe("RSP-002 pure glob selection matches the walking collector", () => {
  for (const globs of GLOB_SETS) {
    it(`selects the same files in the same order for ${JSON.stringify(globs)}`, () => {
      const legacy = collectFilesForGlobs(root, globs).map((entry) => entry.relativePath);
      expect(selectRelativePathsForGlobs(FILES, globs)).toEqual(legacy);
    });
  }

  it("does not depend on the supplied order of paths", () => {
    const globs = ["src/**/*", "tests/**/*"];
    expect(selectRelativePathsForGlobs([...FILES].reverse(), globs)).toEqual(selectRelativePathsForGlobs(FILES, globs));
  });

  it("never touches the filesystem and does not require the base directory to exist", () => {
    expect(selectRelativePathsForGlobs(["src/a.ts"], ["missing/**/*"])).toEqual([]);
    expect(() => collectFilesForGlobs(root, ["missing/**/*"])).toThrow("Glob base directory does not exist");
    expect(selectRelativePathsForGlobs(["nope/a.ts"], ["nope/**/*"])).toEqual(["nope/a.ts"]);
  });

  it("only returns paths from the supplied list", () => {
    expect(selectRelativePathsForGlobs(["src/a.ts"], ["**/*"])).toEqual(["src/a.ts"]);
    expect(selectRelativePathsForGlobs([], ["**/*"])).toEqual([]);
  });

  it("rejects invalid and escaping globs like the walking collector", () => {
    expect(() => selectRelativePathsForGlobs(FILES, [""])).toThrow("Invalid glob pattern.");
    expect(() => selectRelativePathsForGlobs(FILES, ["../outside/**/*"])).toThrow("escapes target root");
    expect(() => collectFilesForGlobs(root, ["../outside/**/*"])).toThrow();
    expect(() => selectRelativePathsForGlobs(FILES, [path.resolve(root, "src") + "/**/*"])).toThrow();
  });

  it("normalizes Windows separators in the supplied paths", () => {
    expect(selectRelativePathsForGlobs(["src\\a.ts"], ["src/**/*"])).toEqual(["src/a.ts"]);
  });

  it("handles a long run of trailing slashes in the glob base without changing selection behavior", () => {
    for (const run of [1, 2, 3, 5000]) {
      for (const glob of [`src${"/".repeat(run)}*.ts`, `src${"/".repeat(run)}**/*.ts`]) {
        const legacy = collectFilesForGlobs(root, [glob]).map((entry) => entry.relativePath);
        expect(selectRelativePathsForGlobs(FILES, [glob])).toEqual(legacy);
      }
    }
    expect(selectRelativePathsForGlobs(FILES, [`src${"/".repeat(5000)}*.ts`])).toEqual([]);
    expect(selectRelativePathsForGlobs(FILES, ["src/*.ts"])).toEqual(["src/a.ts"]);
  });
});
