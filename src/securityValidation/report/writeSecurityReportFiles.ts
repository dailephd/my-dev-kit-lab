import fs from "node:fs";
import path from "node:path";
import { renderJsonReport, renderTextReport } from "./renderSecurityReport.js";
import type { SecurityReport } from "./securityReportTypes.js";

export type WriteSecurityReportFilesOptions = {
  outDir: string;
  prefix: string;
  report: SecurityReport;
  formats: readonly string[];
  reportPathSuffix?: string;
};

export type WriteSecurityReportFilesResult = {
  textPath: string | null;
  jsonPath: string | null;
  writtenPaths: string[];
};

export function writeSecurityReportFiles(
  options: WriteSecurityReportFilesOptions
): WriteSecurityReportFilesResult {
  const reportDir = options.outDir;
  if (!fs.existsSync(reportDir)) {
    fs.mkdirSync(reportDir, { recursive: true });
  }

  const basename = options.reportPathSuffix
    ? `${options.prefix}-${options.reportPathSuffix}-security-validation`
    : `${options.prefix}-security-validation`;

  const textPath = options.formats.includes("text")
    ? path.join(reportDir, `${basename}.txt`)
    : null;
  const jsonPath = options.formats.includes("json")
    ? path.join(reportDir, `${basename}.json`)
    : null;

  const writtenPaths: string[] = [];
  if (textPath) {
    fs.writeFileSync(textPath, renderTextReport(options.report), "utf8");
    writtenPaths.push(textPath);
  }
  if (jsonPath) {
    fs.writeFileSync(jsonPath, renderJsonReport(options.report), "utf8");
    writtenPaths.push(jsonPath);
  }

  return { textPath, jsonPath, writtenPaths };
}
