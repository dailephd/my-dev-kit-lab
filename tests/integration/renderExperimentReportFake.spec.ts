import { existsSync, mkdtempSync } from "node:fs";
import { readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { runRenderExperimentReportCommand } from "../../src/commands/renderExperimentReportCommand.js";
import { createFakeExperimentFixture } from "../report/experimentReportTestHelpers.js";

const tempDirs: string[] = [];

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

describe("render experiment report fake integration", () => {
  it("renders report JSON and HTML from a fake controlled experiment without gallery or screenshot by default", async () => {
    const experimentDir = await createFakeExperimentFixture();
    const outDir = mkdtempSync(path.join(os.tmpdir(), "experiment-report-integration-"));
    tempDirs.push(experimentDir, outDir);
    expect(await runRenderExperimentReportCommand(["--experiment", experimentDir, "--out", outDir, "--no-screenshot"])).toBe(0);
    expect(existsSync(path.join(outDir, "experiment-report.json"))).toBe(true);
    expect(existsSync(path.join(outDir, "experiment-report.html"))).toBe(true);
    expect(existsSync(path.join(outDir, "experiment-report.png"))).toBe(false);
    expect(existsSync(path.join(outDir, "gallery-manifest.json"))).toBe(false);
    const html = await readFile(path.join(outDir, "experiment-report.html"), "utf8");
    expect(html).toContain("Executive Summary");
    expect(html).toContain("Does my-dev-kit save tokens?");
    expect(html).toContain("correctnessScore");
    expect(html).toContain("tokenDelta");
    expect(html).toContain("durationDeltaMs");
  });
});
