import type { AndroidDetectionResult } from "../../detection.js";
import type { AndroidManifestParseEntry } from "../../manifest/parseAndroidManifest.js";
import type { AndroidGradleModuleInfo } from "../../gradle/types.js";
import { buildAndroidManifestCheckResult } from "../../audit/checkResultBuilder.js";
import type { AndroidCheckResult } from "../../validation/checkResult.js";
import { sortCandidateEvidence } from "../ordering.js";
import { analyzeApplicationReleaseConfiguration } from "./analyzeReleaseConfiguration.js";

// ---------------------------------------------------------------------------
// v0.4.1 Batch 3 — standalone Android debuggable/testOnly/release build-type
// check result. Mirrors Batch 2/Batch 3-backup's checkResult.ts convention.
// Standalone: not called from validateAndroidTarget / any active
// orchestration, not rendered in reports, no CLI effect. Batch 8 integrates.
// ---------------------------------------------------------------------------

export const ANDROID_RELEASE_CONFIGURATION_AUDIT_CHECK_ID = "android-release-configuration-audit";

export function auditAndroidReleaseConfiguration(
  targetRoot: string,
  detection: AndroidDetectionResult,
  manifests: AndroidManifestParseEntry[],
  gradleModules: AndroidGradleModuleInfo[]
): AndroidCheckResult {
  const findings = [];
  const candidateEvidence = [];
  const evidence: string[] = [];
  const warnings: string[] = [];

  for (const entry of manifests) {
    const result = analyzeApplicationReleaseConfiguration(targetRoot, entry, gradleModules);
    findings.push(...result.findings);
    candidateEvidence.push(...result.candidates);
    evidence.push(
      `${entry.manifestPath}: debuggable=${result.manifestEvidence.debuggable.state}, testOnly=${result.manifestEvidence.testOnly.state}`,
      ...result.evidenceText
    );
  }

  const base = buildAndroidManifestCheckResult({
    id: ANDROID_RELEASE_CONFIGURATION_AUDIT_CHECK_ID,
    category: "android-release-configuration",
    title: "Android debuggable, testOnly, and release build-type configuration audit",
    detection,
    manifests,
    findings,
    evidence,
    warnings: [
      ...warnings,
      "Static analysis only: does not evaluate Gradle variant/flavor selection, manifest merging, or whether a published APK is actually debuggable.",
    ],
  });

  return {
    ...base,
    candidateEvidence: sortCandidateEvidence(candidateEvidence),
  };
}
