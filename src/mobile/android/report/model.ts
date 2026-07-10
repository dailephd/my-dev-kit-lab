import type { SecurityFinding } from "../../../securityValidation/types.js";
import type { AndroidCheckResult, AndroidCheckSkipInfo } from "../validation/checkResult.js";
import type { AndroidToolMetadata, AndroidValidationResult, AndroidVerdictReason } from "../validation/result.js";
import type { AndroidTargetMetadata } from "../targetMetadata.js";
import { androidVerdictToHumanLabel } from "../validate/androidVerdict.js";

// ---------------------------------------------------------------------------
// v0.4.0 Batch 1 — Android report model foundation.
// v0.4.0 Batch 5 — populated with real data (module/manifest/permission/
// component/deep-link/Gradle/checklist summaries, verdict reasons, and
// per-operation Gradle results) now that Batches 2-4 and the Batch 5
// orchestrator/verdict exist. Additive: every Batch 1 field name is
// preserved; new sections are new fields alongside them (agents.txt Batch 5
// section 15.1 — "extend the existing... report model... additively").
// ---------------------------------------------------------------------------

export type AndroidReportMetadata = {
  tool: AndroidToolMetadata;
  target: AndroidTargetMetadata;
  profile: string;
  requestedGradleOperations: string[];
  generatedAt: string;
  totalDurationMs: number;
};

export type AndroidReportSummarySection = {
  title: string;
  summary: string;
};

export type AndroidReportModuleSummary = {
  path: string;
  kind: string;
  uiToolkit?: string;
};

export type AndroidReportModel = {
  executiveSummary: string;
  metadata: AndroidReportMetadata;
  detectionSummary: AndroidReportSummarySection;
  androidProjectSummary: AndroidReportSummarySection;
  uiToolkitSummary: AndroidReportSummarySection;
  moduleSummary: AndroidReportModuleSummary[];
  manifestSummary: AndroidReportSummarySection;
  permissionsSummary: AndroidReportSummarySection;
  componentSummary: AndroidReportSummarySection;
  intentFilterSummary: AndroidReportSummarySection;
  deepLinkSummary: AndroidReportSummarySection;
  gradleMetadataSummary: AndroidReportSummarySection;
  gradleCheckSummary?: AndroidReportSummarySection;
  gradleOperationResults: AndroidCheckResult[];
  releaseMetadataSummary: AndroidReportSummarySection;
  playReadinessSummary: AndroidReportSummarySection;
  playReadinessItems: { id: string; title: string; status: string; detail: string }[];
  findingsBySeverity: Record<string, SecurityFinding[]>;
  checks: AndroidCheckResult[];
  skippedChecks: AndroidCheckSkipInfo[];
  environmentLimitations: string[];
  targetMutationSummary: AndroidReportSummarySection;
  staticAnalysisLimitations: string[];
  verdict: string;
  verdictHumanLabel: string;
  verdictReasons: AndroidVerdictReason[];
  recommendedNextStep: string;
  linkedArtifactReferences: string[];
};

const GRADLE_OPERATION_CHECK_PREFIX = "android-gradle-";
const GRADLE_METADATA_CHECK_ID = "android-gradle-metadata";

const STATIC_ANALYSIS_LIMITATIONS = [
  "Static Android project analysis does not prove runtime behavior.",
  "Manifests are parsed independently and are not merged.",
  "Manifest placeholders and resource references are not resolved.",
  "Gradle files are not evaluated (no Groovy/Kotlin execution).",
  "Dynamic Gradle values may remain unresolved.",
  "Same-file duplicate Gradle assignments use first-match extraction (a known limitation — see agents.txt Batch 4/5 notes).",
  "Optional Gradle execution is not performed unless explicitly requested via --android-gradle-operations.",
  "A successful debug build does not prove release build, signing, runtime security, or Play readiness.",
  "Android SDK or dependency availability may limit optional checks.",
  "Digital Asset Links are not verified.",
  "Domain ownership is not verified.",
  "Current Google Play policy is not checked by this tool.",
  "APK/AAB contents and signing are not inspected.",
];

function groupFindingsBySeverity(findings: SecurityFinding[]): Record<string, SecurityFinding[]> {
  const grouped: Record<string, SecurityFinding[]> = {};
  for (const finding of findings) {
    if (!grouped[finding.severity]) grouped[finding.severity] = [];
    grouped[finding.severity].push(finding);
  }
  return grouped;
}

export type ToAndroidReportModelOptions = {
  profile?: string;
  requestedGradleOperations?: string[];
};

// Builds the report model from a complete AndroidValidationResult (Batch 5).
export function toAndroidReportModel(result: AndroidValidationResult, options: ToAndroidReportModelOptions = {}): AndroidReportModel {
  const permissionCount = result.manifests.reduce((sum, m) => sum + m.permissions.length, 0);
  const componentCount = result.manifests.reduce(
    (sum, m) => sum + m.activities.length + (m.activityAliases?.length ?? 0) + m.services.length + m.receivers.length + m.providers.length,
    0
  );
  const intentFilterCount = result.manifests.reduce(
    (sum, m) => sum + [...m.activities, ...(m.activityAliases ?? []), ...m.services, ...m.receivers].reduce((s, c) => s + c.intentFilters.length, 0),
    0
  );
  const deepLinkCount = result.manifests.reduce((sum, m) => sum + m.deepLinks.length, 0);

  const gradleOperationResults = result.checks.filter((c) => c.id.startsWith(GRADLE_OPERATION_CHECK_PREFIX) && c.id !== GRADLE_METADATA_CHECK_ID);
  const gradleMetadataCheck = result.checks.find((c) => c.id === GRADLE_METADATA_CHECK_ID);

  const verdict = String(result.verdict);
  const isRealVerdict = result.verdict !== "not-calculated";

  return {
    executiveSummary: `Android security-validation summary for ${result.target.local.targetRoot} — ${result.manifests.length} manifest(s), ${result.checks.length} check(s), ${result.findings.length} finding(s).`,
    metadata: {
      tool: result.tool,
      target: result.target,
      profile: options.profile ?? "android",
      requestedGradleOperations: options.requestedGradleOperations ?? [],
      generatedAt: result.finishedAt,
      totalDurationMs: result.durationMs,
    },
    detectionSummary: {
      title: "Detection",
      summary: result.detection.detected
        ? `Detected (confidence: ${result.detection.confidence})`
        : `Not detected (confidence: ${result.detection.confidence})`,
    },
    androidProjectSummary: { title: "Android project classification", summary: result.target.classification.projectKind },
    uiToolkitSummary: { title: "UI toolkit classification", summary: result.target.classification.uiToolkit },
    moduleSummary: result.detection.modules.map((m) => ({ path: m.path, kind: m.kind, uiToolkit: m.uiToolkit })),
    manifestSummary: { title: "Manifests", summary: `${result.manifests.length} manifest(s) parsed independently (not merged)` },
    permissionsSummary: { title: "Permissions", summary: `${permissionCount} declared permission(s) across all manifests` },
    componentSummary: { title: "Components", summary: `${componentCount} component(s) across all manifests` },
    intentFilterSummary: { title: "Intent filters", summary: `${intentFilterCount} intent-filter(s) across all manifests` },
    deepLinkSummary: { title: "Deep links", summary: `${deepLinkCount} deep-link data entr(y/ies) across all manifests` },
    gradleMetadataSummary: {
      title: "Static Gradle metadata",
      summary: `${result.gradle.modules.length} module(s); confidence: ${result.gradle.metadataConfidence}`,
    },
    gradleCheckSummary: gradleMetadataCheck ? { title: "Gradle metadata check", summary: `status: ${gradleMetadataCheck.status}` } : undefined,
    gradleOperationResults,
    releaseMetadataSummary: {
      title: "Release metadata",
      summary: result.releaseMetadata
        ? result.releaseMetadata.applicationModuleSelectionNote
        : result.releaseMetadataSummary.note,
    },
    playReadinessSummary: {
      title: "Play readiness",
      summary: result.playReadiness ? result.playReadiness.note : result.playReadinessSummary.note,
    },
    playReadinessItems: result.playReadiness?.items.map((i) => ({ id: i.id, title: i.title, status: i.status, detail: i.detail })) ?? [],
    findingsBySeverity: groupFindingsBySeverity(result.findings),
    checks: result.checks,
    skippedChecks: result.skippedChecks,
    environmentLimitations: result.target.environmentCapabilities.notes,
    targetMutationSummary: {
      title: "Target mutation evidence",
      summary: result.targetMutationEvidence
        ? result.targetMutationEvidence.comparable
          ? `${result.targetMutationEvidence.unexpectedChanges.length} unexpected change(s), ${result.targetMutationEvidence.expectedGeneratedChanges.length} expected generated output(s)`
          : `unavailable: ${result.targetMutationEvidence.reason ?? "unknown reason"}`
        : "not captured",
    },
    staticAnalysisLimitations: STATIC_ANALYSIS_LIMITATIONS,
    verdict,
    verdictHumanLabel: isRealVerdict ? androidVerdictToHumanLabel(result.verdict as Parameters<typeof androidVerdictToHumanLabel>[0]) : "not calculated",
    verdictReasons: result.verdictReasons ?? [],
    recommendedNextStep: result.recommendedNextStep ?? "",
    linkedArtifactReferences: result.reportReferences,
  };
}

// Minimal deterministic JSON serializer — object literals above are built
// with a fixed key order, so equivalent inputs always serialize identically
// (JSON.stringify preserves string-key insertion order).
export function serializeAndroidReportModel(model: AndroidReportModel): string {
  return JSON.stringify(model, null, 2);
}
