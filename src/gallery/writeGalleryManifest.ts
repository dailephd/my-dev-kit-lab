import { existsSync } from "node:fs";
import { mkdir, readdir, writeFile } from "node:fs/promises";
import path from "node:path";
import type { ScreenshotCaptureResult } from "../screenshot/types.js";
import type { TokenSavingsSummary } from "../evaluation/types.js";
import type { GalleryManifest, GalleryManifestArtifactPaths, GalleryManifestItemStatus } from "./types.js";

function toRelativePath(outDir: string, targetPath: string | undefined): string | undefined {
  if (!targetPath) {
    return undefined;
  }

  return path.relative(outDir, targetPath).replace(/\\/g, "/");
}

function inferItemStatus(summary: TokenSavingsSummary, screenshot: ScreenshotCaptureResult, warnings: string[]): GalleryManifestItemStatus {
  if (summary.completedCaseCount === 0) {
    return "skipped";
  }

  if (screenshot.status === "failed" || warnings.length > 0 || summary.skippedCaseCount > 0) {
    return "warning";
  }

  return "pass";
}

export async function writeGalleryManifest(options: {
  outDir: string;
  summary: TokenSavingsSummary;
  artifactPaths: GalleryManifestArtifactPaths;
  screenshot: ScreenshotCaptureResult;
  warnings: string[];
  generatedAt?: string;
}): Promise<{ manifest: GalleryManifest; manifestPath: string }> {
  const outDir = path.resolve(options.outDir);
  const manifestPath = path.join(outDir, "gallery-manifest.json");
  const requiredArtifactEntries = [
    ["summaryPath", options.artifactPaths.summaryPath],
    ["runsPath", options.artifactPaths.runsPath],
    ["htmlPath", options.artifactPaths.htmlPath]
  ] as const;

  for (const [label, artifactPath] of requiredArtifactEntries) {
    if (!artifactPath) {
      throw new Error(`Missing required artifact path: ${label}`);
    }
    if (!existsSync(artifactPath)) {
      throw new Error(`Required artifact does not exist: ${artifactPath}`);
    }
  }

  const warnings = [...options.warnings];
  if (options.screenshot.warning) {
    warnings.push(options.screenshot.warning);
  }
  if (options.screenshot.status === "failed" && options.screenshot.error) {
    warnings.push(`PNG screenshot capture failed: ${options.screenshot.error}`);
  }

  const itemStatus = inferItemStatus(options.summary, options.screenshot, warnings);
  const manifest: GalleryManifest = {
    generatedAt: options.generatedAt ?? new Date().toISOString(),
    projectName: "my-dev-kit-lab",
    title: "my-dev-kit-lab demo gallery",
    description: "Deterministic Milestone 1 MVP artifacts combining benchmark validation, token-savings evaluation, reports, and optional screenshots.",
    outputDirectory: ".",
    items: [
      {
        id: "token-savings-demo",
        title: "Token savings demo",
        description: "Static context comparison between raw full-file reading and external my-dev-kit retrieval.",
        kind: "token-savings-report",
        status: itemStatus,
        htmlPath: toRelativePath(outDir, options.artifactPaths.htmlPath) ?? "token-savings-report.html",
        screenshotPath:
          options.screenshot.status === "captured" && existsSync(options.artifactPaths.pngPath)
            ? toRelativePath(outDir, options.artifactPaths.pngPath)
            : undefined,
        summaryPath: toRelativePath(outDir, options.artifactPaths.summaryPath),
        runsPath: toRelativePath(outDir, options.artifactPaths.runsPath),
        metrics: [
          { id: "case-count", label: "Case count", value: options.summary.caseCount },
          { id: "completed-case-count", label: "Completed case count", value: options.summary.completedCaseCount },
          { id: "skipped-case-count", label: "Skipped case count", value: options.summary.skippedCaseCount },
          { id: "average-raw-tokens", label: "Average raw tokens", value: options.summary.averageRawTokens.toFixed(2) },
          { id: "average-my-dev-kit-tokens", label: "Average my-dev-kit tokens", value: options.summary.averageMyDevKitTokens.toFixed(2) },
          { id: "average-tokens-saved", label: "Average tokens saved", value: options.summary.averageTokensSaved.toFixed(2) },
          { id: "average-percent-saved", label: "Average percent saved", value: options.summary.averagePercentSaved.toFixed(2), unit: "%" },
          { id: "token-count-method", label: "Token count method", value: options.summary.tokenCountMethod }
        ],
        warnings
      }
    ],
    warnings
  };

  await mkdir(outDir, { recursive: true });
  await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
  return { manifest, manifestPath };
}

export async function writeExperimentGalleryManifest(options: {
  outDir: string;
  reportDir?: string;
  plotsDir?: string;
  visualizationsDir?: string;
  experimentDir?: string;
  title?: string;
  description?: string;
  warnings?: string[];
  generatedAt?: string;
}): Promise<{ manifest: GalleryManifest; manifestPath: string; indexPath: string }> {
  const outDir = path.resolve(options.outDir);
  await mkdir(outDir, { recursive: true });
  const warnings = [...(options.warnings ?? [])];
  const items: GalleryManifest["items"] = [];

  if (options.experimentDir) {
    items.push({
      id: "controlled-experiment",
      title: "Controlled experiment artifacts",
      description: "Raw controlled experiment JSON artifacts and per-run records.",
      kind: "controlled-experiment",
      status: existsSync(path.join(options.experimentDir, "experiment-summary.json")) ? "pass" : "warning",
      htmlPath: "",
      summaryPath: toRelativePath(outDir, path.join(options.experimentDir, "experiment-summary.json")),
      runsPath: toRelativePath(outDir, path.join(options.experimentDir, "experiment-runs.json")),
      artifactPaths: [path.join(options.experimentDir, "experiment-comparisons.json"), path.join(options.experimentDir, "experiment-config.json")]
        .filter(existsSync)
        .map((artifactPath) => toRelativePath(outDir, artifactPath) ?? artifactPath),
      tags: ["experiment"],
      metrics: [],
      warnings: []
    });
  }

  if (options.reportDir) {
    const pngPath = path.join(options.reportDir, "experiment-report.png");
    items.push({
      id: "experiment-report",
      title: "Experiment report",
      description: "Final controlled experiment HTML report.",
      kind: "experiment-report",
      status: existsSync(path.join(options.reportDir, "experiment-report.html")) ? "pass" : "warning",
      htmlPath: toRelativePath(outDir, path.join(options.reportDir, "experiment-report.html")) ?? "experiment-report.html",
      screenshotPath: existsSync(pngPath) ? toRelativePath(outDir, pngPath) : undefined,
      summaryPath: toRelativePath(outDir, path.join(options.reportDir, "experiment-report.json")),
      artifactPaths: [path.join(options.reportDir, "experiment-report-artifacts.json")]
        .filter(existsSync)
        .map((artifactPath) => toRelativePath(outDir, artifactPath) ?? artifactPath),
      tags: ["report"],
      metrics: [],
      warnings: []
    });
  }

  if (options.plotsDir) {
    const chartPaths = await listSvgCharts(path.join(options.plotsDir, "charts"));
    items.push({
      id: "experiment-plots",
      title: "Experiment plots",
      description: "Static SVG charts and plot-ready data from controlled experiment comparisons.",
      kind: "experiment-plots",
      status: chartPaths.length > 0 ? "pass" : "warning",
      htmlPath: "",
      summaryPath: toRelativePath(outDir, path.join(options.plotsDir, "plots-summary.json")),
      runsPath: toRelativePath(outDir, path.join(options.plotsDir, "plot-data.json")),
      artifactPaths: chartPaths.map((artifactPath) => toRelativePath(outDir, artifactPath) ?? artifactPath),
      tags: ["plots", "charts"],
      metrics: [{ id: "chart-count", label: "Chart count", value: chartPaths.length }],
      warnings: chartPaths.length === 0 ? ["No chart SVG files found."] : []
    });
  }

  if (options.visualizationsDir) {
    const artifacts = await listFiles(path.join(options.visualizationsDir, "artifacts"));
    items.push({
      id: "visualization-demo",
      title: "my-dev-kit visualization demos",
      description: "Bounded my-dev-kit visualization command smoke artifacts.",
      kind: "visualization-demo",
      status: existsSync(path.join(options.visualizationsDir, "visualization-demo-summary.json")) ? "pass" : "warning",
      htmlPath: "",
      summaryPath: toRelativePath(outDir, path.join(options.visualizationsDir, "visualization-demo-summary.json")),
      runsPath: toRelativePath(outDir, path.join(options.visualizationsDir, "visualization-demo-runs.json")),
      artifactPaths: artifacts.map((artifactPath) => toRelativePath(outDir, artifactPath) ?? artifactPath),
      tags: ["visualization"],
      metrics: [{ id: "artifact-count", label: "Artifact count", value: artifacts.length }],
      warnings: []
    });
  }

  items.push({
    id: "final-demo",
    title: "Final demo artifact index",
    description: "Combined artifact set for the final my-dev-kit-lab batch demo.",
    kind: "final-demo",
    status: warnings.length > 0 ? "warning" : "pass",
    htmlPath: "gallery-index.html",
    tags: ["final-demo"],
    metrics: [{ id: "item-count", label: "Gallery item count", value: items.length }],
    warnings
  });

  const manifest: GalleryManifest = {
    generatedAt: options.generatedAt ?? new Date().toISOString(),
    projectName: "my-dev-kit-lab",
    title: options.title ?? "my-dev-kit-lab final demo gallery",
    description: options.description ?? "Controlled experiment report, plots, visualization demos, and final artifact index.",
    outputDirectory: ".",
    items,
    warnings
  };
  const manifestPath = path.join(outDir, "gallery-manifest.json");
  const indexPath = path.join(outDir, "gallery-index.html");
  await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
  await writeFile(indexPath, renderGalleryIndex(manifest), "utf8");
  return { manifest, manifestPath, indexPath };
}

async function listSvgCharts(chartsDir: string): Promise<string[]> {
  return (await listFiles(chartsDir)).filter((filePath) => filePath.endsWith(".svg"));
}

async function listFiles(dir: string): Promise<string[]> {
  try {
    const entries = await readdir(dir, { withFileTypes: true });
    const nested = await Promise.all(
      entries.map((entry) => {
        const entryPath = path.join(dir, entry.name);
        return entry.isDirectory() ? listFiles(entryPath) : Promise.resolve([entryPath]);
      })
    );
    return nested.flat().sort();
  } catch {
    return [];
  }
}

function renderGalleryIndex(manifest: GalleryManifest): string {
  return `<!DOCTYPE html>
<html lang="en">
<head><meta charset="utf-8" /><title>${escapeHtml(manifest.title)}</title><style>body{font-family:Arial,Helvetica,sans-serif;margin:32px;color:#17212b}section{border:1px solid #d9e1ea;border-radius:8px;padding:16px;margin:12px 0}code{background:#f2f4f7;padding:2px 4px}</style></head>
<body><h1>${escapeHtml(manifest.title)}</h1><p>${escapeHtml(manifest.description)}</p>${manifest.items
    .map(
      (item) =>
        `<section><h2>${escapeHtml(item.title)}</h2><p>${escapeHtml(item.description)}</p><p>Status: <strong>${escapeHtml(item.status)}</strong></p><p>Kind: ${escapeHtml(item.kind)}</p>${item.htmlPath ? `<p>HTML: <code>${escapeHtml(item.htmlPath)}</code></p>` : ""}${item.summaryPath ? `<p>Summary: <code>${escapeHtml(item.summaryPath)}</code></p>` : ""}${item.screenshotPath ? `<p>Screenshot: <code>${escapeHtml(item.screenshotPath)}</code></p>` : ""}${item.artifactPaths?.length ? `<ul>${item.artifactPaths.map((artifact) => `<li><code>${escapeHtml(artifact)}</code></li>`).join("")}</ul>` : ""}</section>`
    )
    .join("")}</body></html>`;
}

function escapeHtml(value: string | number | undefined): string {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}
