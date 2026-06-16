import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { renderHtmlReport } from "./renderHtmlReport.js";
import type { LabReportInput, NormalizedLabReport, ReportArtifactPaths } from "./types.js";
import { normalizeLabReport } from "./types.js";
import type { ScreenshotCaptureResult } from "../screenshot/types.js";

export type ReportArtifactWriteResult = {
  report: NormalizedLabReport;
  outputPaths: ReportArtifactPaths;
  screenshot: ScreenshotCaptureResult;
  warnings: string[];
};

type WriteReportArtifactsOptions = {
  report: LabReportInput | NormalizedLabReport;
  outDir: string;
  screenshot: ScreenshotCaptureResult;
  generatedAt?: string;
};

export function getReportArtifactPaths(outDir: string, reportId: string): ReportArtifactPaths {
  return {
    outDir,
    jsonPath: path.join(outDir, `${reportId}.json`),
    htmlPath: path.join(outDir, `${reportId}.html`),
    pngPath: path.join(outDir, `${reportId}.png`)
  };
}

export async function writeReportArtifacts(options: WriteReportArtifactsOptions): Promise<ReportArtifactWriteResult> {
  const report = normalizeLabReport(options.report, options.generatedAt);
  const outputPaths = getReportArtifactPaths(options.outDir, report.reportId);
  const warnings = [...report.warnings];

  if (options.screenshot.warning) {
    warnings.push(options.screenshot.warning);
  }
  if (options.screenshot.status === "failed" && options.screenshot.error) {
    warnings.push(`PNG screenshot capture failed: ${options.screenshot.error}`);
  }

  await mkdir(outputPaths.outDir, { recursive: true });
  await writeFile(outputPaths.htmlPath, renderHtmlReport(report), "utf8");

  const payload = {
    report,
    generatedAt: report.generatedAt,
    outputPaths,
    screenshot: options.screenshot,
    warnings
  };
  await writeFile(outputPaths.jsonPath, JSON.stringify(payload, null, 2), "utf8");

  return {
    report,
    outputPaths,
    screenshot: options.screenshot,
    warnings
  };
}
