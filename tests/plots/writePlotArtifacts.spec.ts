import { existsSync, mkdtempSync } from "node:fs";
import { rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { writePlotArtifacts } from "../../src/plots/index.js";
import { createFakeExperimentFixture } from "../report/experimentReportTestHelpers.js";

const tempDirs: string[] = [];
afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

describe("writePlotArtifacts", () => {
  it("writes summary, data, and all required charts", async () => {
    const experimentDir = await createFakeExperimentFixture();
    const outDir = mkdtempSync(path.join(os.tmpdir(), "plots-"));
    tempDirs.push(experimentDir, outDir);
    const artifacts = await writePlotArtifacts({ experimentDir, outDir });
    expect(existsSync(artifacts.artifactPaths.summaryPath)).toBe(true);
    expect(existsSync(artifacts.artifactPaths.dataPath)).toBe(true);
    expect(Object.keys(artifacts.artifactPaths.charts)).toHaveLength(6);
    for (const chartPath of Object.values(artifacts.artifactPaths.charts)) expect(existsSync(chartPath)).toBe(true);
  });
});
