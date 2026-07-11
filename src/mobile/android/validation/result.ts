import type { ReleaseVerdict, SecurityFinding } from "../../../securityValidation/types.js";
import type { MobileProfile } from "../../types.js";
import type { AndroidDetectionResult } from "../detection.js";
import type { AndroidManifestModel } from "../manifest/types.js";
import type { AndroidGradleMetadata } from "../gradle/types.js";
import type { AndroidReleaseMetadataSummary } from "../gradle/releaseMetadataSummary.js";
import type { AndroidTargetMetadata } from "../targetMetadata.js";
import type { AndroidCheckResult, AndroidCheckSkipInfo } from "./checkResult.js";

// ---------------------------------------------------------------------------
// v0.4.0 Batch 1 — Android validation result contract.
// v0.4.0 Batch 5 — narrow additive inherited-contract corrections needed to
// carry a real verdict and rich release/Play-readiness data (see agents.txt
// Batch 5 section 6.6):
//   - `verdict` widened from the single placeholder literal to
//     `AndroidVerdictValue` (ReleaseVerdict | "not-calculated"), reusing the
//     existing security-validation ReleaseVerdict vocabulary instead of
//     inventing a second one (Batch 1's own comment anticipated this: "this
//     type grows without being a breaking change — the placeholder value
//     remains valid"). Every existing "not-calculated" literal stays valid.
//   - `releaseMetadataSummary`/`playReadinessSummary` (the Batch 1 {available,
//     note} placeholders) are UNCHANGED in shape — existing object literals
//     using them remain valid — with new sibling fields `releaseMetadata`/
//     `playReadiness` added for the actual structured data, avoiding a
//     breaking retype of the original fields.
//   - `verdictReasons` and `targetMutationEvidence` are new optional fields.
// ---------------------------------------------------------------------------

export const ANDROID_VALIDATION_SCHEMA_VERSION = "android-validation-v1" as const;
export const ANDROID_VALIDATION_ARTIFACT_TYPE = "android-validation-result" as const;

// A single placeholder value: this batch and detection/manifest/gradle
// batches must never assert release readiness. A concrete verdict policy is
// introduced by a later batch, at which point this type grows without being
// a breaking change (the placeholder value remains valid).
export const ANDROID_VERDICT_NOT_CALCULATED = "not-calculated" as const;
export type AndroidVerdictPlaceholder = typeof ANDROID_VERDICT_NOT_CALCULATED;

// v0.4.0 Batch 5 — the real verdict value once calculated. Reuses the
// existing security-validation ReleaseVerdict union rather than a parallel
// Android-only vocabulary (agents.txt Batch 5 section 12.1).
export type AndroidVerdictValue = ReleaseVerdict | AndroidVerdictPlaceholder;

export type AndroidToolMetadata = {
  toolRoot: string;
  toolPackageName: string;
  toolPackageVersion: string;
};

export type AndroidPlayReadinessSummaryPlaceholder = {
  available: boolean;
  note: string;
};

export type AndroidVerdictReasonImpact = "blocking" | "inconclusive" | "advisory";

export type AndroidVerdictReason = {
  code: string;
  summary: string;
  relatedCheckId?: string;
  relatedFindingIds?: string[];
  severityOrStatus?: string;
  impact: AndroidVerdictReasonImpact;
  recommendedAction: string;
};

export type AndroidValidationResult = {
  schemaVersion: typeof ANDROID_VALIDATION_SCHEMA_VERSION;
  artifactType: typeof ANDROID_VALIDATION_ARTIFACT_TYPE;
  tool: AndroidToolMetadata;
  target: AndroidTargetMetadata;
  profile: MobileProfile;
  detection: AndroidDetectionResult;
  manifests: AndroidManifestModel[];
  gradle: AndroidGradleMetadata;
  checks: AndroidCheckResult[];
  findings: SecurityFinding[];
  skippedChecks: AndroidCheckSkipInfo[];
  warnings: string[];
  errors: string[];
  releaseMetadataSummary: {
    available: boolean;
    note: string;
  };
  releaseMetadata?: AndroidReleaseMetadataSummary;
  playReadinessSummary: AndroidPlayReadinessSummaryPlaceholder;
  playReadiness?: import("../validate/playReadinessChecklist.js").AndroidPlayReadinessChecklist;
  verdict: AndroidVerdictValue;
  verdictReasons?: AndroidVerdictReason[];
  recommendedNextStep?: string;
  targetMutationEvidence?: import("../gradle/validate/targetMutation.js").TargetMutationReport;
  reportReferences: string[];
  startedAt: string;
  finishedAt: string;
  durationMs: number;
};
