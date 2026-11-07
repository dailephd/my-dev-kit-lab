import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { runLabCli } from "../../src/cli/index.js";
import { runExperimentRunCommandFromArgs } from "../../src/commands/runExperimentRunCommand.js";
import { createLabExecutionContext } from "../../src/runtime/labExecutionContext.js";
import { contextStrategyComparisonPlugin } from "../../src/experiments/plugins/contextStrategyComparison/index.js";
import type { ExperimentExecutionContext, ExperimentPlugin } from "../../src/experiments/types.js";

// ---------------------------------------------------------------------------
// v0.4.6 Batch 4 -- installed-style `experiment run` output separation
// (workspace-rooted implicit output vs unchanged explicit output), bundled
// resource resolution independent of invocationCwd, and target immutability
// for an external target. Mirrors tests/cli/auditRoute.spec.ts's structure.
// ---------------------------------------------------------------------------

const tempDirs: string[] = [];
afterEach(async () => {
  vi.restoreAllMocks();
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

describe("experiment workspace context propagation", () => {
  function probe() {
    const contexts: ExperimentExecutionContext[] = [];
    const plugin: ExperimentPlugin<Parameters<typeof contextStrategyComparisonPlugin.run>[0]["config"]> = contextStrategyComparisonPlugin;
    vi.spyOn(plugin, "run").mockImplementation(async (context) => {
      contexts.push(context);
      return {
        runId: context.runId, pluginId: "context-strategy-comparison",
        startedAt: context.startedAt.toISOString(), completedAt: context.startedAt.toISOString(),
        status: "completed", target: context.target, variants: [], cases: [], metrics: [],
        artifacts: [], warnings: [], failures: [],
        summary: { status: "completed", totalCases: 0, completedCases: 0, partialCases: 0,
          failedCases: 0, skippedCases: 0, metrics: [], warnings: [], failures: [] }
      };
    });
    return contexts;
  }

  function fixture() {
    const root = mkdtempSync(path.join(os.tmpdir(), "workspace-propagation-"));
    tempDirs.push(root);
    return root;
  }

  it.each(["reports", "absolute"])("command keeps distinct package, workspace, invocation and %s output roots", async (out) => {
    const root = fixture();
    const context = createLabExecutionContext({ invocationCwd: root, workspaceRoot: path.join(root, "workspace") });
    const outputRoot = path.join(root, "reports");
    const contexts = probe();
    expect(await runExperimentRunCommandFromArgs([...baseRunArgs(), "--out", out === "absolute" ? outputRoot : out], { context })).toBe(0);
    expect(contexts).toHaveLength(1);
    expect(contexts[0].writableWorkspaceRoot).toBe(context.workspaceRoot);
    expect(contexts[0].toolRoot).toBe(context.packageRoot);
    expect(contexts[0].outputRoot).toBe(outputRoot);
    expect(context.packageRoot).not.toBe(root);
    expect(existsSync(context.workspaceRoot)).toBe(false);
  });

  it.each(["absolute", "relative", "default"])("CLI forwards the %s global workspace through the real command and runner", async (mode) => {
    const root = fixture();
    vi.spyOn(os, "homedir").mockReturnValue(root);
    const expectedWorkspace = mode === "default" ? path.join(root, ".my-dev-kit-lab") : path.join(root, "workspace");
    const workspaceArg = mode === "relative" ? path.relative(process.cwd(), expectedWorkspace) : expectedWorkspace;
    const resolvedWorkspace = mode === "relative" ? path.resolve(process.cwd(), workspaceArg) : expectedWorkspace;
    const contexts = probe();
    const args = mode === "default" ? [] : ["--workspace", workspaceArg];
    expect(await runLabCli([...args, "experiment", "run", ...baseRunArgs()])).toBe(0);
    expect(contexts).toHaveLength(1);
    expect(contexts[0].writableWorkspaceRoot).toBe(resolvedWorkspace);
    expect(contexts[0].toolRoot).toBe(createLabExecutionContext().packageRoot);
    expect(path.relative(resolvedWorkspace, contexts[0].outputRoot!)).toMatch(/^lab-output/);
  });
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
