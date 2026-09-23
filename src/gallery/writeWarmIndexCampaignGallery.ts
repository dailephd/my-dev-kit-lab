import { existsSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import type { PlotArtifacts } from "../plots/types.js";
import type { ScreenshotCaptureResult } from "../screenshot/types.js";
import type { GalleryManifest, GalleryManifestItem } from "./types.js";
import { renderGalleryIndex } from "./writeGalleryManifest.js";

// ---------------------------------------------------------------------------
// v0.5.2 Batch 5 -- narrow warm-index real-agent campaign gallery.
//
// The generic writeExperimentGalleryManifest() contract assumes legacy
// controlled-experiment artifact names (experiment-report.html/json,
// experiment-summary.json, experiment-runs.json). Warm-index campaign output
// owns a different, already-frozen artifact set (report.json/txt/html,
// warm-index-execution.json, plots/), so this is a separate, narrow writer
// rather than a generalization of the existing gallery contract. It reuses
// the shared GalleryManifest/GalleryManifestItem types and the existing
// gallery index HTML renderer unchanged.
// ---------------------------------------------------------------------------

const EXPECTED_WARM_INDEX_CHART_IDS = [
  "warm-index-amortized-index-cost",
  "warm-index-context-size",
  "warm-index-correctness",
  "warm-index-cumulative-token-usage",
] as const;

export async function writeWarmIndexCampaignGallery(options: {
  outDir: string;
  campaignOutputRoot: string;
  reportPaths: {
    jsonPath: string;
    htmlPath: string;
    textPath: string;
  };
  executionArtifactPath: string;
  plotArtifacts: PlotArtifacts;
  screenshot: ScreenshotCaptureResult;
  campaignPreset: string;
  agentId: "codex" | "claude";
  generatedAt?: string;
}): Promise<{
  manifest: GalleryManifest;
  manifestPath: string;
  indexPath: string;
}> {
  const outDir = path.resolve(options.outDir);
  await mkdir(outDir, { recursive: true });

  const requiredArtifacts: Array<[string, string]> = [
    ["report.json", options.reportPaths.jsonPath],
    ["report.html", options.reportPaths.htmlPath],
    ["report.txt", options.reportPaths.textPath],
    ["warm-index-execution.json", options.executionArtifactPath],
    ["plots-summary.json", options.plotArtifacts.artifactPaths.summaryPath],
    ["plot-data.json", options.plotArtifacts.artifactPaths.dataPath],
  ];
  const chartPathsById: Record<string, string> = {};
  for (const chartId of EXPECTED_WARM_INDEX_CHART_IDS) {
    const chartPath = options.plotArtifacts.artifactPaths.charts[chartId];
    if (!chartPath) {
      throw new Error(`Warm-index campaign gallery is missing the required chart artifact: ${chartId}.`);
    }
    chartPathsById[chartId] = chartPath;
    requiredArtifacts.push([`chart ${chartId}`, chartPath]);
  }
  for (const [label, artifactPath] of requiredArtifacts) {
    if (!existsSync(artifactPath)) {
      throw new Error(`Required warm-index campaign gallery artifact does not exist: ${label} (${artifactPath}).`);
    }
  }
  if (options.screenshot.status === "captured" && !existsSync(options.screenshot.pngPath)) {
    throw new Error(`Screenshot was reported captured but the PNG does not exist: ${options.screenshot.pngPath}.`);
  }

  const screenshotWarnings: string[] = [];
  if (options.screenshot.status === "skipped" && options.screenshot.warning) {
    screenshotWarnings.push(options.screenshot.warning);
  } else if (options.screenshot.status === "failed") {
    screenshotWarnings.push(`Report screenshot capture failed: ${options.screenshot.error ?? "unknown error"}.`);
  }

  const toRelative = (targetPath: string) => path.relative(outDir, targetPath).replace(/\\/g, "/");

  const reportItem: GalleryManifestItem = {
    id: "warm-index-campaign-report",
    title: "Warm-index campaign report",
    description: "Warm-index real-agent campaign report, separating infrastructure status from agent/provider outcome status.",
    kind: "warm-index-campaign-report",
    status: options.screenshot.status === "captured" ? "pass" : "warning",
    htmlPath: toRelative(options.reportPaths.htmlPath),
    summaryPath: toRelative(options.reportPaths.jsonPath),
    artifactPaths: [toRelative(options.reportPaths.textPath)],
    screenshotPath: options.screenshot.status === "captured" ? toRelative(options.screenshot.pngPath) : undefined,
    tags: ["warm-index", "campaign", "report", options.agentId],
    metrics: [],
    warnings: screenshotWarnings,
  };

  // Skipped metric points are experimental evidence carried in plot-data.json/skippedPoints, not a
  // gallery-generation failure; this item stays "pass" whenever all four required charts exist.
  const plotsItem: GalleryManifestItem = {
    id: "warm-index-campaign-plots",
    title: "Warm-index campaign plots",
    description: "Amortized index build cost, context size, correctness, and cumulative token usage, compared by strategy.",
    kind: "warm-index-campaign-plots",
    status: "pass",
    htmlPath: "",
    summaryPath: toRelative(options.plotArtifacts.artifactPaths.summaryPath),
    runsPath: toRelative(options.plotArtifacts.artifactPaths.dataPath),
    artifactPaths: EXPECTED_WARM_INDEX_CHART_IDS.map((chartId) => toRelative(chartPathsById[chartId])),
    tags: ["warm-index", "campaign", "plots", options.agentId],
    metrics: [{ id: "chart-count", label: "Chart count", value: 4 }],
    warnings: [...options.plotArtifacts.summary.warnings],
  };

  const executionItem: GalleryManifestItem = {
    id: "warm-index-execution",
    title: "Warm-index execution evidence",
    description: "Bounded per-project index setup and per-task raw/warm execution summaries, without context text.",
    kind: "warm-index-execution",
    status: "pass",
    htmlPath: "",
    summaryPath: toRelative(options.executionArtifactPath),
    tags: ["warm-index", "execution"],
    metrics: [],
    warnings: [],
  };

  const warnings = [...screenshotWarnings, ...options.plotArtifacts.summary.warnings];
  const manifest: GalleryManifest = {
    generatedAt: options.generatedAt ?? new Date().toISOString(),
    projectName: "my-dev-kit-lab",
    title: "my-dev-kit-lab warm-index campaign gallery",
    description: "Warm-index campaign report, four comparison plots, bounded execution evidence, and optional report screenshot.",
    outputDirectory: ".",
    items: [reportItem, plotsItem, executionItem],
    warnings,
  };

  const manifestPath = path.join(outDir, "gallery-manifest.json");
  const indexPath = path.join(outDir, "gallery-index.html");
  await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
  await writeFile(indexPath, renderGalleryIndex(manifest), "utf8");
  return { manifest, manifestPath, indexPath };
}
