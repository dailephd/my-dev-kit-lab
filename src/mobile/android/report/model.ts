import type { SecurityFinding } from "../../../securityValidation/types.js";
import type { AndroidCheckSkipInfo } from "../validation/checkResult.js";
import type { AndroidToolMetadata, AndroidValidationResult } from "../validation/result.js";
import type { AndroidTargetMetadata } from "../targetMetadata.js";

// ---------------------------------------------------------------------------
// v0.4.0 Batch 1 — Android report model foundation.
//
// Report input contract that later batches will render to text/JSON, mirroring
// the shape of src/securityValidation/report/securityReportTypes.ts. This
// batch only defines the contract and a minimal deterministic serializer
// sufficient to prove the contract round-trips through JSON; full text/JSON
// rendering is out of scope here.
// ---------------------------------------------------------------------------

export type AndroidReportMetadata = {
  tool: AndroidToolMetadata;
  target: AndroidTargetMetadata;
  generatedAt: string;
  totalDurationMs: number;
};

export type AndroidReportSummarySection = {
  title: string;
  summary: string;
};

export type AndroidReportModel = {
  executiveSummary: string;
  metadata: AndroidReportMetadata;
  detectionSummary: AndroidReportSummarySection;
  androidProjectSummary: AndroidReportSummarySection;
  manifestSummary: AndroidReportSummarySection;
  permissionsSummary: AndroidReportSummarySection;
  componentSummary: AndroidReportSummarySection;
  deepLinkSummary: AndroidReportSummarySection;
  gradleMetadataSummary: AndroidReportSummarySection;
  gradleCheckSummary?: AndroidReportSummarySection;
  findingsBySeverity: Record<string, SecurityFinding[]>;
  skippedChecks: AndroidCheckSkipInfo[];
  environmentLimitations: string[];
  releaseMetadataSummary: AndroidReportSummarySection;
  playReadinessSummary: AndroidReportSummarySection;
  verdict: string;
  recommendedNextStep: string;
  linkedArtifactReferences: string[];
};

function groupFindingsBySeverity(findings: SecurityFinding[]): Record<string, SecurityFinding[]> {
  const grouped: Record<string, SecurityFinding[]> = {};
  for (const finding of findings) {
    if (!grouped[finding.severity]) {
      grouped[finding.severity] = [];
    }
    grouped[finding.severity].push(finding);
  }
  return grouped;
}

// Builds the report model contract from a validation result. Populates
// deterministic structural fields only — later batches supply real prose
// summaries once detection/manifest/gradle/check logic exists.
export function toAndroidReportModel(result: AndroidValidationResult): AndroidReportModel {
  return {
    executiveSummary:
      "Android validation substrate contract (v0.4.0 Batch 1) — no detection, parsing, or checks have run.",
    metadata: {
      tool: result.tool,
      target: result.target,
      generatedAt: result.finishedAt,
      totalDurationMs: result.durationMs,
    },
    detectionSummary: { title: "Detection", summary: result.detection.detected ? "Detected" : "Not detected" },
    androidProjectSummary: { title: "Android project", summary: result.target.classification.projectKind },
    manifestSummary: { title: "Manifests", summary: `${result.manifests.length} manifest(s)` },
    permissionsSummary: {
      title: "Permissions",
      summary: `${result.manifests.reduce((sum, manifest) => sum + manifest.permissions.length, 0)} declared permission(s)`,
    },
    componentSummary: {
      title: "Components",
      summary: `${result.manifests.reduce(
        (sum, manifest) =>
          sum + manifest.activities.length + manifest.services.length + manifest.receivers.length + manifest.providers.length,
        0
      )} component(s)`,
    },
    deepLinkSummary: {
      title: "Deep links",
      summary: `${result.manifests.reduce((sum, manifest) => sum + manifest.deepLinks.length, 0)} deep-link entr(y/ies)`,
    },
    gradleMetadataSummary: { title: "Gradle metadata", summary: `${result.gradle.modules.length} module(s)` },
    findingsBySeverity: groupFindingsBySeverity(result.findings),
    skippedChecks: result.skippedChecks,
    environmentLimitations: result.target.environmentCapabilities.notes,
    releaseMetadataSummary: { title: "Release metadata", summary: result.releaseMetadataSummary.note },
    playReadinessSummary: { title: "Play readiness", summary: result.playReadinessSummary.note },
    verdict: result.verdict,
    recommendedNextStep:
      "Android validation is not yet integrated into security:validate. Proceed with the next v0.4.0 batch.",
    linkedArtifactReferences: result.reportReferences,
  };
}

// Minimal deterministic JSON serializer, sufficient to prove the report model
// contract is JSON-safe and stable. Relies on toAndroidReportModel building
// object literals with a fixed key order (JSON.stringify preserves string-key
// insertion order), so equivalent inputs always serialize identically. Full
// text/JSON rendering is a later batch's responsibility.
export function serializeAndroidReportModel(model: AndroidReportModel): string {
  return JSON.stringify(model, null, 2);
}
