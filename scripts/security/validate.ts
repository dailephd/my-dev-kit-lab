#!/usr/bin/env node
import path from "node:path";
import fs from "node:fs";
import { runSecurityValidation } from "../../src/securityValidation/validate/runSecurityValidation.js";
import { resolveValidationTarget, reportFilenamePrefix } from "../../src/securityValidation/validate/resolveTarget.js";
import { buildSecurityReportFromSummary } from "../../src/securityValidation/report/buildSecurityReport.js";
import { renderTextReport } from "../../src/securityValidation/report/renderSecurityReport.js";
import { writeSecurityReportFiles } from "../../src/securityValidation/report/writeSecurityReportFiles.js";
import {
  parseSecurityValidateArgs,
  normalizeSecurityValidateConfig,
  applyProfileDefaultChecksIfApplicable,
} from "../../src/securityValidation/validate/cliOptions.js";
import { resolveAttackProfile } from "../../src/securityValidation/attackScenarios/attackProfile.js";
import { findingsBreachFailOnThreshold } from "../../src/securityValidation/validate/verdict.js";
import { resolveToolRoot } from "./resolveToolRoot.js";
import { validateAndroidTarget } from "../../src/mobile/android/validate/validateAndroidTarget.js";
import { toAndroidReportModel } from "../../src/mobile/android/report/model.js";
import { renderAndroidTextReport } from "../../src/mobile/android/report/renderAndroidReport.js";
import { writeAndroidReportFiles } from "../../src/mobile/android/report/writeAndroidReportFiles.js";

const USAGE =
  "Usage: npm run security:validate -- [--target <path>] [--out <dir>] [--report-prefix <name>] " +
  "[--checks deps,package,static,cli-adversarial,fuzz,boundary,subprocess,secrets,network] " +
  "[--profile node-cli-package|local-tool|npm-package|android] [--format text,json] [--fail-on blocker|high|medium|low] " +
  "[--android-gradle-operations wrapper-version,tasks,assemble-debug,unit-test-debug,lint-debug]\n" +
  "\n" +
  "Android profile:\n" +
  "  --profile android performs static, read-only Android project detection, manifest parsing,\n" +
  "  permission/exported-component/intent-filter/deep-link audits, and static Gradle metadata\n" +
  "  extraction. Gradle is never executed by default.\n" +
  "  --android-gradle-operations explicitly opts into running ONLY the listed allowlisted Gradle\n" +
  "  operations (wrapper-version, tasks, assemble-debug, unit-test-debug, lint-debug) via the\n" +
  "  project's own Gradle wrapper. Arbitrary Gradle tasks cannot be passed. This option is only\n" +
  "  valid together with --profile android.\n" +
  "  Example: npm run security:validate -- --target \"<android-project-path>\" --profile android\n" +
  "  Example: npm run security:validate -- --target \"<android-project-path>\" --profile android --android-gradle-operations wrapper-version,tasks";

// Parse CLI arguments from process.argv (after the node/tsx and script path).
const rawArgs = process.argv.slice(2);
const toolRoot = resolveToolRoot(import.meta.url);

// Help deliberately wins over every other argument. It must remain a
// no-work path: no target/default resolution, option normalization, report
// directory creation, validation orchestration, or subprocess execution.
if (rawArgs.includes("--help") || rawArgs.includes("-h")) {
  console.log(USAGE);
  process.exitCode = 0;
  process.exit(0);
}

let args: ReturnType<typeof parseSecurityValidateArgs>;
let config: ReturnType<typeof normalizeSecurityValidateConfig>;
try {
  args = parseSecurityValidateArgs(rawArgs);
  config = normalizeSecurityValidateConfig(args, toolRoot);
  // v0.2.2 Batch 5: --profile with no --checks uses that profile's declared
  // default checks. No-op unless the user passed --profile without --checks
  // (see applyProfileDefaultChecksIfApplicable's guard) — the true no-flag
  // case and any explicit --checks case are always unaffected. Skipped for
  // "android": that profile does not use the classic --checks pipeline.
  if (config.profile !== "android") {
    config = applyProfileDefaultChecksIfApplicable(config, resolveAttackProfile(config.profile).defaultCheckIds);
  }
} catch (err) {
  const msg = err instanceof Error ? err.message : String(err);
  console.error(`\nERROR: ${msg}`);
  console.error(USAGE);
  process.exitCode = 2;
  process.exit(2);
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
console.log(`Profile    : ${config.profile}`);

// ---------------------------------------------------------------------------
// v0.4.0 Batch 5 — Android profile path.
//
// A separate orchestrator (not the classic check-group/attack-scenario
// pipeline below) because the Android check/finding/status vocabulary
// established in Batches 1-4 does not fit SecurityCheckId/SecurityCheckResult.
// Same command, same --profile flag, same reports/security/ output root.
// ---------------------------------------------------------------------------
if (config.profile === "android") {
  if (config.androidGradleOperationIds.length > 0) {
    console.log(`Gradle ops : ${config.androidGradleOperationIds.join(", ")} (explicitly requested — will execute via the target's Gradle wrapper)`);
  } else {
    console.log(`Gradle ops : (none requested — static-only validation, zero Gradle process execution)`);
  }
  console.log("");

  let result: Awaited<ReturnType<typeof validateAndroidTarget>>;
  try {
    result = await validateAndroidTarget({
      toolRoot,
      targetPath: args.target,
      requestedGradleOperationIds: config.androidGradleOperationIds,
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`\nERROR: Android validation failed to run: ${msg}`);
    process.exitCode = 3;
    process.exit(3);
  }

  const reportModel = toAndroidReportModel(result, {
    profile: config.profile,
    requestedGradleOperations: config.androidGradleOperationIds,
  });
  const textReport = renderAndroidTextReport(reportModel);

  const reportsDir = config.out;
  const prefix =
    args.reportPrefix ??
    reportFilenamePrefix({
      isSelf: result.target.local.isSelf,
      packageName: result.target.local.packageName,
      packageVersion: result.target.local.packageVersion,
      targetRoot: result.target.local.targetRoot,
    });

  let writtenPaths: string[];
  try {
    ({ writtenPaths } = writeAndroidReportFiles({ outDir: reportsDir, prefix, report: reportModel, formats: config.formats }));
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`\nERROR: Failed to write Android report files: ${msg}`);
    console.error("Validation completed but the report could not be written. The in-memory result was not persisted.");
    process.exitCode = 4;
    process.exit(4);
  }

  console.log(textReport);
  console.log(`\nReports written:`);
  for (const p of writtenPaths) {
    console.log(`  ${p}`);
  }

  const blockerExists = result.verdict === "not-ready-security-blocker-remains";
  const inconclusive = result.verdict === "inconclusive-audit-environment-incomplete";

  if (blockerExists) {
    console.error("\nExit 1 — security blocker remains.");
    process.exitCode = 1;
  } else if (inconclusive) {
    console.warn("\nExit 2 — android environment incomplete.");
    process.exitCode = 2;
  } else {
    console.log("\nExit 0 — validation completed.");
    process.exitCode = 0;
  }
} else {
  // ---------------------------------------------------------------------------
  // Classic check-group/attack-scenario pipeline (unchanged from prior versions).
  // ---------------------------------------------------------------------------
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

  // Determine output directory
  const reportsDir = config.out;

  // Determine report filename prefix
  const prefix = args.reportPrefix ?? reportFilenamePrefix(target);
  const { writtenPaths } = writeSecurityReportFiles({
    outDir: reportsDir,
    prefix,
    report,
    formats: config.formats,
  });

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
}
