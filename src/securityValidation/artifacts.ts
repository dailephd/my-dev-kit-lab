import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import type { SecurityCheckResult } from "./types.js";
import { assertSecurityOutputPath, assertSecurityReportPrefix } from "./report/writeSecurityReportFiles.js";

// Write a structured security check result to the reports/security directory.
// Raw stdout/stderr are written to reports/security/raw/ as separate text files.
export async function writeCheckResult(options: {
  result: SecurityCheckResult;
  outputPath: string;
  rawDir: string;
  rawStdout?: string;
  rawStderr?: string;
}): Promise<void> {
  assertSecurityReportPrefix(options.result.id);
  assertSecurityOutputPath(options.outputPath, true);
  assertSecurityOutputPath(options.rawDir);
  for (const stream of ["stdout", "stderr"]) {
    assertSecurityOutputPath(path.join(options.rawDir, `${options.result.id}.${stream}.txt`), true);
  }
  await mkdir(path.dirname(options.outputPath), { recursive: true });
  await mkdir(options.rawDir, { recursive: true });

  if (options.rawStdout !== undefined) {
    await writeFile(path.join(options.rawDir, `${options.result.id}.stdout.txt`), options.rawStdout, "utf8");
  }
  if (options.rawStderr !== undefined) {
    await writeFile(path.join(options.rawDir, `${options.result.id}.stderr.txt`), options.rawStderr, "utf8");
  }

  await writeFile(options.outputPath, JSON.stringify(options.result, null, 2), "utf8");
}
