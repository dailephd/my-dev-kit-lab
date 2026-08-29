import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { resolvePackageResource } from "../../src/runtime/packageResource.js";

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const BENCHMARK_PROFILES_RESOURCE = "benchmarks/contracts/benchmark-project-profiles.json";

describe("resolvePackageResource", () => {
  it("resolves a valid bundled resource", () => {
    const resolved = resolvePackageResource(REPO_ROOT, BENCHMARK_PROFILES_RESOURCE);
    expect(resolved).toBe(path.join(REPO_ROOT, "benchmarks", "contracts", "benchmark-project-profiles.json"));
  });

  it("accepts a LabExecutionContext in place of a raw resourceRoot string", () => {
    const resolved = resolvePackageResource(
      { invocationCwd: REPO_ROOT, packageRoot: REPO_ROOT, workspaceRoot: REPO_ROOT, resourceRoot: REPO_ROOT },
      BENCHMARK_PROFILES_RESOURCE
    );
    expect(resolved).toBe(path.join(REPO_ROOT, "benchmarks", "contracts", "benchmark-project-profiles.json"));
  });

  it("rejects an empty resource path", () => {
    expect(() => resolvePackageResource(REPO_ROOT, "")).toThrow(/must not be empty/);
  });

  it("rejects an absolute resource path", () => {
    const absolutePath = path.join(REPO_ROOT, "package.json");
    expect(() => resolvePackageResource(REPO_ROOT, absolutePath)).toThrow(/must be relative/);
  });

  it("rejects a Unix-style single-level traversal escape", () => {
    expect(() => resolvePackageResource(REPO_ROOT, "../package.json")).toThrow(/escapes/);
  });

  it("rejects a multi-level traversal escape", () => {
    expect(() => resolvePackageResource(REPO_ROOT, "../../outside.txt")).toThrow(/escapes/);
  });

  it.skipIf(process.platform !== "win32")(
    "rejects a Windows-style backslash traversal escape",
    () => {
      expect(() => resolvePackageResource(REPO_ROOT, "..\\..\\outside.txt")).toThrow(/escapes/);
    }
  );

  it("produces a clear error when the resource does not exist", () => {
    expect(() => resolvePackageResource(REPO_ROOT, "benchmarks/contracts/does-not-exist.json")).toThrow(/not found/);
  });
});
