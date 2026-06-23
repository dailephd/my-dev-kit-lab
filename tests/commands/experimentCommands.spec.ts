import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { rm, stat } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { afterEach, describe, expect, it } from "vitest";
import { parseRunExperimentArgs } from "../../scripts/experiments/runExperiment.js";

const tempDirs: string[] = [];

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

describe("experiment npm scripts", () => {
  it("experiment:list includes context-strategy-comparison", () => {
    const result = runNpm(["run", "experiment:list"]);

    expect(result.status).toBe(0);
    expect(result.stdout).toContain("context-strategy-comparison");
    expect(result.stdout).toContain("Context Strategy Comparison");
    expect(result.stdout).toContain("raw-full-file");
    expect(result.stdout).toContain("my-dev-kit-guided");
  });

  it("experiment:list supports JSON output", () => {
    const result = runNpm(["run", "--silent", "experiment:list", "--", "--json"]);

    expect(result.status).toBe(0);
    const parsed = JSON.parse(result.stdout);
    expect(parsed.experiments[0]).toEqual(
      expect.objectContaining({
        id: "context-strategy-comparison",
        supportedVariants: ["raw-full-file", "my-dev-kit-guided"],
      })
    );
  });

  it("experiment:describe prints plugin metadata and usage details", () => {
    const result = runNpm([
      "run",
      "experiment:describe",
      "--",
      "--experiment",
      "context-strategy-comparison",
    ]);

    expect(result.status).toBe(0);
    expect(result.stdout).toContain("Context Strategy Comparison");
    expect(result.stdout).toContain("Purpose:");
    expect(result.stdout).toContain("Supported variants: raw-full-file, my-dev-kit-guided");
    expect(result.stdout).toContain("Target behavior:");
    expect(result.stdout).toContain("Expected reports:");
    expect(result.stdout).toContain("npm run experiment:run");
  });

  it("experiment:describe fails cleanly for an unknown plugin", () => {
    const result = runNpm([
      "run",
      "experiment:describe",
      "--",
      "--experiment",
      "does-not-exist",
    ]);

    expect(result.status).toBe(1);
    expect(result.stderr).toContain("Experiment plugin not found: does-not-exist");
    expect(result.stderr).not.toContain("at ");
  });

  it("experiment:run parses target paths with spaces and accepts --no-screenshot", () => {
    const parsed = parseRunExperimentArgs([
      "--experiment",
      "context-strategy-comparison",
      "--target",
      "C:\\Target With Spaces",
      "--agents",
      "fake-agent",
      "--complexities",
      "short",
      "--no-screenshot",
    ]);

    expect(parsed.experimentId).toBe("context-strategy-comparison");
    expect(parsed.targetPath).toBe("C:\\Target With Spaces");
    expect(parsed.config.agents).toEqual(["fake-agent"]);
    expect(parsed.config.complexityLevels).toEqual(["short"]);
  });

  it("experiment:run rejects missing target paths cleanly", () => {
    expect(() =>
      parseRunExperimentArgs([
        "--experiment",
        "context-strategy-comparison",
        "--target",
      ])
    ).toThrow("--target requires a value.");
  });

  it("experiment:run uses the generic runner and writes plugin-aware reports", async () => {
    const targetRoot = makeTargetProject("experiment target with spaces");
    const outRoot = mkdtempSync(path.join(os.tmpdir(), "experiment-script-output-"));
    tempDirs.push(outRoot);

    const result = runNpm([
      "run",
      "experiment:run",
      "--",
      "--experiment",
      "context-strategy-comparison",
      "--target",
      targetRoot,
      "--out",
      outRoot,
      "--case",
      "todo-ts-create-task",
      "--agents",
      "fake-agent",
      "--complexities",
      "short",
      "--no-screenshot",
    ]);

    expect(result.status).toBe(0);
    expect(result.stdout).toContain("Run ID:");
    expect(result.stdout).toContain("Report JSON:");
    expect(result.stdout).toContain("Report HTML:");
    expect(result.stdout).toContain("external target");
    await expect(stat(path.join(outRoot, "experiment-summary.json"))).resolves.toBeTruthy();
    await expect(stat(path.join(outRoot, "experiment-plugin-result.json"))).resolves.toBeTruthy();
    await expect(stat(path.join(outRoot, "report.json"))).resolves.toBeTruthy();
    await expect(stat(path.join(outRoot, "report.html"))).resolves.toBeTruthy();
  });

  it("legacy run-controlled-experiment path still works", () => {
    const outRoot = mkdtempSync(path.join(os.tmpdir(), "legacy-controlled-output-"));
    tempDirs.push(outRoot);

    const result = runNpm([
      "run",
      "run-controlled-experiment",
      "--",
      "--cases",
      "examples/token-savings-cases.json",
      "--case",
      "todo-ts-create-task",
      "--agents",
      "fake-agent",
      "--complexities",
      "short",
      "--strategies",
      "raw-full-file,my-dev-kit-guided",
      "--out",
      outRoot,
    ]);

    expect(result.status).toBe(0);
    expect(result.stdout).toContain("Runs: 2");
    expect(result.stdout).toContain("Comparisons: 1");
  });
});

function runNpm(args: string[]): { status: number | null; stdout: string; stderr: string } {
  const command = npmCommand();
  const result = spawnSync(command.command, [...command.prefixArgs, ...args], {
    cwd: process.cwd(),
    encoding: "utf8",
    env: { ...process.env, NO_COLOR: "1" },
    maxBuffer: 1024 * 1024 * 10,
  });
  return {
    status: result.status,
    stdout: result.stdout,
    stderr: result.stderr || (result.error ? String(result.error) : ""),
  };
}

function npmCommand(): { command: string; prefixArgs: string[] } {
  if (process.env.npm_execpath) {
    return { command: process.execPath, prefixArgs: [process.env.npm_execpath] };
  }
  return {
    command: process.platform === "win32" ? "npm.cmd" : "npm",
    prefixArgs: [],
  };
}

function makeTargetProject(name: string): string {
  const root = mkdtempSync(path.join(os.tmpdir(), "experiment-cli-target-"));
  tempDirs.push(root);
  const targetRoot = path.join(root, name);
  mkdirSync(targetRoot);
  writeFileSync(
    path.join(targetRoot, "package.json"),
    `${JSON.stringify({ name: "experiment-cli-target", version: "0.0.1" }, null, 2)}\n`
  );
  writeFileSync(path.join(targetRoot, "README.md"), "# Target\n");
  return targetRoot;
}
