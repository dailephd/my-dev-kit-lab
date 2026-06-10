import { existsSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
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
