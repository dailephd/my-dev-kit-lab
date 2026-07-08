import fs from "node:fs";
import path from "node:path";
import type { AuditConfig } from "../core/auditConfig.js";
import { AUDIT_JSON_REPORT_FILENAME, AUDIT_TEXT_REPORT_FILENAME } from "./auditReportPaths.js";
import type { AuditReportModel } from "./auditReportModel.js";
import { renderAuditJsonReport } from "./renderAuditJsonReport.js";
import { renderAuditTextReport } from "./renderAuditTextReport.js";

// ---------------------------------------------------------------------------
// v0.3.0 Batch 5 — report writing (the only I/O in src/audits/report/).
//
// Writes under the resolved outDir only. Never writes into the audit
// TARGET root, never deletes/wipes a directory (no fs.rmSync anywhere in
// this file), and only ever calls fs.writeFileSync on the two specific
// report file paths + fs.mkdirSync on outDir itself -- matching the
// project's "generated artifact refresh does not delete non-generated user
// files" guardrail. config.out is already resolved to an absolute path by
// normalizeAuditConfig() (see src/audits/core/auditConfig.ts's
// resolveOutDir()/defaultOutDir()) before this function is ever called --
// this function does not re-derive or trust any other path input.
// ---------------------------------------------------------------------------

export type WriteAuditReportsOptions = {
  model: AuditReportModel;
  config: AuditConfig;
  outDir: string;
};

export type WriteAuditReportsResult = {
  writtenPaths: string[];
};

export function writeAuditReports(options: WriteAuditReportsOptions): WriteAuditReportsResult {
  const { model, config, outDir } = options;
  const resolvedOutDir = path.resolve(outDir);
  const writtenPaths: string[] = [];

  if (config.formats.length === 0) {
    return { writtenPaths };
  }

  if (!fs.existsSync(resolvedOutDir)) {
    fs.mkdirSync(resolvedOutDir, { recursive: true });
  }

  if (config.formats.includes("json")) {
    const jsonPath = path.join(resolvedOutDir, AUDIT_JSON_REPORT_FILENAME);
    fs.writeFileSync(jsonPath, renderAuditJsonReport(model), "utf8");
    writtenPaths.push(jsonPath);
  }

  if (config.formats.includes("text")) {
    const textPath = path.join(resolvedOutDir, AUDIT_TEXT_REPORT_FILENAME);
    fs.writeFileSync(textPath, renderAuditTextReport(model), "utf8");
    writtenPaths.push(textPath);
  }

  return { writtenPaths };
}
