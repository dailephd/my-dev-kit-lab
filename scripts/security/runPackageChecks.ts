#!/usr/bin/env node
import path from "node:path";
import { runPackageChecks } from "../../src/securityValidation/index.js";
import { DEFAULT_SECURITY_CONFIG } from "../../src/securityValidation/index.js";

const cwd = process.cwd();
const config = {
  ...DEFAULT_SECURITY_CONFIG,
  reportDir: path.join(cwd, DEFAULT_SECURITY_CONFIG.reportDir),
  rawOutputDir: path.join(cwd, DEFAULT_SECURITY_CONFIG.rawOutputDir),
};

console.log("Running package content checks...");
console.log(`Report directory: ${config.reportDir}`);

const output = await runPackageChecks({ cwd, config });

const passed = output.checks.filter((c) => c.status === "passed").length;
const failed = output.checks.filter((c) => c.status === "failed").length;
const warned = output.checks.filter((c) => c.status === "warning").length;

console.log(`\nPackage checks complete:`);
console.log(`  Passed:  ${passed}`);
console.log(`  Warned:  ${warned}`);
console.log(`  Failed:  ${failed}`);
console.log(`  Findings: ${output.findings.length}`);

if (output.findings.length > 0) {
  console.log("\nFindings:");
  for (const f of output.findings) {
    console.log(`  [${f.severity.toUpperCase()}] ${f.title}`);
  }
}

console.log(`\nResults written to ${config.reportDir}`);

// Exit non-zero on any forbidden-content finding
const hasBlocker = output.findings.some((f) => f.severity === "blocker");
const hasMajor = output.findings.some((f) => f.severity === "major");
process.exitCode = hasBlocker || hasMajor ? 1 : 0;
