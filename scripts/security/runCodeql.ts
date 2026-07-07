#!/usr/bin/env node
import { runCodeqlCheck } from "../../src/securityValidation/staticScans/codeql.js";
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

console.log("Running CodeQL static analysis check...");

const result = await runCodeqlCheck({
  cwd: toolRoot,
  targetRoot,
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

function parseArgs(argv: string[]): { target?: string } {
  const result: { target?: string } = {};
  for (let i = 0; i < argv.length; i++) {
    if ((argv[i] === "--target" || argv[i] === "-t") && i + 1 < argv.length) {
      result.target = argv[++i];
    }
  }
  return result;
}
