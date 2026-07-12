import type { AndroidDetectionResult } from "../../detection.js";
import type { AndroidManifestParseEntry } from "../../manifest/parseAndroidManifest.js";
import { buildAndroidManifestCheckResult } from "../../audit/checkResultBuilder.js";
import type { AndroidCheckResult } from "../../validation/checkResult.js";
import { sortCandidateEvidence } from "../ordering.js";
import { analyzeManifestBackupConfiguration } from "./analyzeBackupConfiguration.js";

// ---------------------------------------------------------------------------
// v0.4.1 Batch 3 — standalone Android backup/data-extraction check result.
//
// Reuses the existing manifest-audit status-decision policy
// (buildAndroidManifestCheckResult), mirroring Batch 2's checkResult.ts.
// Standalone: not called from validateAndroidTarget / any active
// orchestration, not rendered in reports, no CLI effect. Batch 8 integrates.
// ---------------------------------------------------------------------------

export const ANDROID_BACKUP_CONFIGURATION_AUDIT_CHECK_ID = "android-backup-configuration-audit";

export function auditAndroidBackupConfiguration(targetRoot: string, detection: AndroidDetectionResult, manifests: AndroidManifestParseEntry[]): AndroidCheckResult {
  const findings = [];
  const candidateEvidence = [];
  const evidence: string[] = [];
  const warnings: string[] = [];

  for (const entry of manifests) {
    const result = analyzeManifestBackupConfiguration(targetRoot, entry);
    findings.push(...result.findings);
    candidateEvidence.push(...result.candidates);
    evidence.push(
      `${entry.manifestPath}: allowBackup=${result.evidence.allowBackup.state}, fullBackupContent=${result.evidence.fullBackupContent.state}, dataExtractionRules=${result.evidence.dataExtractionRules.state}`,
      ...result.evidenceText
    );
  }

  const base = buildAndroidManifestCheckResult({
    id: ANDROID_BACKUP_CONFIGURATION_AUDIT_CHECK_ID,
    category: "android-backup-configuration",
    title: "Android backup and data-extraction configuration audit",
    detection,
    manifests,
    findings,
    evidence,
    warnings: [
      ...warnings,
      "Static analysis only: does not evaluate Gradle manifest merging, Android resource overlays, or whether a backup actually occurs at runtime.",
    ],
  });

  return {
    ...base,
    candidateEvidence: sortCandidateEvidence(candidateEvidence),
  };
}
