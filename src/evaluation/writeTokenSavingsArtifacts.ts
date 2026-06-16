import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { normalizeLabReport } from "../report/types.js";
import { renderHtmlReport } from "../report/renderHtmlReport.js";
import type { ScreenshotCaptureResult } from "../screenshot/types.js";
import type {
  TokenSavingsArtifacts,
  TokenSavingsCaseResult,
  TokenSavingsCommandConfig,
  TokenSavingsRunRecord,
  TokenSavingsSummary
} from "./types.js";
import { renderTokenSavingsReportInput } from "./renderTokenSavingsReportInput.js";

export async function writeTokenSavingsArtifacts(options: {
  outDir: string;
  summary: TokenSavingsSummary;
  runs: TokenSavingsRunRecord[];
  comparisonCases: TokenSavingsCaseResult[];
  commandConfig: TokenSavingsCommandConfig;
  screenshot: ScreenshotCaptureResult;
  generatedAt?: string;
}): Promise<TokenSavingsArtifacts> {
  const outDir = path.resolve(options.outDir);
  await mkdir(outDir, { recursive: true });
  const artifactPaths = {
    summaryPath: path.join(outDir, "token-savings-summary.json"),
    runsPath: path.join(outDir, "token-savings-runs.json"),
    htmlPath: path.join(outDir, "token-savings-report.html"),
    pngPath: path.join(outDir, "token-savings-report.png")
  };
  const warnings = [...options.summary.warnings];
  if (options.screenshot.warning) {
    warnings.push(options.screenshot.warning);
  }
  if (options.screenshot.status === "failed" && options.screenshot.error) {
    warnings.push(`PNG screenshot capture failed: ${options.screenshot.error}`);
  }

  const report = renderTokenSavingsReportInput({
    summary: options.summary,
    cases: options.comparisonCases,
    commandConfig: options.commandConfig,
    artifactPaths: {
      summaryPath: artifactPaths.summaryPath,
      runsPath: artifactPaths.runsPath,
      htmlPath: artifactPaths.htmlPath
    },
    warnings
  });
  const normalizedReport = normalizeLabReport(report, options.generatedAt);

  await writeFile(
    artifactPaths.summaryPath,
    JSON.stringify(
      {
        summary: options.summary,
        tokenCountMethod: options.summary.tokenCountMethod,
        generatedAt: normalizedReport.generatedAt,
        commandConfiguration: options.commandConfig,
        warnings,
        screenshot: options.screenshot,
        artifactPaths
      },
      null,
      2
    ),
    "utf8"
  );

  await writeFile(
    artifactPaths.runsPath,
    JSON.stringify(
      {
        generatedAt: normalizedReport.generatedAt,
        tokenCountMethod: options.summary.tokenCountMethod,
        runs: options.runs
      },
      null,
      2
    ),
    "utf8"
  );

  await writeFile(artifactPaths.htmlPath, renderHtmlReport(normalizedReport), "utf8");

  return {
    summary: options.summary,
    runs: options.runs,
    report: normalizedReport,
    screenshot: options.screenshot,
    artifactPaths,
    warnings
  };
}
