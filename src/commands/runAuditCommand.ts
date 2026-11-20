import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describeAuditFile, observedAuditArguments, reserveAuditExecution, type AuditExecutionReceipt } from "../audits/core/auditExecutionReceipt.js";
import { QUALIFIED_B3_P1_KIT } from "../audits/core/kitSourceProvider.js";
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
  "  --kit-archive <file> and --kit-package-root <dir> select the qualified local Kit package.\n" +
  "  --source-export <file> records the supplied export file's digest. --retry-of <id> links a previous run.\n" +
  "  --source-snapshot <git-sha> declares the source revision. Repeat --require-source <relative-path> to require export files.\n" +
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
  /** Existing project workspace root for durable audit evidence. */
  evidenceWorkspace?: string;
  /** Global options and command name, before audit options. */
  launcherArgv?: readonly string[];
  // Root used only when --out was not supplied. Defaults to the target
  // toolRoot (context.packageRoot) -- the contributor npm script's exact
  // current behavior. The installed CLI router passes context.workspaceRoot
  // here so installed execution never defaults report output under the
  // package root.
  defaultOutRoot?: string;
  kitSourceProviderDependencies?: import("../audits/core/kitSourceProvider.js").KitSourceProviderDependencies;
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
  let args: ReturnType<typeof parseAuditArgs>;
  try {
    args = parseAuditArgs(argv);
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

  let receipt: AuditExecutionReceipt | undefined;
  let model: ReturnType<typeof buildAuditReportModel>;
  const writtenPaths: string[] = [];
  const reportArtifacts: ReturnType<typeof describeAuditFile>[] = [];
  try {
    const workspace = options.evidenceWorkspace ??
      (args.kitArchive || args.kitPackageRoot || args.retryOf || args.sourceExport ||
        args.sourceSnapshot || args.requiredSourcePaths ? context.invocationCwd : undefined);
    if (workspace) {
      receipt = reserveAuditExecution(workspace, target.rootPath, args.retryOf, target.isSelf);
      console.log(`Execution receipt: ${receipt.directory}`);
      const entrypoint = options.launcherArgv && process.argv[1] ? describeAuditFile(process.argv[1]) : null;
      const invocation = observedAuditArguments(argv);
      receipt.write("initial", {
        createdAt: new Date().toISOString(), retryOf: receipt.retryOf,
        cwd: process.cwd(), target, explicit: invocation,
        launcher: describeAuditFile(process.execPath), entrypoint,
        launcherArgv: options.launcherArgv ? {
          args: [...options.launcherArgv, ...invocation.args],
          exact: invocation.exact && process.execArgv.length === 0,
          nodeOptionsRedacted: process.execArgv.length > 0,
        } : null,
        nodeVersion: process.version, platform: process.platform, arch: process.arch,
        labVersion: JSON.parse(fs.readFileSync(path.join(toolRoot, "package.json"), "utf8")).version,
        labCommandModule: describeAuditFile(fileURLToPath(import.meta.url)),
        effective: config, sourceProvider: "kit",
        declaredSnapshot: args.sourceSnapshot ?? null, requiredSourcePaths: args.requiredSourcePaths ?? [],
        sourceExport: args.sourceExport ? path.resolve(args.sourceExport) : null,
      });
    }
    if (Boolean(args.kitArchive) !== Boolean(args.kitPackageRoot)) {
      throw new Error("The qualified Kit archive and installed package root must be supplied together.");
    }
    const deps = args.kitArchive ? { expectation: QUALIFIED_B3_P1_KIT,
      qualifiedArchivePath: path.resolve(args.kitArchive), installedPackageRoot: path.resolve(args.kitPackageRoot!) }
      : options.kitSourceProviderDependencies;
    receipt?.setStage("source-export");
    if (args.sourceExport) receipt?.write("source-export", {
      file: describeAuditFile(path.resolve(args.sourceExport)),
      relationshipToTarget: null, archiveCommand: null,
    });
    if (receipt) {
      receipt.setStage("report-destination");
      if (!config.outWasDefault) {
        const workspaceRoot = fs.realpathSync(workspace!);
        const relative = path.relative(workspaceRoot, config.out);
        if (path.isAbsolute(relative) || !["lab-output", "reports"].includes(relative.split(path.sep)[0]!)) {
          throw new Error("Managed audit reports require a destination under the workspace lab-output or reports directory.");
        }
        // Reject existing links (including ancestor junctions) before writing.
        let current = workspaceRoot;
        for (const segment of relative.split(path.sep)) {
          current = path.join(current, segment);
          try {
            if (!fs.lstatSync(current).isDirectory() || path.relative(current, fs.realpathSync(current)) !== "") {
              throw new Error("Managed audit report destination is not a physical workspace directory.");
            }
          } catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }
        }
        const targetRelative = path.relative(target.rootPath, config.out);
        if (!target.isSelf && !path.isAbsolute(targetRelative) && targetRelative !== ".." &&
            !targetRelative.startsWith(".." + path.sep)) throw new Error("Managed audit reports cannot be written into the inspected target.");
      } else {
        config = { ...config, out: path.join(receipt.directory, "reports") };
      }
      receipt.write("effective-config", config);
    }
    const result = await runAudit({ config, toolRoot, target, declaredSnapshot: args.sourceSnapshot,
      requiredSourcePaths: args.requiredSourcePaths, kitSourceProviderDependencies: { ...deps, receipt } });
    if (receipt) receipt.write("audit-result", {
      exitCode: result.exitCode, exitReason: result.exitReason, coverage: result.coverage,
      issues: result.issues, skippedDetectors: result.skippedDetectors, detectorErrors: result.detectorErrors,
    });
    receipt?.setStage("report-generation");
    model = buildAuditReportModel(result, { target });
    for (const report of [...Object.values(model.securitySummary.reportPaths), ...Object.values(model.androidSecurity.summary.reportPaths)]) {
      if (receipt && report && fs.existsSync(report)) reportArtifacts.push(describeAuditFile(report));
    }
    writeAuditReports({ model, config, outDir: config.out, exclusive: Boolean(receipt),
      onWritten: (filename) => {
        writtenPaths.push(filename);
        if (receipt) {
          const artifact = describeAuditFile(filename);
          reportArtifacts.push(artifact);
          receipt.write("audit-report-" + path.extname(filename).slice(1), artifact);
        }
      } });
    receipt?.write("outcome", { exitCode: model.exit.code, exitReason: model.exit.reason, reports: reportArtifacts });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (receipt) {
      try { receipt.write("failure", { stage: receipt.stage, error: msg,
        category: err instanceof Error && "category" in err ? err.category : null,
        exitCode: AUDIT_EXIT_CODES.FATAL_ERROR, reports: reportArtifacts }); }
      catch (receiptError) { console.error(`ERROR: could not finalize audit receipt: ${String(receiptError)}`); }
    }
    console.error(`\nERROR: audit runtime failure: ${msg}`);
    return AUDIT_EXIT_CODES.FATAL_ERROR;
  }

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
      : model.exit.code === AUDIT_EXIT_CODES.FATAL_ERROR
        ? `Exit 2 -- required audit coverage incomplete.`
        : `Exit 1 -- fail-on threshold breached.`
  );

  return model.exit.code;
}
