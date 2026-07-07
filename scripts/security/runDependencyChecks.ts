#!/usr/bin/env node
import path from "node:path";
import { runDependencyChecks } from "../../src/securityValidation/index.js";
import { DEFAULT_SECURITY_CONFIG } from "../../src/securityValidation/index.js";
import { resolveValidationTarget } from "../../src/securityValidation/validate/resolveTarget.js";
import { resolveToolRoot } from "./resolveToolRoot.js";

const rawArgs = process.argv.slice(2);
const args = parseArgs(rawArgs);

const toolRoot = resolveToolRoot(import.meta.url);

let targetRoot: string;
try {
  const target = resolveValidationTarget(args.target, toolRoot);
  targetRoot = target.targetRoot;
  if (!target.isSelf) {
    console.log(`Target: ${targetRoot}`);
  }
} catch (err) {
  console.error(`ERROR: ${err instanceof Error ? err.message : String(err)}`);
  process.exitCode = 1;
  process.exit(1);
}

const config = {
  ...DEFAULT_SECURITY_CONFIG,
  reportDir: path.join(toolRoot, DEFAULT_SECURITY_CONFIG.reportDir),
  rawOutputDir: path.join(toolRoot, DEFAULT_SECURITY_CONFIG.rawOutputDir),
};

console.log("Running dependency checks...");
console.log(`Report directory: ${config.reportDir}`);

const output = await runDependencyChecks({ cwd: targetRoot, config });

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

const hasBlocker = output.findings.some((f) => f.severity === "blocker");
process.exitCode = hasBlocker ? 1 : 0;

function parseArgs(argv: string[]): { target?: string } {
  const result: { target?: string } = {};
  for (let i = 0; i < argv.length; i++) {
    if ((argv[i] === "--target" || argv[i] === "-t") && i + 1 < argv.length) {
      result.target = argv[++i];
    }
  }
  return result;
}
