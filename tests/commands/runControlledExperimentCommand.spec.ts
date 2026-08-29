import { existsSync, mkdirSync, mkdtempSync, symlinkSync } from "node:fs";
import { readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import {
  runControlledExperimentCommand,
  runControlledExperimentFromArgs
} from "../../src/commands/runControlledExperimentCommand.js";

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");

const tempDirs: string[] = [];

afterEach(async () => {
  delete process.env.FAKE_AGENT_MODE;
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

function baseArgs(outDir: string): string[] {
  return [
    "--cases",
    "examples/token-savings-cases.json",
    "--case",
    "todo-ts-create-task",
    "--agents",
    "fake-agent",
    "--strategies",
    "raw-full-file,my-dev-kit-guided",
    "--complexities",
    "short",
    "--out",
    outDir
  ];
}

describe("runControlledExperimentCommand", () => {
  it("runs fake-agent with default short complexity and writes artifacts", async () => {
    const outDir = mkdtempSync(path.join(os.tmpdir(), "controlled-command-"));
    tempDirs.push(outDir);
    expect(await runControlledExperimentCommand(baseArgs(outDir))).toBe(0);
    expect(existsSync(path.join(outDir, "experiment-summary.json"))).toBe(true);
    expect(existsSync(path.join(outDir, "experiment-runs.json"))).toBe(true);
    expect(existsSync(path.join(outDir, "experiment-comparisons.json"))).toBe(true);
    expect(existsSync(path.join(outDir, "experiment-plugin-result.json"))).toBe(true);
    const summary = JSON.parse(await readFile(path.join(outDir, "experiment-summary.json"), "utf8"));
    expect(summary.totalRuns).toBe(2);
    const pluginResult = JSON.parse(await readFile(path.join(outDir, "experiment-plugin-result.json"), "utf8"));
    expect(pluginResult.pluginId).toBe("context-strategy-comparison");
  });

  it("supports multi-step complexity and max-runs", async () => {
    const outDir = mkdtempSync(path.join(os.tmpdir(), "controlled-command-"));
    tempDirs.push(outDir);
    expect(await runControlledExperimentCommand([...baseArgs(outDir), "--complexities", "short,multi-step", "--max-runs", "3"])).toBe(0);
    const summary = JSON.parse(await readFile(path.join(outDir, "experiment-summary.json"), "utf8"));
    expect(summary.totalRuns).toBe(3);
  });

  it("fails clearly for missing cases file, invalid agent, and real agents without include-real-agents", async () => {
    const outDir = mkdtempSync(path.join(os.tmpdir(), "controlled-command-"));
    tempDirs.push(outDir);
    expect(await runControlledExperimentCommand(["--cases", "missing.json", "--out", outDir])).toBe(1);
    expect(await runControlledExperimentCommand(["--cases", "examples/token-savings-cases.json", "--agents", "bad", "--out", outDir])).toBe(1);
    expect(await runControlledExperimentCommand(["--cases", "examples/token-savings-cases.json", "--agents", "codex", "--out", outDir])).toBe(1);
  });

  it("handles fake-agent failure mode and still writes structured outcomes", async () => {
    const outDir = mkdtempSync(path.join(os.tmpdir(), "controlled-command-"));
    tempDirs.push(outDir);
    process.env.FAKE_AGENT_MODE = "failure";
    expect(await runControlledExperimentCommand(baseArgs(outDir))).toBe(0);
    const summary = JSON.parse(await readFile(path.join(outDir, "experiment-summary.json"), "utf8"));
    expect(summary.failedRuns).toBe(2);
  });

  it("locates the default benchmark project profiles without depending on repoRoot/cwd", async () => {
    const outDir = mkdtempSync(path.join(os.tmpdir(), "controlled-command-"));
    tempDirs.push(outDir);

    // A repoRoot that has the benchmark project fixtures (needed by the
    // existing, unchanged rootPath validation) but deliberately has no
    // benchmarks/contracts/ directory, so the old repoRoot-relative lookup
    // of benchmark-project-profiles.json would fail with ENOENT here.
    const fakeRepoRoot = mkdtempSync(path.join(os.tmpdir(), "controlled-command-fake-repo-"));
    tempDirs.push(fakeRepoRoot);
    mkdirSync(path.join(fakeRepoRoot, "benchmarks"), { recursive: true });
    symlinkSync(
      path.join(REPO_ROOT, "benchmarks", "projects"),
      path.join(fakeRepoRoot, "benchmarks", "projects"),
      "junction"
    );
    expect(existsSync(path.join(fakeRepoRoot, "benchmarks", "contracts"))).toBe(false);

    const { projectProfiles, artifacts } = await runControlledExperimentFromArgs(
      {
        casesPath: path.join(REPO_ROOT, "examples", "token-savings-cases.json"),
        caseIds: ["todo-ts-create-task"],
        agents: ["fake-agent"],
        strategies: ["raw-full-file", "my-dev-kit-guided"],
        complexityLevels: ["short"],
        outDir
      },
      fakeRepoRoot
    );

    expect(projectProfiles.length).toBeGreaterThan(0);
    expect(artifacts.summary.totalRuns).toBe(2);
  });
});
