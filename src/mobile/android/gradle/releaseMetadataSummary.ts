import type { MobileConfidence } from "../../types.js";
import type { AndroidDetectionResult } from "../detection.js";
import type { AndroidGradleMetadata, AndroidGradleMetadataConflict } from "./types.js";

// ---------------------------------------------------------------------------
// v0.4.0 Batch 4 — narrow Android release metadata summary (section 7.28).
//
// A convenience aggregation over AndroidGradleMetadata for values Batch 5
// will need alongside manifest summaries and Play-readiness placeholders.
// Deliberately makes no Play-readiness, policy-compliance, or freshness
// claims — those are explicitly out of scope for this batch and belong to
// Batch 5 (placeholders) or a later version (real policy evaluation).
// ---------------------------------------------------------------------------

export type AndroidReleaseMetadataSummary = {
  applicationModulePath?: string;
  applicationModuleSelectionNote: string;
  applicationId?: string;
  namespace?: string;
  versionCode?: number | string;
  versionName?: string;
  minSdk?: number | string;
  targetSdk?: number | string;
  compileSdk?: number | string;
  buildTypes: string[];
  wrapperGradleVersion?: string;
  androidGradlePluginVersion?: string;
  kotlinAndroidPluginVersion?: string;
  composeEnabled?: boolean;
  metadataConfidence: MobileConfidence;
  unresolvedFields: string[];
  conflicts: AndroidGradleMetadataConflict[];
};

// Selects the application module deterministically only when exactly one
// application module exists (agents.txt Batch 4 section 7.14 — never invent
// a primary application module when several exist without a deterministic
// rule).
export function buildAndroidReleaseMetadataSummary(
  detection: AndroidDetectionResult,
  gradle: AndroidGradleMetadata
): AndroidReleaseMetadataSummary {
  const applicationModulePaths = detection.applicationModules;
  const unresolvedFields: string[] = [];

  if (applicationModulePaths.length === 0) {
    return {
      applicationModuleSelectionNote: "No application module was detected; release metadata is not available.",
      buildTypes: [],
      wrapperGradleVersion: gradle.wrapper.versionEvidence,
      androidGradlePluginVersion: gradle.pluginEvidence.androidGradlePluginVersion,
      kotlinAndroidPluginVersion: gradle.pluginEvidence.kotlinAndroidPluginVersion,
      metadataConfidence: gradle.metadataConfidence,
      unresolvedFields: [],
      conflicts: gradle.conflicts ?? [],
    };
  }

  if (applicationModulePaths.length > 1) {
    return {
      applicationModuleSelectionNote: `${applicationModulePaths.length} application modules were detected (${applicationModulePaths.join(
        ", "
      )}); no single application module was selected deterministically.`,
      buildTypes: [],
      wrapperGradleVersion: gradle.wrapper.versionEvidence,
      androidGradlePluginVersion: gradle.pluginEvidence.androidGradlePluginVersion,
      kotlinAndroidPluginVersion: gradle.pluginEvidence.kotlinAndroidPluginVersion,
      metadataConfidence: gradle.metadataConfidence,
      unresolvedFields: [],
      conflicts: gradle.conflicts ?? [],
    };
  }

  const applicationModulePath = applicationModulePaths[0];
  const moduleInfo = gradle.modules.find((m) => m.path === applicationModulePath);

  for (const [field, value] of [
    ["applicationId", moduleInfo?.applicationIdRaw],
    ["versionCode", moduleInfo?.versionCodeRaw],
    ["versionName", moduleInfo?.versionNameRaw],
    ["minSdk", moduleInfo?.minSdkRaw],
    ["targetSdk", moduleInfo?.targetSdkRaw],
    ["compileSdk", moduleInfo?.compileSdkRaw],
  ] as const) {
    if (value) unresolvedFields.push(`${field}: ${value}`);
  }

  return {
    applicationModulePath,
    applicationModuleSelectionNote: `Exactly one application module was detected (${applicationModulePath}); its metadata is used as the release metadata summary.`,
    applicationId: moduleInfo?.applicationId,
    namespace: moduleInfo?.namespace,
    versionCode: moduleInfo?.versionCode,
    versionName: moduleInfo?.versionName,
    minSdk: moduleInfo?.minSdk,
    targetSdk: moduleInfo?.targetSdk,
    compileSdk: moduleInfo?.compileSdk,
    buildTypes: moduleInfo?.buildTypes ?? [],
    wrapperGradleVersion: gradle.wrapper.versionEvidence,
    androidGradlePluginVersion: gradle.pluginEvidence.androidGradlePluginVersion,
    kotlinAndroidPluginVersion: gradle.pluginEvidence.kotlinAndroidPluginVersion,
    composeEnabled: moduleInfo?.composeEnabled,
    metadataConfidence: gradle.metadataConfidence,
    unresolvedFields,
    conflicts: gradle.conflicts ?? [],
  };
}
