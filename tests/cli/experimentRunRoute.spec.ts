import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { runLabCli } from "../../src/cli/index.js";

// ---------------------------------------------------------------------------
// v0.4.6 Batch 4 -- installed-style `experiment run` output separation
// (workspace-rooted implicit output vs unchanged explicit output), bundled
// resource resolution independent of invocationCwd, and target immutability
// for an external target. Mirrors tests/cli/auditRoute.spec.ts's structure.
// ---------------------------------------------------------------------------

const tempDirs: string[] = [];
afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

function makeTargetProject(name: string): string {
  const root = mkdtempSync(path.join(os.tmpdir(), "experiment-route-target-"));
  tempDirs.push(root);
  const targetRoot = path.join(root, name);
  mkdirSync(targetRoot);
  writeFileSync(
    path.join(targetRoot, "package.json"),
    `${JSON.stringify({ name: "experiment-route-target", version: "0.0.1" }, null, 2)}\n`
  );
  writeFileSync(path.join(targetRoot, "README.md"), "# Target\n");
  return targetRoot;
}

function baseRunArgs(): string[] {
  return [
    "--experiment",
    "context-strategy-comparison",
    "--case",
    "todo-ts-create-task",
    "--agents",
    "fake-agent",
    "--complexities",
    "short",
    "--no-screenshot"
  ];
}

function findFirstFile(root: string, filename: string): string | undefined {
  for (const entry of readdirSync(root, { withFileTypes: true })) {
    const entryPath = path.join(root, entry.name);
    if (entry.isDirectory()) {
      const found = findFirstFile(entryPath, filename);
      if (found) return found;
    } else if (entry.name === filename) {
      return entryPath;
    }
  }
  return undefined;
}

describe("experiment run route -- workspace output and resource resolution", () => {
  it("writes implicit (no --out) output under workspaceRoot/lab-output/experiments/", async () => {
    const workspaceRoot = mkdtempSync(path.join(os.tmpdir(), "experiment-route-workspace-"));
    tempDirs.push(workspaceRoot);

    const code = await runLabCli(["--workspace", workspaceRoot, "experiment", "run", ...baseRunArgs()]);
    expect(code).toBe(0);

    const expectedRoot = path.join(workspaceRoot, "lab-output", "experiments", "context-strategy-comparison");
    expect(existsSync(expectedRoot)).toBe(true);
    const pluginResult = findFirstFile(expectedRoot, "experiment-plugin-result.json");
    expect(pluginResult).toBeDefined();
  }, 15000);

  it("preserves explicit --out semantics (not redirected under workspaceRoot)", async () => {
    const workspaceRoot = mkdtempSync(path.join(os.tmpdir(), "experiment-route-workspace-explicit-"));
    tempDirs.push(workspaceRoot);
    const explicitOut = mkdtempSync(path.join(os.tmpdir(), "experiment-route-explicit-out-"));
    tempDirs.push(explicitOut);

    const code = await runLabCli([
      "--workspace",
      workspaceRoot,
      "experiment",
      "run",
      ...baseRunArgs(),
      "--out",
      explicitOut
    ]);
    expect(code).toBe(0);
    expect(existsSync(path.join(explicitOut, "experiment-plugin-result.json"))).toBe(true);
    expect(existsSync(path.join(workspaceRoot, "lab-output"))).toBe(false);
  }, 15000);

  it("resolves the bundled default cases/project-profiles resources independent of invocationCwd", async () => {
    const workspaceRoot = mkdtempSync(path.join(os.tmpdir(), "experiment-route-workspace-resources-"));
    tempDirs.push(workspaceRoot);
    const unrelatedCwd = mkdtempSync(path.join(os.tmpdir(), "experiment-route-unrelated-cwd-"));
    tempDirs.push(unrelatedCwd);
    const explicitOut = mkdtempSync(path.join(os.tmpdir(), "experiment-route-resources-out-"));
    tempDirs.push(explicitOut);

    const originalCwd = process.cwd();
    try {
      process.chdir(unrelatedCwd);
      // No --cases / --project-profiles supplied: must resolve the bundled
      // package resources via resourceRoot, not a checkout-relative path
      // under the (unrelated) invocationCwd.
      const code = await runLabCli([
        "--workspace",
        workspaceRoot,
        "experiment",
        "run",
        ...baseRunArgs(),
        "--out",
        explicitOut
      ]);
      expect(code).toBe(0);
    } finally {
      process.chdir(originalCwd);
    }
    expect(existsSync(path.join(explicitOut, "experiment-plugin-result.json"))).toBe(true);
  }, 15000);

  it("leaves an external target byte-for-byte unmodified (target immutability)", async () => {
    const workspaceRoot = mkdtempSync(path.join(os.tmpdir(), "experiment-route-workspace-immutability-"));
    tempDirs.push(workspaceRoot);
    const explicitOut = mkdtempSync(path.join(os.tmpdir(), "experiment-route-immutability-out-"));
    tempDirs.push(explicitOut);
    const targetRoot = makeTargetProject("target with spaces");

    const beforePackageJson = readFileSync(path.join(targetRoot, "package.json"), "utf8");
    const beforeReadme = readFileSync(path.join(targetRoot, "README.md"), "utf8");
    const beforeEntries = readdirSync(targetRoot).sort();

    const code = await runLabCli([
      "--workspace",
      workspaceRoot,
      "experiment",
      "run",
      ...baseRunArgs(),
      "--target",
      targetRoot,
      "--out",
      explicitOut
    ]);
    expect(code).toBe(0);

    expect(readFileSync(path.join(targetRoot, "package.json"), "utf8")).toBe(beforePackageJson);
    expect(readFileSync(path.join(targetRoot, "README.md"), "utf8")).toBe(beforeReadme);
    expect(readdirSync(targetRoot).sort()).toEqual(beforeEntries);
  }, 15000);
});
