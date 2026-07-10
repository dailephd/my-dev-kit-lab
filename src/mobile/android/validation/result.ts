import type { SecurityFinding } from "../../../securityValidation/types.js";
import type { MobileProfile } from "../../types.js";
import type { AndroidDetectionResult } from "../detection.js";
import type { AndroidManifestModel } from "../manifest/types.js";
import type { AndroidGradleMetadata } from "../gradle/types.js";
import type { AndroidTargetMetadata } from "../targetMetadata.js";
import type { AndroidCheckResult, AndroidCheckSkipInfo } from "./checkResult.js";

// ---------------------------------------------------------------------------
// v0.4.0 Batch 1 — Android validation result contract.
//
// The normalized top-level result shape later batches (detection, manifest
// parsing, Gradle metadata, checks, verdict policy, CLI integration) will
// populate. This batch defines the contract and a schema-version constant
// only; no batch here calculates a verdict.
// ---------------------------------------------------------------------------

export const ANDROID_VALIDATION_SCHEMA_VERSION = "android-validation-v1" as const;
export const ANDROID_VALIDATION_ARTIFACT_TYPE = "android-validation-result" as const;

// A single placeholder value: this batch and detection/manifest/gradle
// batches must never assert release readiness. A concrete verdict policy is
// introduced by a later batch, at which point this type grows without being
// a breaking change (the placeholder value remains valid).
export const ANDROID_VERDICT_NOT_CALCULATED = "not-calculated" as const;
export type AndroidVerdictPlaceholder = typeof ANDROID_VERDICT_NOT_CALCULATED;

export type AndroidToolMetadata = {
  toolRoot: string;
  toolPackageName: string;
  toolPackageVersion: string;
};

export type AndroidPlayReadinessSummaryPlaceholder = {
  available: boolean;
  note: string;
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
  playReadinessSummary: AndroidPlayReadinessSummaryPlaceholder;
  verdict: AndroidVerdictPlaceholder;
  reportReferences: string[];
  startedAt: string;
  finishedAt: string;
  durationMs: number;
};
