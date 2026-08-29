import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { discoverPackageRoot } from "../../src/runtime/packageRoot.js";

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");

describe("discoverPackageRoot", () => {
  it("finds the my-dev-kit-lab package root from source execution", () => {
    const root = discoverPackageRoot();
    expect(root).toBe(REPO_ROOT);
    expect(existsSync(path.join(root, "package.json"))).toBe(true);
  });

  it("does not depend on process.cwd()", () => {
    const originalCwd = process.cwd();
    const unrelatedDir = mkdtempSync(path.join(os.tmpdir(), "package-root-cwd-"));
    try {
      process.chdir(unrelatedDir);
      expect(discoverPackageRoot()).toBe(REPO_ROOT);
    } finally {
      process.chdir(originalCwd);
      rmSync(unrelatedDir, { recursive: true, force: true });
    }
  });

  it("identifies the package by name, skipping an unrelated package.json encountered first", () => {
    const outerDir = mkdtempSync(path.join(os.tmpdir(), "package-root-name-"));
    try {
      writeFileSync(
        path.join(outerDir, "package.json"),
        JSON.stringify({ name: "@dailephd/my-dev-kit-lab" })
      );
      const nestedDir = path.join(outerDir, "nested", "unrelated-package");
      mkdirSync(nestedDir, { recursive: true });
      writeFileSync(path.join(nestedDir, "package.json"), JSON.stringify({ name: "not-the-right-package" }));

      expect(discoverPackageRoot(nestedDir)).toBe(outerDir);
    } finally {
      rmSync(outerDir, { recursive: true, force: true });
    }
  });

  it("fails clearly when no matching package can be found", () => {
    const isolatedDir = mkdtempSync(path.join(os.tmpdir(), "package-root-missing-"));
    try {
      expect(() => discoverPackageRoot(isolatedDir)).toThrow(
        /Unable to locate the "@dailephd\/my-dev-kit-lab" package root/
      );
    } finally {
      rmSync(isolatedDir, { recursive: true, force: true });
    }
  });
});
