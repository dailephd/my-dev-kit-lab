import type { AndroidDetectionResult } from "../../detection.js";
import type { AndroidCheckResult } from "../../validation/checkResult.js";
import { sortCandidateEvidence } from "../ordering.js";
import { discoverSecretSourceFiles } from "../secretCandidates/discoverSecretSourceFiles.js";
import { analyzeSensitiveStorageFile } from "./analyzeSensitiveStorage.js";

// ---------------------------------------------------------------------------
// v0.4.1 Batch 6 — standalone Android sensitive-storage check result.
// Follows the exact Batch 4/5 standalone pattern: not called from
// validateAndroidTarget / any active orchestration, not rendered in reports,
// no CLI effect. Batch 8 integrates.
// ---------------------------------------------------------------------------

export const ANDROID_SENSITIVE_STORAGE_AUDIT_CHECK_ID = "android-sensitive-storage-audit";

export function auditAndroidSensitiveStorage(targetRoot: string, detection: AndroidDetectionResult): AndroidCheckResult {
  if (detection.projectKind === "non-android") {
    return {
      id: ANDROID_SENSITIVE_STORAGE_AUDIT_CHECK_ID,
      category: "android-sensitive-storage",
      title: "Android sensitive-storage audit",
      status: "unsupported",
      requirementLevel: "optional",
      ran: false,
      skipped: true,
      skipInfo: {
        checkId: ANDROID_SENSITIVE_STORAGE_AUDIT_CHECK_ID,
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
      candidateEvidence: [],
    };
  }

  const modulePaths = detection.modules.map((m) => m.path);
  const { files, skipped } = discoverSecretSourceFiles(targetRoot, modulePaths);
  const sourceFiles = files.filter((file) => /\.(java|kt)$/.test(file.relativePath));

  const findingsById = new Map();
  const candidatesById = new Map();
  for (const file of sourceFiles) {
    const result = analyzeSensitiveStorageFile(targetRoot, file);
    for (const f of result.findings) findingsById.set(f.id, f);
    for (const c of result.candidates) candidatesById.set(c.id, c);
  }

  const findings = [...findingsById.values()].sort((a, b) => a.id.localeCompare(b.id));
  const candidateEvidence = sortCandidateEvidence([...candidatesById.values()]);
  const hasReportableFinding = findings.some((f) => f.severity !== "informational");

  return {
    id: ANDROID_SENSITIVE_STORAGE_AUDIT_CHECK_ID,
    category: "android-sensitive-storage",
    title: "Android sensitive-storage audit",
    status: hasReportableFinding ? "failed" : "passed",
    requirementLevel: "required",
    ran: true,
    skipped: false,
    evidence: [`${sourceFiles.length} Java/Kotlin file(s) scanned`],
    findings,
    warnings: [
      ...skipped.map((s) => `${s.relativePath}: skipped (${s.reason}${s.detail ? `: ${s.detail}` : ""})`),
      "Static analysis only: does not inspect runtime storage contents, filesystem permissions, or database records.",
    ],
    errors: [],
    sourcePaths: sourceFiles.map((f) => f.relativePath),
    confidence: skipped.length > 0 ? "medium" : "high",
    environmentRequirements: [],
    candidateEvidence,
  };
}
