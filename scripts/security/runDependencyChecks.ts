#!/usr/bin/env node
import path from "node:path";
import { runDependencyChecks } from "../../src/securityValidation/index.js";
import { DEFAULT_SECURITY_CONFIG } from "../../src/securityValidation/index.js";

const cwd = process.cwd();
const config = {
  ...DEFAULT_SECURITY_CONFIG,
  reportDir: path.join(cwd, DEFAULT_SECURITY_CONFIG.reportDir),
  rawOutputDir: path.join(cwd, DEFAULT_SECURITY_CONFIG.rawOutputDir),
};

console.log("Running dependency checks...");
console.log(`Report directory: ${config.reportDir}`);

const output = await runDependencyChecks({ cwd, config });

const passed = output.checks.filter((c) => c.status === "passed").length;
const failed = output.checks.filter((c) => c.status === "failed").length;
const warned = output.checks.filter((c) => c.status === "warning").length;
const skipped = output.checks.filter((c) => c.status === "skipped").length;

console.log(`\nDependency checks complete:`);
console.log(`  Passed:  ${passed}`);
console.log(`  Warned:  ${warned}`);
console.log(`  Failed:  ${failed}`);
console.log(`  Skipped: ${skipped}`);
console.log(`  Findings: ${output.findings.length}`);

if (output.findings.length > 0) {
  console.log("\nFindings:");
  for (const f of output.findings) {
    console.log(`  [${f.severity.toUpperCase()}] ${f.title}`);
  }
}

console.log(`\nResults written to ${config.reportDir}`);

// Exit non-zero only on blocker findings
const hasBlocker = output.findings.some((f) => f.severity === "blocker");
process.exitCode = hasBlocker ? 1 : 0;
