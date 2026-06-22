#!/usr/bin/env node
import path from "node:path";
import { runCodeqlCheck } from "../../src/securityValidation/staticScans/codeql.js";

const cwd = process.cwd();

console.log("Running CodeQL static analysis check...");

const result = await runCodeqlCheck({
  cwd,
  timeoutMs: 30_000,
});

const label =
  result.status === "skipped"
    ? `SKIPPED — ${result.skippedReason ?? "tool unavailable"}`
    : result.status.toUpperCase();

console.log(`Status: ${label}`);
if (result.findings.length > 0) {
  console.log("\nFindings:");
  for (const f of result.findings) {
    console.log(`  [${f.severity.toUpperCase()}] ${f.title}`);
    if (f.description) console.log(`    ${f.description.slice(0, 120)}`);
  }
}

console.log(`\nDuration: ${result.durationMs}ms`);

if (result.status === "skipped") {
  console.log("\nCodeQL is optional. Absence does not block release.");
  process.exitCode = 0;
} else if (result.status === "failed") {
  process.exitCode = 1;
} else {
  process.exitCode = 0;
}
