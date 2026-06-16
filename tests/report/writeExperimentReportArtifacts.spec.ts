import { existsSync, mkdtempSync } from "node:fs";
import { rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { buildExperimentReportInput, getExperimentReportArtifactPaths, writeExperimentReportArtifacts } from "../../src/report/index.js";
import { createFakeExperimentFixture } from "./experimentReportTestHelpers.js";

const tempDirs: string[] = [];

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

describe("writeExperimentReportArtifacts", () => {
  it("writes JSON, HTML, and artifact index with deterministic filenames", async () => {
    const experimentDir = await createFakeExperimentFixture();
    const outDir = mkdtempSync(path.join(os.tmpdir(), "experiment-report-write-"));
    tempDirs.push(experimentDir, outDir);
    const report = await buildExperimentReportInput({ experimentDir });
    const result = await writeExperimentReportArtifacts({
      outDir,
      report,
      screenshot: { status: "skipped", htmlPath: path.join(outDir, "experiment-report.html"), pngPath: path.join(outDir, "experiment-report.png"), warning: "skip" }
    });
    expect(result.outputPaths.jsonPath).toBe(path.join(outDir, "experiment-report.json"));
    expect(result.outputPaths.htmlPath).toBe(path.join(outDir, "experiment-report.html"));
    expect(existsSync(result.outputPaths.jsonPath)).toBe(true);
    expect(existsSync(result.outputPaths.htmlPath)).toBe(true);
    expect(existsSync(result.outputPaths.artifactIndexPath)).toBe(true);
    expect(result.warnings).toContain("skip");
  });

  it("does not write outside the output directory", () => {
    const outDir = mkdtempSync(path.join(os.tmpdir(), "experiment-report-write-"));
    tempDirs.push(outDir);
    expect(() => getExperimentReportArtifactPaths(path.join(outDir, "..", "outside"))).not.toThrow();
    const paths = getExperimentReportArtifactPaths(outDir);
    expect(paths.htmlPath.startsWith(path.resolve(outDir))).toBe(true);
  });
});
