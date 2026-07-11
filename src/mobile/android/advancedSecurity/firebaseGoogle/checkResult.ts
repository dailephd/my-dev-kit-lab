import type { AndroidDetectionResult } from "../../detection.js";
import type { AndroidCheckResult } from "../../validation/checkResult.js";
import { sortCandidateEvidence } from "../ordering.js";
import { analyzeFirebaseGoogleServices } from "./analyzeFirebaseGoogleServices.js";
import { discoverFirebaseArtifacts } from "./discoverFirebaseArtifacts.js";

// ---------------------------------------------------------------------------
// v0.4.1 Batch 6 — standalone Android Firebase/Google services check result.
// Follows the exact Batch 4/5 standalone pattern: not called from
// validateAndroidTarget / any active orchestration, not rendered in reports,
// no CLI effect. Batch 8 integrates.
// ---------------------------------------------------------------------------

export const ANDROID_FIREBASE_GOOGLE_SERVICES_AUDIT_CHECK_ID = "android-firebase-google-services-audit";

export function auditAndroidFirebaseGoogleServices(targetRoot: string, detection: AndroidDetectionResult): AndroidCheckResult {
  if (detection.projectKind === "non-android") {
    return {
      id: ANDROID_FIREBASE_GOOGLE_SERVICES_AUDIT_CHECK_ID,
      category: "android-firebase-google-services",
      title: "Android Firebase/Google services audit",
      status: "unsupported",
      requirementLevel: "optional",
      ran: false,
      skipped: true,
      skipInfo: {
        checkId: ANDROID_FIREBASE_GOOGLE_SERVICES_AUDIT_CHECK_ID,
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
  const discovery = discoverFirebaseArtifacts(targetRoot, modulePaths);
  const { candidates, findings } = analyzeFirebaseGoogleServices(targetRoot, modulePaths);

  const sortedFindings = [...new Map(findings.map((f) => [f.id, f])).values()].sort((a, b) => a.id.localeCompare(b.id));
  const candidateEvidence = sortCandidateEvidence([...new Map(candidates.map((c) => [c.id, c])).values()]);
  const hasReportableFinding = sortedFindings.some((f) => f.severity !== "informational");

  const sourcePaths = [
    ...discovery.googleServicesFiles,
    ...discovery.firebaseJsonFiles,
    ...discovery.firebaseRcFiles,
    ...discovery.databaseRulesJsonFiles,
    ...discovery.rulesFiles,
    ...discovery.gradleFiles,
    ...discovery.sourceFiles,
    ...discovery.manifestFiles,
  ].map((f) => f.relativePath);

  return {
    id: ANDROID_FIREBASE_GOOGLE_SERVICES_AUDIT_CHECK_ID,
    category: "android-firebase-google-services",
    title: "Android Firebase/Google services audit",
    status: hasReportableFinding ? "failed" : "passed",
    requirementLevel: "required",
    ran: true,
    skipped: false,
    evidence: [
      `${discovery.googleServicesFiles.length} google-services.json, ${discovery.firebaseJsonFiles.length} firebase.json, ${discovery.databaseRulesJsonFiles.length + discovery.rulesFiles.length} rules file(s) found`,
    ],
    findings: sortedFindings,
    warnings: [
      ...discovery.skipped.map((s) => `${s.relativePath}: skipped (${s.reason}${s.detail ? `: ${s.detail}` : ""})`),
      "Static analysis only: local configuration/rules files are not proof of the deployed Firebase project configuration; no remote Firebase or Google service was contacted.",
    ],
    errors: [],
    sourcePaths,
    confidence: discovery.skipped.length > 0 ? "medium" : "high",
    environmentRequirements: [],
    candidateEvidence,
  };
}
