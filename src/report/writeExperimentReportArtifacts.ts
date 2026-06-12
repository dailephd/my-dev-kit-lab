import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { resolveWithinRoot } from "../core/pathSafety.js";
import type { ScreenshotCaptureResult } from "../screenshot/types.js";
import { renderExperimentHtmlReport } from "./renderExperimentHtmlReport.js";
import type { ExperimentReportArtifactPaths, ExperimentReportInput, ExperimentReportWriteResult } from "./experimentReportTypes.js";

export function getExperimentReportArtifactPaths(outDir: string): ExperimentReportArtifactPaths {
  const resolvedOutDir = path.resolve(outDir);
  return {
    outDir: resolvedOutDir,
    jsonPath: resolveWithinRoot(resolvedOutDir, "experiment-report.json"),
    htmlPath: resolveWithinRoot(resolvedOutDir, "experiment-report.html"),
    pngPath: resolveWithinRoot(resolvedOutDir, "experiment-report.png"),
    artifactIndexPath: resolveWithinRoot(resolvedOutDir, "experiment-report-artifacts.json")
  };
}

export async function writeExperimentReportArtifacts(args: {
  outDir: string;
  report: ExperimentReportInput;
  screenshot: ScreenshotCaptureResult;
}): Promise<ExperimentReportWriteResult> {
  const outputPaths = getExperimentReportArtifactPaths(args.outDir);
  await mkdir(outputPaths.outDir, { recursive: true });
  const warnings = [...args.report.warnings];
  if (args.screenshot.warning) {
    warnings.push(args.screenshot.warning);
  }
  if (args.screenshot.status === "failed" && args.screenshot.error) {
    warnings.push(`PNG screenshot capture failed: ${args.screenshot.error}`);
  }
  const report = {
    ...args.report,
    warnings
  };

  await writeFile(outputPaths.htmlPath, renderExperimentHtmlReport(report), "utf8");
  await writeFile(
    outputPaths.jsonPath,
    `${JSON.stringify({ report, generatedAt: report.generatedAt, outputPaths, screenshot: args.screenshot, warnings }, null, 2)}\n`,
    "utf8"
  );
  await writeFile(
    outputPaths.artifactIndexPath,
    `${JSON.stringify({ generatedAt: report.generatedAt, outputPaths, sourceExperimentDir: report.sourceExperimentDir, artifactLinks: report.artifactLinks }, null, 2)}\n`,
    "utf8"
  );

  return {
    report,
    outputPaths,
    screenshot: args.screenshot,
    warnings
  };
}
