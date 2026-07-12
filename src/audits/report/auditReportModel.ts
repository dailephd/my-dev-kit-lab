import type { AuditResult, AuditDetectorError, AuditSkippedDetector } from "../core/auditRunner.js";
import type { AuditTarget } from "../core/auditTarget.js";
import type { AuditIssue } from "../core/auditIssue.js";
import { getHighestSeverity, issueBreachesFailOnThreshold, AUDIT_EXIT_CODES } from "../core/auditExitCode.js";
import { DEFAULT_AUDIT_REGISTRY, selectDetectors, type AuditDetector } from "../core/auditRegistry.js";
import type {
  AuditConfidence,
  AuditFailOnThreshold,
  AuditFalsePositiveRisk,
  AuditIncludeArea,
  AuditSeverity,
  AuditType,
} from "../core/auditTypes.js";
import type {
  ExcludedDirectorySummaryEntry,
  FileRole,
  InventoryFileCategory,
  NormalizedLanguage,
  ProjectInventorySnapshot,
} from "../core/projectInventory.js";
import type {
  BuildToolingTruth,
  ExperimentTruth,
  ScriptGroup,
  SecurityTruth,
  SourceOfTruthSnapshot,
  TestTruth,
} from "../core/sourceOfTruth.js";
import type { SourceFactParseStatus, SourceFactsSnapshot } from "../core/sourceFacts.js";
import type { PythonProjectMetadataSnapshot } from "../core/pythonProjectMetadata.js";
import type { AndroidAuditCandidateSummary, AndroidAuditSummary, SecurityAuditReportSummary } from "../security/securityAuditTypes.js";

// ---------------------------------------------------------------------------
// v0.3.0 Batch 5 — stable, versioned audit report model.
//
// Pure transform: AuditResult (+ the richer AuditTarget the CLI script
// already has in scope) -> AuditReportModel. No I/O here (that lives in
// writeAuditReports.ts). This is what replaces the inline
// buildJsonReport()/renderMinimalTextSummary()/summarizeInventory()/
// summarizeSourceOfTruth() functions that previously lived directly in
// scripts/audits/runAudit.ts (Batch 1/2) -- the summarize* condensing logic
// is preserved verbatim here (inventory/sourceOfTruth shapes are unchanged,
// see spec 3.2 "inventory"/"sourceOfTruth" sections), just relocated so the
// CLI script can stay thin.
// ---------------------------------------------------------------------------

export const AUDIT_REPORT_SCHEMA_VERSION = "1.0";

// ---------------------------------------------------------------------------
// Condensed inventory / source-of-truth summaries (moved from runAudit.ts,
// Batch 1/2 shape preserved so tests/audits/auditReportInventoryOutput.test.ts's
// field-path assertions on parsed.inventory / parsed.sourceOfTruth keep
// resolving without change).
// ---------------------------------------------------------------------------

export type InventoryReportSummary = {
  targetRoot: string;
  totalFileCount: number;
  totalScannedFileCount: number;
  skippedFileCount: number;
  filesByCategory: Record<InventoryFileCategory, number>;
  filesByExtension: Record<string, number>;
  // v0.3.1 Batch 1 -- additive normalized language/role summaries.
  filesByLanguage: Record<NormalizedLanguage, number>;
  filesByRole: Record<FileRole, number>;
  excludedDirectorySummary: ExcludedDirectorySummaryEntry[];
  warnings: string[];
};

export function summarizeInventory(inventory: ProjectInventorySnapshot): InventoryReportSummary {
  return {
    targetRoot: inventory.targetRoot,
    totalFileCount: inventory.totalFileCount,
    totalScannedFileCount: inventory.totalScannedFileCount,
    skippedFileCount: inventory.skippedFileCount,
    filesByCategory: inventory.filesByCategory,
    filesByExtension: inventory.filesByExtension,
    filesByLanguage: inventory.filesByLanguage,
    filesByRole: inventory.filesByRole,
    excludedDirectorySummary: inventory.excludedDirectorySummary,
    warnings: inventory.warnings,
  };
}

export type SourceOfTruthReportSummary = {
  packageName: string | null;
  packageVersion: string | null;
  scriptCountByGroup: Record<ScriptGroup, number>;
  hasReadme: boolean;
  hasChangelog: boolean;
  docsFileCount: number;
  ciWorkflowCount: number;
  nodeVersionsReferenced: string[];
  buildTooling: BuildToolingTruth;
  tests: TestTruth;
  security: SecurityTruth;
  experiment: ExperimentTruth;
  warnings: string[];
};

export function summarizeSourceOfTruth(sourceOfTruth: SourceOfTruthSnapshot): SourceOfTruthReportSummary {
  const scriptCountByGroup = Object.fromEntries(
    Object.entries(sourceOfTruth.commands.scriptsByGroup).map(([group, names]) => [group, names.length])
  ) as Record<ScriptGroup, number>;

  const nodeVersionsReferenced = [
    ...new Set(sourceOfTruth.ci.workflows.flatMap((w) => w.nodeVersionsReferenced)),
  ].sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));

  return {
    packageName: sourceOfTruth.package?.name ?? null,
    packageVersion: sourceOfTruth.package?.version ?? null,
    scriptCountByGroup,
    hasReadme: sourceOfTruth.docs.hasReadme,
    hasChangelog: sourceOfTruth.docs.hasChangelog,
    docsFileCount: sourceOfTruth.docs.files.length,
    ciWorkflowCount: sourceOfTruth.ci.workflows.length,
    nodeVersionsReferenced,
    buildTooling: sourceOfTruth.buildTooling,
    tests: sourceOfTruth.tests,
    security: sourceOfTruth.security,
    experiment: sourceOfTruth.experiment,
    warnings: sourceOfTruth.warnings,
  };
}

// ---------------------------------------------------------------------------
// v0.3.1 Batch 2 -- condensed source facts summary. Same "condensed, no raw
// per-file array" shape as InventoryReportSummary above -- callers get
// counts/diagnostics, not the full SourceFileFacts[] list.
// ---------------------------------------------------------------------------

export type SourceFactsReportSummary = {
  totalFilesAnalyzed: number;
  filesByLanguage: Record<NormalizedLanguage, number>;
  filesByParseStatus: Record<SourceFactParseStatus, number>;
  analyzerDiagnosticCount: number;
  // v0.3.2 Batch 3 -- additive, language-agnostic count of analyzed files
  // that carry at least one per-file diagnostic (e.g. a Python analyzer's
  // "unterminated-triple-quoted-string"/"dynamic-import-pattern-unsupported"
  // notice, or a TypeScript/JavaScript syntax-error diagnostic). Distinct
  // from `analyzerDiagnosticCount` above, which only counts collector-level
  // diagnostics (a thrown analyzer exception) -- per-file diagnostics
  // recorded directly on each SourceFileFacts were previously collected but
  // never surfaced anywhere in the report; this closes that gap generically
  // for every language rather than adding a Python-only field.
  filesWithDiagnosticsCount: number;
  warnings: string[];
};

export function summarizeSourceFacts(sourceFacts: SourceFactsSnapshot): SourceFactsReportSummary {
  return {
    totalFilesAnalyzed: sourceFacts.files.length,
    filesByLanguage: sourceFacts.filesByLanguage,
    filesByParseStatus: sourceFacts.filesByParseStatus,
    analyzerDiagnosticCount: sourceFacts.analyzerDiagnostics.length,
    filesWithDiagnosticsCount: sourceFacts.files.filter((f) => f.diagnostics.length > 0).length,
    warnings: sourceFacts.warnings,
  };
}

// ---------------------------------------------------------------------------
// Detector status
// ---------------------------------------------------------------------------

export type AuditDetectorReportStatus = "selected" | "skipped" | "error" | "excluded";

export type AuditDetectorReportEntry = {
  id: string;
  auditType: AuditType;
  title: string;
  supportedIncludeAreas: readonly AuditIncludeArea[];
  status: AuditDetectorReportStatus;
  issueCount: number;
};

// ---------------------------------------------------------------------------
// Recommendations
// ---------------------------------------------------------------------------

export type AuditRecommendation = {
  text: string;
  detectorIds: string[];
  issueIds: string[];
  highestSeverity: AuditSeverity;
};

const MAX_JSON_RECOMMENDATIONS = 200;
const MAX_TEXT_RECOMMENDATIONS = 10;

const SEVERITY_ORDER: readonly AuditSeverity[] = ["blocker", "high", "medium", "low", "info"];
function severityRankForSort(severity: AuditSeverity): number {
  return SEVERITY_ORDER.indexOf(severity);
}

// Aggregates AuditIssue.recommendedAction strings: dedupes identical text,
// tracks which issues/detectors map to each, sorts blocker/high-severity
// recommendations first (stable by highest severity among contributing
// issues, then by first-occurrence order). Only derives text from actual
// issue.recommendedAction fields -- never invents new recommendation text.
export function buildRecommendations(issues: readonly AuditIssue[]): AuditRecommendation[] {
  const byText = new Map<string, AuditRecommendation & { firstIndex: number }>();

  issues.forEach((issue, index) => {
    const text = issue.recommendedAction;
    const existing = byText.get(text);
    if (existing) {
      if (!existing.detectorIds.includes(issue.detectorId)) existing.detectorIds.push(issue.detectorId);
      existing.issueIds.push(issue.id);
      if (severityRankForSort(issue.severity) < severityRankForSort(existing.highestSeverity)) {
        existing.highestSeverity = issue.severity;
      }
      return;
    }
    byText.set(text, {
      text,
      detectorIds: [issue.detectorId],
      issueIds: [issue.id],
      highestSeverity: issue.severity,
      firstIndex: index,
    });
  });

  const all = [...byText.values()].sort((a, b) => {
    const rankDiff = severityRankForSort(a.highestSeverity) - severityRankForSort(b.highestSeverity);
    if (rankDiff !== 0) return rankDiff;
    return a.firstIndex - b.firstIndex;
  });

  return all.slice(0, MAX_JSON_RECOMMENDATIONS).map(({ firstIndex: _firstIndex, ...rec }) => rec);
}

export { MAX_TEXT_RECOMMENDATIONS };

// ---------------------------------------------------------------------------
// Verdict labels
// ---------------------------------------------------------------------------

// Exact, reachable label strings only -- see spec 3.7. "fatal error" is
// deliberately NOT in this union: a fatal error (invalid config/target,
// runtime crash) happens before an AuditResult exists at all, so
// buildAuditReportModel is never called in that case -- there is no report
// to build. The CLI script's own catch blocks handle that case directly with
// their own exit-code/message, not via this function.
export type AuditVerdictLabel =
  | "no issues"
  | "issues found below fail-on threshold"
  | "fail-on threshold breached"
  | "detector errors";

// Precedence (documented per spec 3.7): a fail-on breach is always the
// primary label when both a breach AND detector errors are present, because
// the process exit code (what actually blocks automation) is driven by the
// breach, not by detector errors. "detector errors" is only ever the primary
// label when there is no breach -- callers that want to know about detector
// errors independently of the primary label should check
// summary.detectorErrorCount directly (always present regardless of which
// verdict label won).
export function computeVerdictLabel(result: AuditResult, breached: boolean): AuditVerdictLabel {
  if (breached) return "fail-on threshold breached";
  if (result.detectorErrors.length > 0) return "detector errors";
  if (result.issues.length === 0) return "no issues";
  return "issues found below fail-on threshold";
}

// ---------------------------------------------------------------------------
// Detector error categorization (best-effort, additive field only)
// ---------------------------------------------------------------------------

export type AuditDetectorErrorCategory = "filesystem" | "parse" | "unknown";

export function categorizeDetectorError(message: string): AuditDetectorErrorCategory {
  if (/ENOENT|no such file|ENOTDIR|EACCES|EPERM/i.test(message)) return "filesystem";
  if (/JSON|unexpected token|parse/i.test(message)) return "parse";
  return "unknown";
}

// ---------------------------------------------------------------------------
// Report model
// ---------------------------------------------------------------------------

export type AuditReportModel = {
  schemaVersion: string;
  metadata: {
    packageName: string | null;
    packageVersion: string | null;
    generatedAt: string;
    command: string;
    reportType: "code-rot-audit";
    auditType: string;
    // v0.3.0 Batch 6 — additive, backward-compatible field. `auditType`
    // above (a joined string, e.g. "code-rot") is kept exactly as-is for
    // existing consumers/tests; `auditTypes` carries the same information as
    // an actual string array (result.configSummary.types, not joined) for
    // consumers that want to iterate the selected audit types without
    // re-parsing the joined string. Purely additive: does not change the
    // top-level schema (metadata is a nested object) and does not bump
    // schemaVersion. (Top-level field count was 13 as of v0.3.0 Batch 6;
    // v0.3.1 Batch 2 added a 14th, "sourceFacts" -- see AuditReportModel
    // below.)
    auditTypes: string[];
  };
  target: {
    displayName: string;
    rootPath: string;
    targetKind: "self" | "external";
    hasPackageJson: boolean;
    hasGitRoot: boolean;
  };
  config: {
    types: string[];
    include: string[];
    formats: string[];
    failOn: string;
    out: string;
    isDefaultRun: boolean;
    android: boolean;
  };
  summary: {
    totalIssues: number;
    issuesBySeverity: Record<AuditSeverity, number>;
    issuesByConfidence: Record<AuditConfidence, number>;
    issuesByFalsePositiveRisk: Record<AuditFalsePositiveRisk, number>;
    issuesByDetector: Record<string, number>;
    releaseBlockingCount: number;
    implementationBlockingCount: number;
    autoFixEligibleCount: number;
    detectorCount: number;
    selectedDetectorCount: number;
    skippedDetectorCount: number;
    detectorErrorCount: number;
    // Additive, backward-compat field carried over from the Batch 1/2 report
    // shape (tests/audits/auditReportInventoryOutput.test.ts's precursor and
    // auditCommandCodeRotSmoke.test.ts both read a "no detector coverage at
    // all" signal) -- equivalent to selectedDetectorCount === 0.
    noDetectorsRegistered: boolean;
    highestSeverity: AuditSeverity | null;
    failOnBreached: boolean;
    finalExitCode: number;
    finalVerdictLabel: AuditVerdictLabel;
  };
  inventory: InventoryReportSummary;
  sourceOfTruth: SourceOfTruthReportSummary;
  sourceFacts: SourceFactsReportSummary;
  // v0.3.2 Batch 3 -- additive, optional-in-spirit report surface for
  // pythonProjectMetadata.ts (v0.3.2 Batch 1). Always present (never
  // undefined) since it is cheap, presence-only/simple-text-extraction data
  // collected once per run in auditRunner.ts, same as sourceFacts above --
  // but every field on it is purely informational (file presence, a
  // best-effort project name, pytest-configuration presence) and must never
  // be read as a blocker/release-readiness signal. Absent Python content
  // simply reports all-false/null, which is itself meaningful (not an
  // error) for a non-Python project.
  pythonProjectMetadata: PythonProjectMetadataSnapshot;
  // v0.3.2 Batch 4 -- additive, always-present (see securitySummary.ran)
  // security-validation audit adapter summary. 16th top-level field.
  securitySummary: SecurityAuditReportSummary;
  // v0.4.2 Batch 3 -- additive, always-present (see androidSecurity.summary.
  // requested) Android integration summary. 17th top-level field. `candidates`
  // is the same AndroidAuditSummary.candidateSummary object surfaced under
  // its own key for report-consumer discoverability -- not a duplicate
  // computation, just a second access path to data Batch 2 already produced.
  androidSecurity: {
    summary: AndroidAuditSummary;
    candidates: AndroidAuditCandidateSummary;
  };
  detectors: AuditDetectorReportEntry[];
  issues: AuditIssue[];
  skippedDetectors: AuditSkippedDetector[];
  detectorErrors: (AuditDetectorError & { category: AuditDetectorErrorCategory })[];
  recommendations: AuditRecommendation[];
  exit: {
    code: number;
    reason: string;
    failOnThreshold: AuditFailOnThreshold;
    breached: boolean;
  };
};

export type BuildAuditReportModelOptions = {
  target: AuditTarget;
  // Registry to compute the full detector picture against -- defaults to
  // DEFAULT_AUDIT_REGISTRY, matching what the runner used in a normal run.
  // Tests that pass a synthetic registry into runAudit() should pass the
  // same synthetic registry here so the detectors list stays accurate.
  registry?: readonly AuditDetector[];
  // Overridable for deterministic tests; defaults to the real current time.
  generatedAt?: string;
  // Overridable for deterministic tests; defaults to a reconstruction of the
  // `npm run audit -- ...` invocation from config.
  command?: string;
};

export function buildAuditReportModel(result: AuditResult, opts: BuildAuditReportModelOptions): AuditReportModel {
  const registry = opts.registry ?? DEFAULT_AUDIT_REGISTRY;
  const generatedAt = opts.generatedAt ?? new Date().toISOString();
  const command = opts.command ?? reconstructCommand(result);

  const issues = result.issues;
  const breached = result.exitCode === AUDIT_EXIT_CODES.THRESHOLD_BREACHED;
  const verdictLabel = computeVerdictLabel(result, breached);

  const issuesByConfidence = countBy(issues, (i) => i.confidence, ["high", "medium", "low"]);
  const issuesByFalsePositiveRisk = countBy(issues, (i) => i.falsePositiveRisk, ["high", "medium", "low"]);
  const issuesByDetector: Record<string, number> = {};
  for (const issue of issues) {
    issuesByDetector[issue.detectorId] = (issuesByDetector[issue.detectorId] ?? 0) + 1;
  }

  const detectors = buildDetectorReportEntries(registry, result);
  const selectedDetectorCount = detectors.filter((d) => d.status === "selected" || d.status === "error").length;

  const recommendations = buildRecommendations(issues);

  return {
    schemaVersion: AUDIT_REPORT_SCHEMA_VERSION,
    metadata: {
      packageName: result.sourceOfTruth.package?.name ?? null,
      packageVersion: result.sourceOfTruth.package?.version ?? null,
      generatedAt,
      command,
      reportType: "code-rot-audit",
      auditType: result.configSummary.types.join(","),
      auditTypes: result.configSummary.types,
    },
    target: {
      displayName: opts.target.displayName,
      rootPath: opts.target.rootPath,
      targetKind: opts.target.isSelf ? "self" : "external",
      hasPackageJson: opts.target.packageJsonPath !== null,
      hasGitRoot: opts.target.gitRoot !== null,
    },
    config: {
      types: result.configSummary.types,
      include: result.configSummary.include,
      formats: result.configSummary.formats,
      failOn: result.configSummary.failOn,
      out: result.configSummary.out,
      isDefaultRun: result.configSummary.isDefaultRun,
      android: result.configSummary.android,
    },
    summary: {
      totalIssues: issues.length,
      issuesBySeverity: result.issueCounts,
      issuesByConfidence,
      issuesByFalsePositiveRisk,
      issuesByDetector,
      releaseBlockingCount: issues.filter((i) => i.releaseBlocking).length,
      implementationBlockingCount: issues.filter((i) => i.implementationBlocking).length,
      autoFixEligibleCount: issues.filter((i) => i.autoFixEligible).length,
      detectorCount: registry.length,
      selectedDetectorCount,
      skippedDetectorCount: result.skippedDetectors.length,
      detectorErrorCount: result.detectorErrors.length,
      noDetectorsRegistered: selectedDetectorCount === 0,
      highestSeverity: getHighestSeverity(issues),
      failOnBreached: breached,
      finalExitCode: result.exitCode,
      finalVerdictLabel: verdictLabel,
    },
    inventory: summarizeInventory(result.inventory),
    sourceOfTruth: summarizeSourceOfTruth(result.sourceOfTruth),
    sourceFacts: summarizeSourceFacts(result.sourceFacts),
    pythonProjectMetadata: result.pythonProjectMetadata,
    securitySummary: result.securitySummary,
    androidSecurity: {
      summary: result.androidSummary,
      candidates: result.androidSummary.candidateSummary,
    },
    detectors,
    issues,
    skippedDetectors: result.skippedDetectors,
    detectorErrors: result.detectorErrors.map((e) => ({ ...e, category: categorizeDetectorError(e.message) })),
    recommendations,
    exit: {
      code: result.exitCode,
      reason: result.exitReason,
      failOnThreshold: result.configSummary.failOn as AuditFailOnThreshold,
      breached,
    },
  };
}

function countBy<T extends string>(
  issues: readonly AuditIssue[],
  selector: (issue: AuditIssue) => T,
  levels: readonly T[]
): Record<T, number> {
  const counts = Object.fromEntries(levels.map((l) => [l, 0])) as Record<T, number>;
  for (const issue of issues) {
    counts[selector(issue)] += 1;
  }
  return counts;
}

function buildDetectorReportEntries(
  registry: readonly AuditDetector[],
  result: AuditResult
): AuditDetectorReportEntry[] {
  const types = result.configSummary.types as AuditType[];
  const include = result.configSummary.include as AuditIncludeArea[];
  const selected = new Set(selectDetectors(registry, types, include).map((d) => d.id));
  const skippedIds = new Set(result.skippedDetectors.map((d) => d.id));
  const erroredIds = new Set(result.detectorErrors.map((d) => d.id));

  return registry.map((detector) => {
    let status: AuditDetectorReportStatus;
    if (!selected.has(detector.id)) {
      status = "excluded";
    } else if (erroredIds.has(detector.id)) {
      status = "error";
    } else if (skippedIds.has(detector.id)) {
      status = "skipped";
    } else {
      status = "selected";
    }

    return {
      id: detector.id,
      auditType: detector.auditType,
      title: detector.title,
      supportedIncludeAreas: detector.supportedIncludeAreas,
      status,
      issueCount: result.issues.filter((i) => i.detectorId === detector.id).length,
    };
  });
}

function reconstructCommand(result: AuditResult): string {
  const parts = ["npm", "run", "audit", "--"];
  const cfg = result.configSummary;
  if (cfg.types.length > 0) parts.push("--types", cfg.types.join(","));
  if (cfg.include.length > 0) parts.push("--include", cfg.include.join(","));
  if (cfg.formats.length > 0) parts.push("--format", cfg.formats.join(","));
  parts.push("--fail-on", cfg.failOn);
  parts.push("--out", cfg.out);
  if (cfg.android) parts.push("--android");
  return parts.join(" ");
}
