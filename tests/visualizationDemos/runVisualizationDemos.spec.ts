import { copyFileSync, existsSync, mkdirSync, mkdtempSync } from "node:fs";
import { rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { runVisualizationDemos } from "../../src/visualizationDemos/index.js";

const tempDirs: string[] = [];
afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

describe("runVisualizationDemos", () => {
  it("runs fake my-dev-kit visualization demos and records artifacts", async () => {
    const outDir = mkdtempSync(path.join(os.tmpdir(), "viz-"));
    tempDirs.push(outDir);
    const artifacts = await runVisualizationDemos({
      projectPath: path.resolve("benchmarks/projects/todo-ts"),
      kitCommand: "node tests/fixtures/fake-my-dev-kit-cli.js",
      outDir
    });
    expect(artifacts.summary.totalRuns).toBe(6);
    expect(artifacts.summary.completedRuns).toBe(6);
    expect(existsSync(path.join(outDir, "artifacts", "call-graph.svg"))).toBe(true);
    expect(artifacts.runs[0].stdoutPath).toContain("stdout");
  }, 15000);

  it("records unsupported commands as warnings", async () => {
    const outDir = mkdtempSync(path.join(os.tmpdir(), "viz-fail-"));
    tempDirs.push(outDir);
    const artifacts = await runVisualizationDemos({
      projectPath: path.resolve("benchmarks/projects/todo-ts"),
      kitCommand: "node tests/fixtures/fake-my-dev-kit-cli.js",
      outDir,
      commands: [{ id: "bad", name: "Bad", command: "node tests/fixtures/fake-my-dev-kit-cli.js", args: ["unsupported"], cwd: process.cwd(), expectedArtifacts: [] }]
    });
    expect(artifacts.summary.failedRuns).toBe(1);
    expect(artifacts.warnings.some((warning) => warning.includes("unsupported") || warning.includes("failed"))).toBe(true);
  });

  it("normalizes a node kit command whose script path contains spaces", async () => {
    const rootDir = mkdtempSync(path.join(os.tmpdir(), "viz-space-root-"));
    const scriptDir = path.join(rootDir, "script dir");
    const outDir = path.join(rootDir, "out");
    tempDirs.push(rootDir);
    mkdirSync(scriptDir, { recursive: true });
    const spacedScriptPath = path.join(scriptDir, "fake my-dev-kit cli.js");
    copyFileSync(path.resolve("tests/fixtures/fake-my-dev-kit-cli.js"), spacedScriptPath);

    const artifacts = await runVisualizationDemos({
      projectPath: path.resolve("benchmarks/projects/todo-ts"),
      kitCommand: `node "${spacedScriptPath}"`,
      outDir
    });

    expect(artifacts.summary.completedRuns).toBe(6);
    expect(existsSync(path.join(outDir, "artifacts", "data-model.svg"))).toBe(true);
  }, 15000);
});
