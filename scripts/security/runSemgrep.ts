#!/usr/bin/env node
import path from "node:path";
import { runSemgrepCheck } from "../../src/securityValidation/staticScans/semgrep.js";

const cwd = process.cwd();

console.log("Running Semgrep static analysis check...");
console.log(`Config: ${path.join(cwd, ".semgrep.yml")}`);

const result = await runSemgrepCheck({
  cwd,
  configPath: path.join(cwd, ".semgrep.yml"),
  timeoutMs: 120_000,
});

const label =
  result.status === "skipped"
    ? `SKIPPED — ${result.skippedReason ?? "tool unavailable"}`
    : result.status.toUpperCase();

console.log(`\nStatus: ${label}`);
if (result.findings.length > 0) {
  console.log("\nFindings:");
  for (const f of result.findings) {
    console.log(`  [${f.severity.toUpperCase()}] ${f.title}`);
    if (f.affectedFiles && f.affectedFiles.length > 0) {
      console.log(`    Location: ${f.affectedFiles[0]}`);
    }
    if (f.description) console.log(`    ${f.description.slice(0, 120)}`);
  }
}

console.log(`\nDuration: ${result.durationMs}ms`);

if (result.status === "skipped") {
  console.log("\nSemgrep is optional. Absence does not block release.");
  process.exitCode = 0;
} else if (result.status === "failed") {
  process.exitCode = 1;
} else {
  process.exitCode = 0;
}
