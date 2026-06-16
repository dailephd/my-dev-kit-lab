import { mkdtempSync, writeFileSync } from "node:fs";
import { readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { writeGalleryManifest } from "../../src/gallery/writeGalleryManifest.js";
import type { TokenSavingsSummary } from "../../src/evaluation/types.js";
import type { ScreenshotCaptureResult } from "../../src/screenshot/types.js";

const tempDirs: string[] = [];

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

function makeSummary(): TokenSavingsSummary {
  return {
    caseCount: 1,
    completedCaseCount: 1,
    skippedCaseCount: 0,
    averageRawTokens: 50,
    averageMyDevKitTokens: 20,
    averageTokensSaved: 30,
    averagePercentSaved: 60,
    totalRawTokens: 50,
    totalMyDevKitTokens: 20,
    totalTokensSaved: 30,
    totalCommandsRun: 4,
    totalDurationMs: 100,
    tokenCountMethod: "estimated_chars_div_4",
    warnings: []
  };
}

describe("writeGalleryManifest", () => {
  it("writes gallery-manifest.json with relative artifact paths and metrics", async () => {
    const outDir = mkdtempSync(path.join(os.tmpdir(), "gallery-manifest-"));
    tempDirs.push(outDir);
    const summaryPath = path.join(outDir, "token-savings-summary.json");
    const runsPath = path.join(outDir, "token-savings-runs.json");
    const htmlPath = path.join(outDir, "token-savings-report.html");
    const pngPath = path.join(outDir, "token-savings-report.png");
    writeFileSync(summaryPath, "{}");
    writeFileSync(runsPath, "{}");
    writeFileSync(htmlPath, "<html></html>");
    writeFileSync(pngPath, "png");

    const screenshot: ScreenshotCaptureResult = {
      status: "captured",
      htmlPath,
      pngPath
    };

    const { manifestPath } = await writeGalleryManifest({
      outDir,
      summary: makeSummary(),
      artifactPaths: { summaryPath, runsPath, htmlPath, pngPath },
      screenshot,
      warnings: ["demo warning"],
      generatedAt: "2026-01-01T00:00:00.000Z"
    });

    const manifest = JSON.parse(await readFile(manifestPath, "utf8")) as {
      projectName: string;
      generatedAt: string;
      items: Array<{ id: string; htmlPath: string; screenshotPath?: string; metrics: Array<{ id: string }>; warnings: string[] }>;
    };
    expect(manifest.projectName).toBe("my-dev-kit-lab");
    expect(manifest.generatedAt).toBe("2026-01-01T00:00:00.000Z");
    expect(manifest.items[0]?.id).toBe("token-savings-demo");
    expect(manifest.items[0]?.htmlPath).toBe("token-savings-report.html");
    expect(manifest.items[0]?.screenshotPath).toBe("token-savings-report.png");
    expect(manifest.items[0]?.metrics.some((metric) => metric.id === "token-count-method")).toBe(true);
    expect(manifest.items[0]?.warnings).toContain("demo warning");
  });

  it("handles missing screenshot path", async () => {
    const outDir = mkdtempSync(path.join(os.tmpdir(), "gallery-manifest-"));
    tempDirs.push(outDir);
    const summaryPath = path.join(outDir, "token-savings-summary.json");
    const runsPath = path.join(outDir, "token-savings-runs.json");
    const htmlPath = path.join(outDir, "token-savings-report.html");
    writeFileSync(summaryPath, "{}");
    writeFileSync(runsPath, "{}");
    writeFileSync(htmlPath, "<html></html>");

    const { manifest } = await writeGalleryManifest({
      outDir,
      summary: makeSummary(),
      artifactPaths: { summaryPath, runsPath, htmlPath, pngPath: path.join(outDir, "missing.png") },
      screenshot: { status: "skipped", htmlPath, pngPath: path.join(outDir, "missing.png"), warning: "PNG screenshot skipped because Playwright or browser runtime is unavailable." },
      warnings: []
    });

    expect(manifest.items[0]?.screenshotPath).toBeUndefined();
    expect(manifest.items[0]?.warnings.some((warning) => warning.includes("PNG screenshot skipped"))).toBe(true);
  });

  it("fails clearly if required artifact information is missing", async () => {
    const outDir = mkdtempSync(path.join(os.tmpdir(), "gallery-manifest-"));
    tempDirs.push(outDir);
    await expect(
      writeGalleryManifest({
        outDir,
        summary: makeSummary(),
        artifactPaths: {
          summaryPath: path.join(outDir, "missing-summary.json"),
          runsPath: path.join(outDir, "missing-runs.json"),
          htmlPath: path.join(outDir, "missing-report.html"),
          pngPath: path.join(outDir, "missing-report.png")
        },
        screenshot: { status: "skipped", htmlPath: "missing", pngPath: "missing" },
        warnings: []
      })
    ).rejects.toThrow(/Required artifact does not exist/);
  });
});
