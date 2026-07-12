#!/usr/bin/env node
import { parseAuditArgs, normalizeAuditConfig, type AuditConfig } from "../../src/audits/core/auditConfig.js";
import { resolveAuditTarget, type AuditTarget } from "../../src/audits/core/auditTarget.js";
import { runAudit } from "../../src/audits/core/auditRunner.js";
import { AUDIT_EXIT_CODES } from "../../src/audits/core/auditExitCode.js";
import { resolveToolRoot } from "../security/resolveToolRoot.js";
import { buildAuditReportModel } from "../../src/audits/report/auditReportModel.js";
import { writeAuditReports } from "../../src/audits/report/writeAuditReports.js";

// ---------------------------------------------------------------------------
// v0.3.0 Batch 5 -- npm run audit entrypoint.
//
// Thin wiring only: parse args -> normalize config -> resolve target ->
// runAudit() -> buildAuditReportModel() -> writeAuditReports() -> print a
// concise console summary -> set process.exitCode. All report-shaping logic
// (the former inline buildJsonReport()/renderMinimalTextSummary()/
// summarizeInventory()/summarizeSourceOfTruth() functions from Batch 1/2)
// now lives in src/audits/report/ -- see auditReportModel.ts,
// renderAuditJsonReport.ts, renderAuditTextReport.ts, writeAuditReports.ts.
// Mirrors the structure of scripts/security/validate.ts.
// ---------------------------------------------------------------------------

const USAGE =
  "Usage: npm run audit -- [--target <path>] [--types code-rot,security] " +
  "[--include docs,tests,package,architecture,cli] [--format text,json] " +
  "[--fail-on blocker|high|medium|low|none] [--out <path>] [--android]\n" +
  "\n" +
  "  --android opts into Batch 2's programmatic Android security integration.\n" +
  "  Requires --types to include \"security\" (e.g. --types security or --types\n" +
  "  code-rot,security). Runs the same static, read-only, nineteen-check\n" +
  "  Android validation security:validate --profile android performs --\n" +
  "  detection, manifest parsing, and internal advanced security checks --\n" +
  "  through the existing security adapter, never a subprocess. Confirmed\n" +
  "  findings are mapped into the normal issue collection; CandidateEvidence\n" +
  "  remains a separate, bounded summary and is never treated as a confirmed\n" +
  "  issue. Starts zero Gradle operations, zero external tools, and zero\n" +
  "  network operations by default; --android does not expose any of those.\n" +
  "  Example: npm run audit -- --target \"<android-project-path>\" --types security --android --format text,json --fail-on none";

const rawArgs = process.argv.slice(2);
const toolRoot = resolveToolRoot(import.meta.url);

// Help deliberately wins over every other argument, mirroring
// scripts/security/validate.ts -- no config normalization, target
// resolution, audit execution, or report write.
if (rawArgs.includes("--help") || rawArgs.includes("-h")) {
  console.log(USAGE);
  process.exitCode = 0;
  process.exit(0);
}

let config: AuditConfig;
try {
  const args = parseAuditArgs(rawArgs);
  config = normalizeAuditConfig(args, toolRoot);
} catch (err) {
  const msg = err instanceof Error ? err.message : String(err);
  console.error(`\nERROR: ${msg}`);
  console.error(USAGE);
  process.exitCode = AUDIT_EXIT_CODES.FATAL_ERROR;
  process.exit(AUDIT_EXIT_CODES.FATAL_ERROR);
}

let target: AuditTarget;
try {
  target = resolveAuditTarget(config.targetPathArg, toolRoot);
} catch (err) {
  const msg = err instanceof Error ? err.message : String(err);
  console.error(`\nERROR: ${msg}`);
  console.error(USAGE);
  process.exitCode = AUDIT_EXIT_CODES.FATAL_ERROR;
  process.exit(AUDIT_EXIT_CODES.FATAL_ERROR);
}

console.log("=".repeat(60));
console.log("my-dev-kit-lab audit");
console.log("=".repeat(60));
console.log(`Tool root  : ${toolRoot}`);
if (!target.isSelf) {
  console.log(`Target     : ${target.rootPath}`);
} else {
  console.log(`Mode       : self-audit`);
}
console.log(`Types      : ${config.types.join(", ")}`);
console.log(`Include    : ${config.include.join(", ")}`);
console.log("");

let result;
try {
  result = await runAudit({ config, toolRoot, target });
} catch (err) {
  const msg = err instanceof Error ? err.message : String(err);
  console.error(`\nERROR: audit runtime failure: ${msg}`);
  process.exitCode = AUDIT_EXIT_CODES.FATAL_ERROR;
  process.exit(AUDIT_EXIT_CODES.FATAL_ERROR);
}

const model = buildAuditReportModel(result, { target });
const { writtenPaths } = writeAuditReports({ model, config, outDir: config.out });

console.log(`Issues found        : ${model.summary.totalIssues}`);
console.log(
  `  blocker=${model.summary.issuesBySeverity.blocker} high=${model.summary.issuesBySeverity.high} medium=${model.summary.issuesBySeverity.medium} low=${model.summary.issuesBySeverity.low} info=${model.summary.issuesBySeverity.info}`
);
console.log(`Skipped detectors    : ${model.summary.skippedDetectorCount}`);
if (model.summary.detectorErrorCount > 0) {
  console.log(`Detector errors      : ${model.summary.detectorErrorCount}`);
  for (const e of model.detectorErrors) {
    console.log(`  [${e.id}] ${e.message}`);
  }
}
if (model.summary.noDetectorsRegistered && !model.securitySummary.ran) {
  console.log(`Note: no code-rot detectors are registered for this run's --types/--include selection -- this run collected inventory/source-of-truth data only.`);
}

if (model.securitySummary.ran) {
  console.log(
    `\nSecurity validation: verdict=${model.securitySummary.verdictLabel} checks=${model.securitySummary.totalChecks} findings(blocker=${model.securitySummary.findingCounts.blocker} major=${model.securitySummary.findingCounts.major} minor=${model.securitySummary.findingCounts.minor} info=${model.securitySummary.findingCounts.informational})`
  );
  if (model.securitySummary.reportPaths.text) {
    console.log(`  Full report: ${model.securitySummary.reportPaths.text}`);
  }
}

if (model.androidSecurity.summary.requested) {
  const android = model.androidSecurity.summary;
  console.log(
    `\nAndroid security validation: status=${android.status} applicable=${android.applicable ?? "n/a"} verdict=${android.verdict ?? "(unknown)"} checks=${android.totalChecks} confirmed=${android.confirmedFindingCount} mappedIssues=${android.mappedIssueCount} candidates=${android.candidateSummary.totalCount}`
  );
  if (android.reportPaths.text) {
    console.log(`  Full report: ${android.reportPaths.text}`);
  }
}

console.log(`\nInventory: ${model.inventory.totalScannedFileCount} file(s) scanned, ${model.inventory.skippedFileCount} skipped`);
console.log(
  `  source=${model.inventory.filesByCategory.source} tests=${model.inventory.filesByCategory.tests} docs=${model.inventory.filesByCategory.docs} package=${model.inventory.filesByCategory.package} config=${model.inventory.filesByCategory.config} scripts=${model.inventory.filesByCategory.scripts} ci=${model.inventory.filesByCategory.ci}`
);
console.log(
  `Source of truth: package=${model.sourceOfTruth.packageName ?? "(none)"}@${model.sourceOfTruth.packageVersion ?? "?"} readme=${model.sourceOfTruth.hasReadme} changelog=${model.sourceOfTruth.hasChangelog} ciWorkflows=${model.sourceOfTruth.ciWorkflowCount}`
);
console.log(
  `Source facts: ${model.sourceFacts.totalFilesAnalyzed} file(s) analyzed (parsed=${model.sourceFacts.filesByParseStatus.parsed} file-level-only=${model.sourceFacts.filesByParseStatus["file-level-only"]} unsupported=${model.sourceFacts.filesByParseStatus.unsupported})`
);

if (writtenPaths.length > 0) {
  console.log(`\nReports written:`);
  for (const p of writtenPaths) {
    console.log(`  ${p}`);
  }
}

console.log(`\nHighest severity: ${model.summary.highestSeverity ?? "(none)"}`);
console.log(`Verdict: ${model.summary.finalVerdictLabel}`);
console.log(`Exit reason: ${model.exit.reason}`);
console.log(
  model.exit.code === AUDIT_EXIT_CODES.SUCCESS
    ? `Exit 0 -- audit completed.`
    : `Exit 1 -- fail-on threshold breached.`
);
process.exitCode = model.exit.code;
