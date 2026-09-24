import { existsSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { createDefaultExperimentPluginRegistry, runExperiment } from "../../src/experiments/index.js";
import { runWarmIndexCampaignPresentation } from "../../src/commands/runWarmIndexCampaignPresentation.js";
import { writePluginExperimentReports } from "../../src/report/index.js";
import type { ScreenshotCaptureResult } from "../../src/screenshot/types.js";
import { fakeKitCommand, loadBundledProjectProfiles, makeCase } from "../experiments/warmIndexReuse/warmIndexTestHelpers.js";

const tempDirs: string[] = [];
afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

function tempDir(prefix: string): string {
  const dir = mkdtempSync(path.join(os.tmpdir(), prefix));
  tempDirs.push(dir);
  return dir;
}

/** A real (legacy fake-agent) warm-index-reuse report/execution-artifact fixture on disk. */
async function warmReportFixture() {
  const outputRoot = tempDir("warm-presentation-fixture-");
  const registry = createDefaultExperimentPluginRegistry();
  const run = await runExperiment({
    pluginId: "warm-index-reuse",
    registry,
    outputRoot,
    config: { kitCommand: fakeKitCommand },
    inputs: { cases: [makeCase({ id: "task-a" }), makeCase({ id: "task-b" })], projectProfiles: await loadBundledProjectProfiles() },
    toolRoot: process.cwd(),
    runId: "warm-presentation-fixture-run",
  });
  const { outputPaths } = await writePluginExperimentReports({ run, plugin: registry.describe("warm-index-reuse") });
  const executionArtifactPath = path.join(outputRoot, "warm-index-execution.json");
  return { outputRoot, reportPaths: outputPaths, executionArtifactPath };
}

describe("runWarmIndexCampaignPresentation", () => {
  it("produces four plots, a captured screenshot, and a gallery with no warnings (section 31.1)", async () => {
    const fixture = await warmReportFixture();
    const captureScreenshot = async (htmlPath: string, pngPath: string): Promise<ScreenshotCaptureResult> => {
      writeFileSync(pngPath, "png-data");
      return { status: "captured", htmlPath, pngPath };
    };

    const result = await runWarmIndexCampaignPresentation({
      outputRoot: fixture.outputRoot,
      reportPaths: fixture.reportPaths,
      executionArtifactPath: fixture.executionArtifactPath,
      campaignPreset: "codex-full",
      agentId: "codex",
      captureScreenshot,
    });

    expect(Object.keys(result.plots.artifactPaths.charts)).toHaveLength(4);
    expect(existsSync(path.join(fixture.outputRoot, "plots", "plot-data.json"))).toBe(true);
    expect(result.screenshot.status).toBe("captured");
    expect(existsSync(result.gallery.manifestPath)).toBe(true);
    expect(existsSync(result.gallery.indexPath)).toBe(true);
    expect(result.gallery.manifest.items).toHaveLength(3);
    expect(result.warnings).toEqual([]);
  });

  it("keeps plots and gallery when screenshot capture is skipped (section 31.2)", async () => {
    const fixture = await warmReportFixture();
    const skipWarning = "PNG screenshot skipped because Playwright or browser runtime is unavailable.";
    const captureScreenshot = async (htmlPath: string, pngPath: string): Promise<ScreenshotCaptureResult> => ({
      status: "skipped",
      htmlPath,
      pngPath,
      warning: skipWarning,
    });

    const result = await runWarmIndexCampaignPresentation({
      outputRoot: fixture.outputRoot,
      reportPaths: fixture.reportPaths,
      executionArtifactPath: fixture.executionArtifactPath,
      campaignPreset: "claude-full",
      agentId: "claude",
      captureScreenshot,
    });

    expect(Object.keys(result.plots.artifactPaths.charts)).toHaveLength(4);
    expect(existsSync(result.gallery.manifestPath)).toBe(true);
    expect(existsSync(path.join(fixture.outputRoot, "report.png"))).toBe(false);
    expect(result.screenshot.status).toBe("skipped");
    expect(result.warnings).toContain(skipWarning);
  });

  it("keeps plots and gallery and returns normally when screenshot capture fails (section 31.3)", async () => {
    const fixture = await warmReportFixture();
    const captureScreenshot = async (htmlPath: string, pngPath: string): Promise<ScreenshotCaptureResult> => ({
      status: "failed",
      htmlPath,
      pngPath,
      error: "forced screenshot failure",
    });

    const result = await runWarmIndexCampaignPresentation({
      outputRoot: fixture.outputRoot,
      reportPaths: fixture.reportPaths,
      executionArtifactPath: fixture.executionArtifactPath,
      campaignPreset: "codex-full",
      agentId: "codex",
      captureScreenshot,
    });

    expect(Object.keys(result.plots.artifactPaths.charts)).toHaveLength(4);
    expect(existsSync(result.gallery.manifestPath)).toBe(true);
    expect(result.screenshot.status).toBe("failed");
    expect(result.warnings.some((warning) => warning.includes("forced screenshot failure"))).toBe(true);
    // The helper never throws solely because screenshot.status === "failed"; the command decides exit code.
    const manifestText = readFileSync(result.gallery.manifestPath, "utf8");
    expect(manifestText).toContain("forced screenshot failure");
  });
});
