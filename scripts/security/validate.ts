#!/usr/bin/env node
import path from "node:path";
import fs from "node:fs";
import { runSecurityValidation } from "../../src/securityValidation/validate/runSecurityValidation.js";
import { resolveValidationTarget, reportFilenamePrefix } from "../../src/securityValidation/validate/resolveTarget.js";
import { renderTextReport, renderJsonReport } from "../../src/securityValidation/report/renderSecurityReport.js";
import { buildSecurityReportFromSummary } from "../../src/securityValidation/report/buildSecurityReport.js";
import {
  parseSecurityValidateArgs,
  normalizeSecurityValidateConfig,
  applyProfileDefaultChecksIfApplicable,
} from "../../src/securityValidation/validate/cliOptions.js";
import { resolveAttackProfile } from "../../src/securityValidation/attackScenarios/attackProfile.js";
import { findingsBreachFailOnThreshold } from "../../src/securityValidation/validate/verdict.js";
import { resolveToolRoot } from "./resolveToolRoot.js";

const USAGE =
  "Usage: npm run security:validate -- [--target <path>] [--out <dir>] [--report-prefix <name>] " +
  "[--checks deps,package,static,cli-adversarial,fuzz,boundary,subprocess,secrets,network] " +
  "[--profile node-cli-package|local-tool|npm-package] [--format text,json] [--fail-on blocker|high|medium|low]";

// Parse CLI arguments from process.argv (after the node/tsx and script path).
const rawArgs = process.argv.slice(2);
const toolRoot = resolveToolRoot(import.meta.url);

let args: ReturnType<typeof parseSecurityValidateArgs>;
let config: ReturnType<typeof normalizeSecurityValidateConfig>;
try {
  args = parseSecurityValidateArgs(rawArgs);
  config = normalizeSecurityValidateConfig(args, toolRoot);
  // v0.2.2 Batch 5: --profile with no --checks uses that profile's declared
  // default checks. No-op unless the user passed --profile without --checks
  // (see applyProfileDefaultChecksIfApplicable's guard) — the true no-flag
  // case and any explicit --checks case are always unaffected.
  config = applyProfileDefaultChecksIfApplicable(config, resolveAttackProfile(config.profile).defaultCheckIds);
} catch (err) {
  const msg = err instanceof Error ? err.message : String(err);
  console.error(`\nERROR: ${msg}`);
  console.error(USAGE);
  process.exitCode = 1;
  process.exit(1);
}

// Resolve and validate target early so we can fail fast with a clean error.
let target: ReturnType<typeof resolveValidationTarget>;
try {
  target = resolveValidationTarget(args.target, toolRoot);
} catch (err) {
  const msg = err instanceof Error ? err.message : String(err);
  console.error(`\nERROR: ${msg}`);
  console.error(USAGE);
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
if (!config.checksWereDefault) {
  console.log(`Checks     : ${config.checks.join(", ")}`);
}
if (config.plannedChecksRequested.length > 0) {
  console.log(
    `Note       : ${config.plannedChecksRequested.join(", ")} are routed through the attack-scenario framework rather than the classic check-group runners. Review the attack-scenario section in the report for their concrete results.`
  );
}
console.log("");

const summary = await runSecurityValidation({
  cwd: toolRoot,
  targetPath: args.target,
  fuzzIterations: parseInt(process.env["FUZZ_ITERATIONS"] ?? "50", 10),
  fuzzSeed: parseInt(process.env["FUZZ_SEED"] ?? "0xDEADBEEF", 16),
  // Full selection (implemented + planned/attack-scenario ids) — the runner
  // gates both implemented check groups and attack-scenario checks off the
  // same selectedChecks set.
  selectedChecks: config.checks,
  profile: config.profile,
});

// v0.2.2 Batch 5: --fail-on breach is additive to (never a substitute for)
// the existing verdict-based exit decision below — it can only escalate
// exit 0 to exit 1 (e.g. --fail-on medium/low catching minor/informational
// findings the verdict policy doesn't already treat as blocking), never
// downgrade an existing blocker.
const failOnBreached = findingsBreachFailOnThreshold(summary.findings, config.failOnThreshold);

// Build report object
const report = buildSecurityReportFromSummary(summary, {
  profile: config.profile,
  selectedChecks: config.checks,
  failOnThreshold: config.failOnThreshold,
  formats: config.formats,
  failOnBreached,
});

const textReport = renderTextReport(report);
const jsonReport = renderJsonReport(report);

// Determine output directory
const reportsDir = config.out;
if (!fs.existsSync(reportsDir)) {
  fs.mkdirSync(reportsDir, { recursive: true });
}

// Determine report filename prefix
const prefix = args.reportPrefix ?? reportFilenamePrefix(target);
const txtPath = path.join(reportsDir, `${prefix}-security-validation.txt`);
const jsonPath = path.join(reportsDir, `${prefix}-security-validation.json`);

const writtenPaths: string[] = [];
if (config.formats.includes("text")) {
  fs.writeFileSync(txtPath, textReport, "utf8");
  writtenPaths.push(txtPath);
}
if (config.formats.includes("json")) {
  fs.writeFileSync(jsonPath, jsonReport, "utf8");
  writtenPaths.push(jsonPath);
}

// Print report to stdout
console.log(textReport);

console.log(`\nReports written:`);
for (const p of writtenPaths) {
  console.log(`  ${p}`);
}

// Exit code based on verdict, escalated (never downgraded) by --fail-on.
const blockerExists = summary.verdict === "not-ready-security-blocker-remains";
const inconclusive = summary.verdict === "inconclusive-audit-environment-incomplete";

if (blockerExists) {
  console.error("\nExit 1 — security blocker remains.");
  process.exitCode = 1;
} else if (inconclusive) {
  console.warn("\nExit 2 — audit environment incomplete.");
  process.exitCode = 2;
} else if (failOnBreached) {
  console.error(`\nExit 1 — --fail-on ${config.failOnThreshold} threshold breached.`);
  process.exitCode = 1;
} else {
  console.log("\nExit 0 — validation completed.");
  process.exitCode = 0;
}
