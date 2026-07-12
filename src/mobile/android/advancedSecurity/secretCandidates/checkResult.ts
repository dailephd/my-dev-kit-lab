import type { AndroidDetectionResult } from "../../detection.js";
import type { AndroidCheckResult } from "../../validation/checkResult.js";
import { sortCandidateEvidence } from "../ordering.js";
import { discoverSecretSourceFiles } from "./discoverSecretSourceFiles.js";
import { analyzeSecretCandidateFile } from "./analyzeSecretCandidates.js";

// ---------------------------------------------------------------------------
// v0.4.1 Batch 4 — standalone Android secret-candidate check result.
//
// Operates over discovered files rather than parsed manifests, so it cannot
// reuse buildAndroidManifestCheckResult (Batch 3's manifest-audit builder) —
// this is a distinct, still-conservative status-decision policy: never-run
// for a non-Android target, "failed" only when a reportable (non-
// informational) finding exists, otherwise "passed". Standalone: not called
// from validateAndroidTarget / any active orchestration, not rendered in
// reports, no CLI effect. Batch 8 integrates.
// ---------------------------------------------------------------------------

export const ANDROID_SECRET_CANDIDATES_AUDIT_CHECK_ID = "android-secret-candidates-audit";

export function auditAndroidSecretCandidates(targetRoot: string, detection: AndroidDetectionResult): AndroidCheckResult {
  if (detection.projectKind === "non-android") {
    return {
      id: ANDROID_SECRET_CANDIDATES_AUDIT_CHECK_ID,
      category: "android-secret-candidates",
      title: "Android hardcoded secret-candidate audit",
      status: "unsupported",
      requirementLevel: "optional",
      ran: false,
      skipped: true,
      skipInfo: {
        checkId: ANDROID_SECRET_CANDIDATES_AUDIT_CHECK_ID,
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

  const findingsById = new Map();
  const candidatesById = new Map();
  for (const file of files) {
    const result = analyzeSecretCandidateFile(targetRoot, file);
    for (const finding of result.findings) findingsById.set(finding.id, finding);
    for (const candidate of result.candidates) candidatesById.set(candidate.id, candidate);
  }

  const findings = [...findingsById.values()].sort((a, b) => a.id.localeCompare(b.id));
  const candidateEvidence = sortCandidateEvidence([...candidatesById.values()]);

  const evidence = [`${files.length} file(s) scanned across ${new Set(files.map((f) => f.modulePath ?? "(root)")).size} module scope(s)`];
  const warnings = skipped.map((s) => `${s.relativePath}: skipped (${s.reason}${s.detail ? `: ${s.detail}` : ""})`);

  const hasReportableFinding = findings.some((f) => f.severity !== "informational");

  return {
    id: ANDROID_SECRET_CANDIDATES_AUDIT_CHECK_ID,
    category: "android-secret-candidates",
    title: "Android hardcoded secret-candidate audit",
    status: hasReportableFinding ? "failed" : "passed",
    requirementLevel: "required",
    ran: true,
    skipped: false,
    evidence,
    findings,
    warnings: [
      ...warnings,
      "Static analysis only: does not validate credentials, contact external services, or scan Git history.",
    ],
    errors: [],
    sourcePaths: files.map((f) => f.relativePath),
    confidence: skipped.length > 0 ? "medium" : "high",
    environmentRequirements: [],
    candidateEvidence,
  };
}
