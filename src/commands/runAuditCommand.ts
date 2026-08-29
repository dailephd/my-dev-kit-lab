import { parseAuditArgs, normalizeAuditConfig, type AuditConfig } from "../audits/core/auditConfig.js";
import { resolveAuditTarget, type AuditTarget } from "../audits/core/auditTarget.js";
import { runAudit } from "../audits/core/auditRunner.js";
import { AUDIT_EXIT_CODES } from "../audits/core/auditExitCode.js";
import { buildAuditReportModel } from "../audits/report/auditReportModel.js";
import { writeAuditReports } from "../audits/report/writeAuditReports.js";
import { createLabExecutionContext } from "../runtime/index.js";
import type { LabExecutionContext } from "../runtime/index.js";

// ---------------------------------------------------------------------------
// v0.4.6 Batch 3 -- reusable audit command owner.
//
// Extracted from scripts/audits/runAudit.ts (formerly a top-level script
// with inline try/catch + process.exit()) so both the contributor npm
// script and the installed CLI router (src/cli/) can call the same
// argument-parsing/target-resolution/report-writing path instead of
// maintaining two implementations. Detector/severity/report-schema policy
// is untouched -- this module only owns CLI argument handling, target
// resolution, the runAudit() call, report writing, and exit-code mapping.
// ---------------------------------------------------------------------------

export const AUDIT_USAGE =
  "Usage: my-dev-kit-lab audit [--target <path>] [--types code-rot,security] " +
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
  "  Example: my-dev-kit-lab audit --target \"<android-project-path>\" --types security --android --format text,json --fail-on none";

export type RunAuditCommandOptions = {
  // Used for self-target fallback (no --target) and, unless defaultOutRoot
  // is given, for the default --out root too. Defaults to a freshly
  // discovered LabExecutionContext's packageRoot, matching the previous
  // script's resolveToolRoot(import.meta.url) behavior.
  context?: LabExecutionContext;
  // Root used only when --out was not supplied. Defaults to the target
  // toolRoot (context.packageRoot) -- the contributor npm script's exact
  // current behavior. The installed CLI router passes context.workspaceRoot
  // here so installed execution never defaults report output under the
  // package root.
  defaultOutRoot?: string;
};

export async function runAuditCommandFromArgs(
  argv: string[],
  options: RunAuditCommandOptions = {}
): Promise<number> {
  const context = options.context ?? createLabExecutionContext();
  const toolRoot = context.packageRoot;
  const defaultOutRoot = options.defaultOutRoot ?? toolRoot;

  // Help deliberately wins over every other argument, mirroring
  // scripts/security/validate.ts -- no config normalization, target
  // resolution, audit execution, or report write.
  if (argv.includes("--help") || argv.includes("-h")) {
    console.log(AUDIT_USAGE);
    return AUDIT_EXIT_CODES.SUCCESS;
  }

  let config: AuditConfig;
  try {
    const args = parseAuditArgs(argv);
    config = normalizeAuditConfig(args, defaultOutRoot);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`\nERROR: ${msg}`);
    console.error(AUDIT_USAGE);
    return AUDIT_EXIT_CODES.FATAL_ERROR;
  }

  let target: AuditTarget;
  try {
    target = resolveAuditTarget(config.targetPathArg, toolRoot);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`\nERROR: ${msg}`);
    console.error(AUDIT_USAGE);
    return AUDIT_EXIT_CODES.FATAL_ERROR;
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
    return AUDIT_EXIT_CODES.FATAL_ERROR;
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

  return model.exit.code;
}
