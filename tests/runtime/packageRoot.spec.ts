import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it, vi } from "vitest";
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

  it("fails clearly when no matching package can be found without real root I/O", async () => {
    // These paths belong exclusively to a simulated filesystem. Never delegate
    // any of its probes (including lexical root termination) to the real OS.
    const root = path.parse(REPO_ROOT).root;
    const ancestor = path.join(root, "simulated-unrelated-ancestor");
    const start = path.join(ancestor, "nested");
    const probes = [start, ancestor, root].map(dir => path.join(dir, "package.json"));
    const exists = vi.fn((candidate: string) => {
      if (!probes.includes(candidate)) throw new Error(`Unexpected simulated probe: ${candidate}`);
      return candidate === probes[1];
    });
    const read = vi.fn((candidate: string) => {
      if (candidate !== probes[1]) throw new Error(`Unexpected simulated read: ${candidate}`);
      return JSON.stringify({ name: "unrelated-package" });
    });
    const stat = vi.fn(() => { throw new Error("No real filesystem stat is permitted"); });
    vi.doMock("node:fs", async () => ({
      ...await vi.importActual<typeof import("node:fs")>("node:fs"),
      existsSync: exists,
      readFileSync: read,
      statSync: stat,
    }));
    vi.resetModules();
    try {
      const simulated = await import("../../src/runtime/packageRoot.js");
      expect(() => simulated.discoverPackageRoot(start)).toThrow(
        /Unable to locate the "@dailephd\/my-dev-kit-lab" package root/
      );
      expect(exists.mock.calls.map(([candidate]) => candidate)).toEqual(probes);
      expect(read.mock.calls).toEqual([[probes[1], "utf8"]]);
      expect(stat).not.toHaveBeenCalled();
    } finally {
      vi.doUnmock("node:fs");
      vi.resetModules();
    }
  });
});
