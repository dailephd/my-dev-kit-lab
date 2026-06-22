#!/usr/bin/env node
import path from "node:path";
import { runSemgrepCheck } from "../../src/securityValidation/staticScans/semgrep.js";
import { resolveValidationTarget } from "../../src/securityValidation/validate/resolveTarget.js";

const rawArgs = process.argv.slice(2);
const args = parseArgs(rawArgs);

const toolRoot = process.cwd();

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

console.log("Running Semgrep static analysis check...");
console.log(`Config: ${path.join(toolRoot, ".semgrep.yml")}`);

const result = await runSemgrepCheck({
  targetRoot,
  toolRoot,
  configPath: path.join(toolRoot, ".semgrep.yml"),
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

function parseArgs(argv: string[]): { target?: string } {
  const result: { target?: string } = {};
  for (let i = 0; i < argv.length; i++) {
    if ((argv[i] === "--target" || argv[i] === "-t") && i + 1 < argv.length) {
      result.target = argv[++i];
    }
  }
  return result;
}
