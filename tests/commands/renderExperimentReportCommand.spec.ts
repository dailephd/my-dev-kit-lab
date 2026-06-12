import { existsSync, mkdtempSync } from "node:fs";
import { readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  runRenderExperimentReportCommand,
  runRenderExperimentReportFromArgs
} from "../../src/commands/renderExperimentReportCommand.js";
import { createFakeExperimentFixture } from "../report/experimentReportTestHelpers.js";

const tempDirs: string[] = [];

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

describe("renderExperimentReportCommand", () => {
  it("renders a fake experiment report and supports title, subtitle, and size limits", async () => {
    const experimentDir = await createFakeExperimentFixture();
    const outDir = mkdtempSync(path.join(os.tmpdir(), "experiment-report-command-"));
    tempDirs.push(experimentDir, outDir);
    const code = await runRenderExperimentReportCommand([
      "--experiment",
      experimentDir,
      "--out",
      outDir,
      "--title",
      "Custom Report",
      "--subtitle",
      "Custom Subtitle",
      "--max-prompt-chars",
      "60",
      "--max-file-tree-entries",
      "2",
      "--no-screenshot"
    ]);
    expect(code).toBe(0);
    expect(existsSync(path.join(outDir, "experiment-report.json"))).toBe(true);
    expect(existsSync(path.join(outDir, "experiment-report.html"))).toBe(true);
    expect(existsSync(path.join(outDir, "gallery-manifest.json"))).toBe(false);
    const html = await readFile(path.join(outDir, "experiment-report.html"), "utf8");
    expect(html).toContain("Custom Report");
    expect(html).toContain("Executive Summary");
  });

  it("fails clearly for missing experiment directory and required artifacts", async () => {
    const outDir = mkdtempSync(path.join(os.tmpdir(), "experiment-report-command-"));
    tempDirs.push(outDir);
    expect(await runRenderExperimentReportCommand(["--experiment", "missing-experiment", "--out", outDir])).toBe(1);

    const emptyExperiment = mkdtempSync(path.join(os.tmpdir(), "empty-experiment-"));
    tempDirs.push(emptyExperiment);
    expect(await runRenderExperimentReportCommand(["--experiment", emptyExperiment, "--out", outDir])).toBe(1);
  });

  it("does not run agents or controlled experiments", async () => {
    const experimentDir = await createFakeExperimentFixture();
    const outDir = mkdtempSync(path.join(os.tmpdir(), "experiment-report-command-"));
    tempDirs.push(experimentDir, outDir);
    expect(await runRenderExperimentReportCommand(["--experiment", experimentDir, "--out", outDir, "--no-screenshot"])).toBe(0);
    expect(existsSync(path.join(outDir, "experiment-summary.json"))).toBe(false);
    expect(existsSync(path.join(outDir, "runs"))).toBe(false);
  });

  it("supports optional screenshot capture through the existing screenshot layer", async () => {
    const experimentDir = await createFakeExperimentFixture();
    const outDir = mkdtempSync(path.join(os.tmpdir(), "experiment-report-command-"));
    tempDirs.push(experimentDir, outDir);
    const result = await runRenderExperimentReportFromArgs(
      {
        experimentDir,
        outDir,
        screenshot: true,
        requireScreenshot: false
      },
      process.cwd(),
      {
        captureScreenshot: async (htmlPath, pngPath) => ({
          status: "captured",
          htmlPath,
          pngPath
        })
      }
    );
    expect(result.screenshot.status).toBe("captured");
    const payload = JSON.parse(await readFile(path.join(outDir, "experiment-report.json"), "utf8"));
    expect(payload.screenshot.status).toBe("captured");
  });
});
