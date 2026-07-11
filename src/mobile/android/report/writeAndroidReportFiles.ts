import fs from "node:fs";
import path from "node:path";
import { renderAndroidTextReport } from "./renderAndroidReport.js";
import { serializeAndroidReportModel, type AndroidReportModel } from "./model.js";

// ---------------------------------------------------------------------------
// v0.4.0 Batch 5 — Android report file writer, mirroring the existing
// src/securityValidation/report/writeSecurityReportFiles.ts convention
// exactly (same reportDir creation, same `${prefix}-...-security-validation`
// naming pattern) so Android reports live under the same
// reports/security/<target-identity>/ root rather than a parallel
// reports/android product (agents.txt Batch 5 section 15.1, 16.1).
// ---------------------------------------------------------------------------

export type WriteAndroidReportFilesOptions = {
  outDir: string;
  prefix: string;
  report: AndroidReportModel;
  formats: readonly string[];
};

export type WriteAndroidReportFilesResult = {
  textPath: string | null;
  jsonPath: string | null;
  writtenPaths: string[];
};

export function writeAndroidReportFiles(options: WriteAndroidReportFilesOptions): WriteAndroidReportFilesResult {
  const reportDir = options.outDir;
  if (!fs.existsSync(reportDir)) {
    fs.mkdirSync(reportDir, { recursive: true });
  }

  const basename = `${options.prefix}-android-security-validation`;
  const textPath = options.formats.includes("text") ? path.join(reportDir, `${basename}.txt`) : null;
  const jsonPath = options.formats.includes("json") ? path.join(reportDir, `${basename}.json`) : null;

  const writtenPaths: string[] = [];
  if (textPath) {
    fs.writeFileSync(textPath, renderAndroidTextReport(options.report), "utf8");
    writtenPaths.push(textPath);
  }
  if (jsonPath) {
    fs.writeFileSync(jsonPath, serializeAndroidReportModel(options.report), "utf8");
    writtenPaths.push(jsonPath);
  }

  return { textPath, jsonPath, writtenPaths };
}
