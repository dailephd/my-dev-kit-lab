import { existsSync, mkdtempSync } from "node:fs";
import { rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { writeVisualizationDemoArtifacts } from "../../src/visualizationDemos/index.js";

const tempDirs: string[] = [];
afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

describe("writeVisualizationDemoArtifacts", () => {
  it("writes summary and run artifacts", async () => {
    const outDir = mkdtempSync(path.join(os.tmpdir(), "viz-write-"));
    tempDirs.push(outDir);
    const artifacts = await writeVisualizationDemoArtifacts({ outDir, projectPath: "project", kitCommand: "kit", runs: [], warnings: [] });
    expect(existsSync(artifacts.artifactPaths.summaryPath)).toBe(true);
    expect(existsSync(artifacts.artifactPaths.runsPath)).toBe(true);
  });
});
