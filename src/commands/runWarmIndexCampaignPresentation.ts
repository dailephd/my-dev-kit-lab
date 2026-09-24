import path from "node:path";
import type { GalleryManifest } from "../gallery/types.js";
import { writeWarmIndexCampaignGallery } from "../gallery/writeWarmIndexCampaignGallery.js";
import type { PluginExperimentReportPaths } from "../report/experiments/writePluginExperimentReports.js";
import { captureReportScreenshot } from "../screenshot/captureReportScreenshot.js";
import type { ScreenshotCaptureResult } from "../screenshot/types.js";
import type { PlotArtifacts } from "../plots/types.js";
import { writePlotArtifacts } from "../plots/writePlotArtifacts.js";

// ---------------------------------------------------------------------------
// v0.5.2 Batch 5 -- command-level warm-index campaign presentation owner.
//
// This is the single orchestrator for: existing report -> existing four warm-
// index plots -> best-effort report screenshot -> narrow warm-index campaign
// gallery. It reuses writePlotArtifacts, captureReportScreenshot, and
// writeWarmIndexCampaignGallery unchanged; it builds no new plot, screenshot,
// or gallery mechanism of its own. The warm-index-reuse plugin remains free of
// this orchestration -- it is invoked only by the command layer, and only for
// campaign runs.
// ---------------------------------------------------------------------------

const EXPECTED_WARM_INDEX_CHART_IDS = [
  "warm-index-amortized-index-cost",
  "warm-index-context-size",
  "warm-index-correctness",
  "warm-index-cumulative-token-usage",
] as const;

export type WarmIndexCampaignPresentationResult = {
  plots: PlotArtifacts;
  screenshot: ScreenshotCaptureResult;
  gallery: {
    manifest: GalleryManifest;
    manifestPath: string;
    indexPath: string;
  };
  warnings: string[];
};

export async function runWarmIndexCampaignPresentation(args: {
  outputRoot: string;
  reportPaths: PluginExperimentReportPaths;
  executionArtifactPath: string;
  campaignPreset: string;
  agentId: "codex" | "claude";
  captureScreenshot?: typeof captureReportScreenshot;
}): Promise<WarmIndexCampaignPresentationResult> {
  const plotsDir = path.join(args.outputRoot, "plots");
  const plots = await writePlotArtifacts({ experimentDir: args.outputRoot, outDir: plotsDir });

  const chartIds = Object.keys(plots.artifactPaths.charts);
  const hasExactlyExpectedCharts =
    chartIds.length === EXPECTED_WARM_INDEX_CHART_IDS.length &&
    EXPECTED_WARM_INDEX_CHART_IDS.every((id) => chartIds.includes(id));
  if (!hasExactlyExpectedCharts) {
    throw new Error(
      `Warm-index campaign presentation requires exactly the four warm-index plot charts (${EXPECTED_WARM_INDEX_CHART_IDS.join(", ")}); got: ${chartIds.join(", ") || "none"}.`
    );
  }

  const capture = args.captureScreenshot ?? captureReportScreenshot;
  const pngPath = path.join(args.outputRoot, "report.png");
  // Non-fatal by design: a missing Playwright/browser runtime is a normal, expected environment,
  // never a reason to fail the campaign (see captureReportScreenshot's captured/skipped/failed contract).
  const screenshot = await capture(args.reportPaths.htmlPath, pngPath);

  const gallery = await writeWarmIndexCampaignGallery({
    outDir: path.join(args.outputRoot, "gallery"),
    campaignOutputRoot: args.outputRoot,
    reportPaths: {
      jsonPath: args.reportPaths.jsonPath,
      htmlPath: args.reportPaths.htmlPath,
      textPath: args.reportPaths.textPath,
    },
    executionArtifactPath: args.executionArtifactPath,
    plotArtifacts: plots,
    screenshot,
    campaignPreset: args.campaignPreset,
    agentId: args.agentId,
  });

  const warnings: string[] = [];
  if (screenshot.status === "skipped" && screenshot.warning) {
    warnings.push(screenshot.warning);
  } else if (screenshot.status === "failed") {
    warnings.push(`Report screenshot capture failed: ${screenshot.error ?? "unknown error"}.`);
  }
  warnings.push(...plots.summary.warnings);

  return {
    plots,
    screenshot,
    gallery: { manifest: gallery.manifest, manifestPath: gallery.manifestPath, indexPath: gallery.indexPath },
    warnings,
  };
}
