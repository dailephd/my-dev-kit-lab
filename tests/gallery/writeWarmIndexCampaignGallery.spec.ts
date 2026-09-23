import { existsSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { mkdir, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { PlotArtifacts } from "../../src/plots/types.js";
import type { ScreenshotCaptureResult } from "../../src/screenshot/types.js";
import { writeWarmIndexCampaignGallery } from "../../src/gallery/writeWarmIndexCampaignGallery.js";

const tempDirs: string[] = [];
afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

const CHART_IDS = [
  "warm-index-amortized-index-cost",
  "warm-index-context-size",
  "warm-index-correctness",
  "warm-index-cumulative-token-usage",
] as const;

/** Writes a bounded local fixture campaign output directory: report + execution + four charts. */
async function makeFixture(options: { chartCount?: number; plotWarnings?: string[] } = {}) {
  const root = mkdtempSync(path.join(os.tmpdir(), "warm-campaign-gallery-"));
  tempDirs.push(root);

  const jsonPath = path.join(root, "report.json");
  const htmlPath = path.join(root, "report.html");
  const textPath = path.join(root, "report.txt");
  const executionArtifactPath = path.join(root, "warm-index-execution.json");
  writeFileSync(jsonPath, "{}");
  writeFileSync(htmlPath, "<html></html>");
  writeFileSync(textPath, "report text");
  writeFileSync(executionArtifactPath, "{}");

  const plotsDir = path.join(root, "plots");
  const chartsDir = path.join(plotsDir, "charts");
  await mkdir(chartsDir, { recursive: true });
  const summaryPath = path.join(plotsDir, "plots-summary.json");
  const dataPath = path.join(plotsDir, "plot-data.json");
  writeFileSync(summaryPath, "{}");
  writeFileSync(dataPath, "{}");

  const chartCount = options.chartCount ?? CHART_IDS.length;
  const charts: Record<string, string> = {};
  for (const id of CHART_IDS.slice(0, chartCount)) {
    const chartPath = path.join(chartsDir, `${id}.svg`);
    writeFileSync(chartPath, "<svg></svg>");
    charts[id] = chartPath;
  }

  const plotArtifacts: PlotArtifacts = {
    summary: {
      generatedAt: "2026-01-01T00:00:00.000Z",
      sourceExperimentDir: root,
      chartCount,
      skippedPointCount: 0,
      warnings: options.plotWarnings ?? [],
    },
    data: { generatedAt: "2026-01-01T00:00:00.000Z", sourceExperimentDir: root, plots: [], skippedPoints: [], warnings: options.plotWarnings ?? [] },
    artifactPaths: { summaryPath, dataPath, chartsDir, charts },
  };

  return { root, jsonPath, htmlPath, textPath, executionArtifactPath, plotArtifacts };
}

describe("writeWarmIndexCampaignGallery", () => {
  it("writes exactly three items with a captured screenshot (section 30.1)", async () => {
    const fixture = await makeFixture();
    const pngPath = path.join(fixture.root, "report.png");
    writeFileSync(pngPath, "png");
    const screenshot: ScreenshotCaptureResult = { status: "captured", htmlPath: fixture.htmlPath, pngPath };

    const outDir = path.join(fixture.root, "gallery");
    const { manifest, manifestPath, indexPath } = await writeWarmIndexCampaignGallery({
      outDir,
      campaignOutputRoot: fixture.root,
      reportPaths: { jsonPath: fixture.jsonPath, htmlPath: fixture.htmlPath, textPath: fixture.textPath },
      executionArtifactPath: fixture.executionArtifactPath,
      plotArtifacts: fixture.plotArtifacts,
      screenshot,
      campaignPreset: "codex-full",
      agentId: "codex",
      generatedAt: "2026-01-01T00:00:00.000Z",
    });

    expect(manifest.items.map((item) => item.id)).toEqual([
      "warm-index-campaign-report",
      "warm-index-campaign-plots",
      "warm-index-execution",
    ]);
    const [reportItem, plotsItem, executionItem] = manifest.items;
    expect(reportItem.status).toBe("pass");
    expect(reportItem.screenshotPath).toBe("../report.png");
    expect(reportItem.tags).toEqual(["warm-index", "campaign", "report", "codex"]);
    expect(plotsItem.status).toBe("pass");
    expect(plotsItem.artifactPaths).toHaveLength(4);
    expect(plotsItem.artifactPaths).toEqual(
      expect.arrayContaining(CHART_IDS.map((id) => `../plots/charts/${id}.svg`))
    );
    expect(executionItem.status).toBe("pass");
    expect(executionItem.summaryPath).toBe("../warm-index-execution.json");

    expect(existsSync(indexPath)).toBe(true);
    expect(existsSync(manifestPath)).toBe(true);
    for (const item of manifest.items) {
      for (const value of [item.htmlPath, item.summaryPath, item.runsPath, item.screenshotPath, ...(item.artifactPaths ?? [])]) {
        if (!value) continue;
        expect(path.isAbsolute(value)).toBe(false);
      }
    }
  });

  it("marks the report item warning and omits screenshotPath when skipped (section 30.2)", async () => {
    const fixture = await makeFixture();
    const skipWarning = "PNG screenshot skipped because Playwright or browser runtime is unavailable.";
    const screenshot: ScreenshotCaptureResult = {
      status: "skipped",
      htmlPath: fixture.htmlPath,
      pngPath: path.join(fixture.root, "report.png"),
      warning: skipWarning,
    };

    const { manifest } = await writeWarmIndexCampaignGallery({
      outDir: path.join(fixture.root, "gallery"),
      campaignOutputRoot: fixture.root,
      reportPaths: { jsonPath: fixture.jsonPath, htmlPath: fixture.htmlPath, textPath: fixture.textPath },
      executionArtifactPath: fixture.executionArtifactPath,
      plotArtifacts: fixture.plotArtifacts,
      screenshot,
      campaignPreset: "claude-full",
      agentId: "claude",
    });

    const [reportItem, plotsItem, executionItem] = manifest.items;
    expect(reportItem.status).toBe("warning");
    expect(reportItem.screenshotPath).toBeUndefined();
    expect(reportItem.warnings).toContain(skipWarning);
    expect(manifest.warnings).toContain(skipWarning);
    expect(plotsItem.status).toBe("pass");
    expect(executionItem.status).toBe("pass");
  });

  it("marks the report item warning with a bounded failure warning when screenshot failed (section 30.3)", async () => {
    const fixture = await makeFixture();
    const screenshot: ScreenshotCaptureResult = {
      status: "failed",
      htmlPath: fixture.htmlPath,
      pngPath: path.join(fixture.root, "report.png"),
      error: "forced screenshot failure",
    };

    const { manifest, manifestPath, indexPath } = await writeWarmIndexCampaignGallery({
      outDir: path.join(fixture.root, "gallery"),
      campaignOutputRoot: fixture.root,
      reportPaths: { jsonPath: fixture.jsonPath, htmlPath: fixture.htmlPath, textPath: fixture.textPath },
      executionArtifactPath: fixture.executionArtifactPath,
      plotArtifacts: fixture.plotArtifacts,
      screenshot,
      campaignPreset: "codex-full",
      agentId: "codex",
    });

    const [reportItem] = manifest.items;
    expect(reportItem.status).toBe("warning");
    expect(reportItem.screenshotPath).toBeUndefined();
    expect(reportItem.warnings.some((warning) => warning.includes("forced screenshot failure"))).toBe(true);
    expect(existsSync(manifestPath)).toBe(true);
    expect(existsSync(indexPath)).toBe(true);
  });

  it("throws when a required report artifact is missing (section 30.4)", async () => {
    const fixture = await makeFixture();
    const screenshot: ScreenshotCaptureResult = { status: "skipped", htmlPath: fixture.htmlPath, pngPath: path.join(fixture.root, "report.png") };
    await expect(
      writeWarmIndexCampaignGallery({
        outDir: path.join(fixture.root, "gallery"),
        campaignOutputRoot: fixture.root,
        reportPaths: { jsonPath: path.join(fixture.root, "missing-report.json"), htmlPath: fixture.htmlPath, textPath: fixture.textPath },
        executionArtifactPath: fixture.executionArtifactPath,
        plotArtifacts: fixture.plotArtifacts,
        screenshot,
        campaignPreset: "codex-full",
        agentId: "codex",
      })
    ).rejects.toThrow(/Required warm-index campaign gallery artifact does not exist/);
  });

  it("throws when a required chart is missing (section 30.5)", async () => {
    const fixture = await makeFixture({ chartCount: 3 });
    const screenshot: ScreenshotCaptureResult = { status: "skipped", htmlPath: fixture.htmlPath, pngPath: path.join(fixture.root, "report.png") };
    await expect(
      writeWarmIndexCampaignGallery({
        outDir: path.join(fixture.root, "gallery"),
        campaignOutputRoot: fixture.root,
        reportPaths: { jsonPath: fixture.jsonPath, htmlPath: fixture.htmlPath, textPath: fixture.textPath },
        executionArtifactPath: fixture.executionArtifactPath,
        plotArtifacts: fixture.plotArtifacts,
        screenshot,
        campaignPreset: "codex-full",
        agentId: "codex",
      })
    ).rejects.toThrow(/missing the required chart artifact/);
  });

  it("never links bounded provider evidence and never contains context/prompt/answer/stdout/stderr bodies (section 30.6, 41)", async () => {
    const fixture = await makeFixture();
    const screenshot: ScreenshotCaptureResult = { status: "skipped", htmlPath: fixture.htmlPath, pngPath: path.join(fixture.root, "report.png"), warning: "skip" };
    const { manifest, manifestPath, indexPath } = await writeWarmIndexCampaignGallery({
      outDir: path.join(fixture.root, "gallery"),
      campaignOutputRoot: fixture.root,
      reportPaths: { jsonPath: fixture.jsonPath, htmlPath: fixture.htmlPath, textPath: fixture.textPath },
      executionArtifactPath: fixture.executionArtifactPath,
      plotArtifacts: fixture.plotArtifacts,
      screenshot,
      campaignPreset: "codex-full",
      agentId: "codex",
    });

    expect(JSON.stringify(manifest)).not.toContain("agents/");
    const manifestText = readFileSync(manifestPath, "utf8");
    const indexText = readFileSync(indexPath, "utf8");
    for (const text of [manifestText, indexText]) {
      for (const forbidden of ["contextText", "promptText", "finalAnswerText", "stdout", "stderr", "agents/"]) {
        expect(text).not.toContain(forbidden);
      }
    }
  });
});
