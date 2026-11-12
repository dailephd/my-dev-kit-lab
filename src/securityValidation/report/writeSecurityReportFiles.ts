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

export function assertSecurityReportPrefix(prefix: string): void {
  if (!prefix.trim() || prefix === "." || prefix === ".." || /[<>:"/\\|?*\x00-\x1f]/.test(prefix) || /[. ]$/.test(prefix)) {
    throw new Error("Security report prefix must be a filename, without path separators or aliases.");
  }
}

// Check every existing path component before mkdir/write, including Windows
// junctions. Missing suffixes are safe to create only below verified parents.
export function assertSecurityOutputPath(outputPath: string, file = false, inspectChildren = false): void {
  const absolute = path.resolve(outputPath);
  const root = path.parse(absolute).root;
  const parts = path.relative(root, absolute).split(path.sep).filter(Boolean);
  let current = root;
  for (const [index, segment] of ["", ...parts].entries()) {
    if (process.platform === "win32" && (/[. ]$/.test(segment) || segment.includes(":"))) {
      throw new Error(`Aliased security output path component: ${segment}`);
    }
    current = path.join(current, segment);
    let info: fs.Stats;
    try { info = fs.lstatSync(current); }
    catch (err) {
      if ((err as NodeJS.ErrnoException).code === "ENOENT") continue;
      throw err;
    }
    const systemVarAlias = process.platform === "darwin" && current === "/var" &&
      info.isSymbolicLink() && fs.realpathSync(current) === "/private/var";
    const leafFile = file && index === parts.length;
    if ((!systemVarAlias && info.isSymbolicLink()) ||
        (leafFile ? !info.isFile() || info.nlink > 1 : !info.isDirectory())) {
      throw new Error(`Unsafe security output path: ${current}`);
    }
  }
  if (inspectChildren && fs.existsSync(absolute)) {
    for (const entry of fs.readdirSync(absolute, { withFileTypes: true })) {
      assertSecurityOutputPath(path.join(absolute, entry.name), !entry.isDirectory(), entry.isDirectory());
    }
  }
}

export function writeSecurityReportFiles(
  options: WriteSecurityReportFilesOptions
): WriteSecurityReportFilesResult {
  const reportDir = options.outDir;
  assertSecurityReportPrefix(options.prefix);
  if (options.reportPathSuffix) assertSecurityReportPrefix(options.reportPathSuffix);
  assertSecurityOutputPath(reportDir);
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
  // Validate all requested destinations before persisting either format.
  if (textPath) assertSecurityOutputPath(textPath, true);
  if (jsonPath) assertSecurityOutputPath(jsonPath, true);
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
