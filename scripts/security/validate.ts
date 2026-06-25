#!/usr/bin/env node
import path from "node:path";
import fs from "node:fs";
import { runSecurityValidation } from "../../src/securityValidation/validate/runSecurityValidation.js";
import { resolveValidationTarget, reportFilenamePrefix } from "../../src/securityValidation/validate/resolveTarget.js";
import { renderTextReport, renderJsonReport } from "../../src/securityValidation/report/renderSecurityReport.js";
import type { SecurityReport } from "../../src/securityValidation/report/securityReportTypes.js";
import { resolveToolRoot } from "./resolveToolRoot.js";

// Parse CLI arguments from process.argv (after the node/tsx and script path).
const rawArgs = process.argv.slice(2);
const args = parseArgs(rawArgs);

const toolRoot = resolveToolRoot(import.meta.url);

// Resolve and validate target early so we can fail fast with a clean error.
let target: ReturnType<typeof resolveValidationTarget>;
try {
  target = resolveValidationTarget(args.target, toolRoot);
} catch (err) {
  const msg = err instanceof Error ? err.message : String(err);
  console.error(`\nERROR: ${msg}`);
  console.error("Usage: npm run security:validate -- [--target <path>] [--out <dir>] [--report-prefix <name>]");
  process.exitCode = 1;
  process.exit(1);
}

console.log("=".repeat(60));
console.log("my-dev-kit-lab security:validate");
console.log("=".repeat(60));
console.log(`Tool root  : ${toolRoot}`);
if (!target.isSelf) {
  console.log(`Target     : ${target.targetRoot}`);
  if (target.packageName) console.log(`Package    : ${target.packageName}${target.packageVersion ? `@${target.packageVersion}` : ""}`);
} else {
  console.log(`Mode       : self-validation`);
}
console.log("");

const summary = await runSecurityValidation({
  cwd: toolRoot,
  targetPath: args.target,
  fuzzIterations: parseInt(process.env["FUZZ_ITERATIONS"] ?? "50", 10),
  fuzzSeed: parseInt(process.env["FUZZ_SEED"] ?? "0xDEADBEEF", 16),
});

// Build report object
const report: SecurityReport = {
  metadata: {
    toolRoot: summary.toolRoot,
    toolPackageName: summary.toolPackageName,
    toolPackageVersion: summary.toolPackageVersion,
    targetRoot: summary.targetRoot,
    targetDescription: summary.targetDescription,
    packageName: summary.packageName,
    packageVersion: summary.packageVersion,
    branch: summary.auditedBranch,
    commit: summary.auditedCommit,
    isSelf: summary.isSelf,
    generatedAt: summary.finishedAt,
    totalDurationMs:
      new Date(summary.finishedAt).getTime() - new Date(summary.startedAt).getTime(),
  },
  sections: [],
  allChecks: summary.checks,
  allFindings: summary.findings,
  verdict: summary.verdict,
  recommendedNextStep: summary.recommendedNextStep,
};

const textReport = renderTextReport(report);
const jsonReport = renderJsonReport(report);

// Determine output directory
const reportsDir = args.out
  ? path.resolve(args.out)
  : path.join(toolRoot, "reports", "security");
if (!fs.existsSync(reportsDir)) {
  fs.mkdirSync(reportsDir, { recursive: true });
}

// Determine report filename prefix
const prefix = args.reportPrefix ?? reportFilenamePrefix(target);
const txtPath = path.join(reportsDir, `${prefix}-security-validation.txt`);
const jsonPath = path.join(reportsDir, `${prefix}-security-validation.json`);

fs.writeFileSync(txtPath, textReport, "utf8");
fs.writeFileSync(jsonPath, jsonReport, "utf8");

// Print report to stdout
console.log(textReport);

console.log(`\nReports written:`);
console.log(`  ${txtPath}`);
console.log(`  ${jsonPath}`);

// Exit code based on verdict
const blockerExists = summary.verdict === "not-ready-security-blocker-remains";
const inconclusive = summary.verdict === "inconclusive-audit-environment-incomplete";

if (blockerExists) {
  console.error("\nExit 1 — security blocker remains.");
  process.exitCode = 1;
} else if (inconclusive) {
  console.warn("\nExit 2 — audit environment incomplete.");
  process.exitCode = 2;
} else {
  console.log("\nExit 0 — validation completed.");
  process.exitCode = 0;
}

// ---------------------------------------------------------------------------
// Argument parser
// ---------------------------------------------------------------------------

function parseArgs(argv: string[]): {
  target?: string;
  out?: string;
  reportPrefix?: string;
} {
  const result: { target?: string; out?: string; reportPrefix?: string } = {};
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if ((arg === "--target" || arg === "-t") && i + 1 < argv.length) {
      result.target = argv[++i];
    } else if (arg === "--out" && i + 1 < argv.length) {
      result.out = argv[++i];
    } else if (arg === "--report-prefix" && i + 1 < argv.length) {
      result.reportPrefix = argv[++i];
    }
  }
  return result;
}
