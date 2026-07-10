import type { MobileConfidence } from "../../types.js";
import type { AndroidDetectionResult } from "../detection.js";
import type { AndroidCheckResult } from "../validation/checkResult.js";
import type { AndroidGradleMetadata } from "./types.js";

// ---------------------------------------------------------------------------
// v0.4.0 Batch 4 — static Gradle metadata check-result construction
// (agents.txt Batch 4 section 7.16).
//
// Status policy:
//   - non-Android target                      -> "unsupported" (optional)
//   - Android detected but no module build     -> "inconclusive" (required)
//     file could be read
//   - Android detected but no metadata field    -> "inconclusive" (required)
//     could be resolved from any module
//   - usable evidence resolved                  -> "passed"
// Unresolved dynamic values and metadata conflicts are represented as
// warnings/evidence — they never fail this check on their own, matching the
// "validation evidence, not automatic vulnerability" framing used throughout
// this batch. There is no reachable "malformed"/"error" path for plain-text
// Gradle files the way there is for XML: readAndroidGradleMetadata treats an
// unreadable file the same as an absent one, and all paths inspected here
// come from the already target-contained Batch 2 detection result.
// ---------------------------------------------------------------------------

const CHECK_ID = "android-gradle-metadata";

export function buildAndroidGradleMetadataCheckResult(detection: AndroidDetectionResult, gradle: AndroidGradleMetadata): AndroidCheckResult {
  const sourcePaths = [...gradle.settingsFiles, ...gradle.rootBuildFiles, ...gradle.moduleBuildFiles].sort((a, b) => a.localeCompare(b));
  const evidence: string[] = [];
  if (gradle.wrapper.versionEvidence) evidence.push(`Gradle wrapper version: ${gradle.wrapper.versionEvidence}`);
  if (gradle.pluginEvidence.androidGradlePluginVersion) evidence.push(`Android Gradle Plugin version: ${gradle.pluginEvidence.androidGradlePluginVersion}`);
  if (gradle.pluginEvidence.kotlinAndroidPluginVersion) evidence.push(`Kotlin Android plugin version: ${gradle.pluginEvidence.kotlinAndroidPluginVersion}`);
  for (const module of gradle.modules) {
    if (module.namespace || module.applicationId) {
      evidence.push(`${module.path}: namespace=${module.namespace ?? "(none)"} applicationId=${module.applicationId ?? "(none)"}`);
    }
  }

  const warnings = [...gradle.parseWarnings];
  if (gradle.conflicts && gradle.conflicts.length > 0) {
    warnings.push(...gradle.conflicts.map((c) => c.note));
  }

  if (detection.projectKind === "non-android") {
    return {
      id: CHECK_ID,
      category: "android-gradle",
      title: "Android Gradle metadata extraction",
      status: "unsupported",
      requirementLevel: "optional",
      ran: false,
      skipped: true,
      skipInfo: {
        checkId: CHECK_ID,
        reason: "Target was not detected as an Android project.",
        requirementLevel: "optional",
        missingCapability: "android-detection",
        verdictImpact: "does not apply to a non-Android target",
        recommendedNextAction: "Re-run against an Android Gradle project, or verify project detection.",
      },
      evidence: [],
      findings: [],
      warnings: [],
      errors: [],
      sourcePaths: [],
      confidence: "unknown",
      environmentRequirements: [],
    };
  }

  const hasModuleBuildFile = gradle.moduleBuildFiles.length > 0;
  const hasAnyResolvedModuleMetadata = gradle.modules.some(
    (m) => m.namespace || m.applicationId || m.minSdk || m.targetSdk || m.compileSdk || m.versionName || m.versionCode
  );

  if (!hasModuleBuildFile) {
    return {
      id: CHECK_ID,
      category: "android-gradle",
      title: "Android Gradle metadata extraction",
      status: "inconclusive",
      requirementLevel: "required",
      ran: true,
      skipped: false,
      evidence,
      findings: [],
      warnings: [...warnings, "No module build.gradle(.kts) file could be read for metadata extraction."],
      errors: [],
      sourcePaths,
      confidence: "unknown",
      environmentRequirements: [],
    };
  }

  if (!hasAnyResolvedModuleMetadata) {
    return {
      id: CHECK_ID,
      category: "android-gradle",
      title: "Android Gradle metadata extraction",
      status: "inconclusive",
      requirementLevel: "required",
      ran: true,
      skipped: false,
      evidence,
      findings: [],
      warnings: [...warnings, "Module build file(s) were read but no static metadata field could be resolved."],
      errors: [],
      sourcePaths,
      confidence: gradle.metadataConfidence,
      environmentRequirements: [],
    };
  }

  const confidence: MobileConfidence = gradle.metadataConfidence;

  return {
    id: CHECK_ID,
    category: "android-gradle",
    title: "Android Gradle metadata extraction",
    status: "passed",
    requirementLevel: "required",
    ran: true,
    skipped: false,
    evidence,
    findings: [],
    warnings,
    errors: [],
    sourcePaths,
    confidence,
    environmentRequirements: [],
  };
}
