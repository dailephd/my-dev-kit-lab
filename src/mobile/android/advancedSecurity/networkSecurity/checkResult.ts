import type { AndroidDetectionResult } from "../../detection.js";
import type { AndroidManifestParseEntry } from "../../manifest/parseAndroidManifest.js";
import { buildAndroidManifestCheckResult } from "../../audit/checkResultBuilder.js";
import type { AndroidCheckResult } from "../../validation/checkResult.js";
import { sortCandidateEvidence } from "../ordering.js";
import { analyzeManifestNetworkSecurity } from "./analyzeNetworkSecurity.js";

// ---------------------------------------------------------------------------
// v0.4.1 Batch 2 — standalone Android network-security check result.
//
// Reuses the existing manifest-audit status-decision policy
// (buildAndroidManifestCheckResult, src/mobile/android/audit/
// checkResultBuilder.ts) rather than inventing a second one — this check
// operates over the same AndroidManifestParseEntry[] shape as the four
// v0.4.0 manifest audits.
//
// Deliberately standalone: this function is exercised directly by tests but
// is NOT called from validateAndroidTarget / any active orchestration, not
// rendered in text/JSON reports, and does not affect the CLI. A later
// integration batch (Batch 8 per the version plan) wires it in.
// ---------------------------------------------------------------------------

export const ANDROID_NETWORK_SECURITY_AUDIT_CHECK_ID = "android-network-security-audit";

export function auditAndroidNetworkSecurity(targetRoot: string, detection: AndroidDetectionResult, manifests: AndroidManifestParseEntry[]): AndroidCheckResult {
  const findings = [];
  const candidateEvidence = [];
  const evidence: string[] = [];
  const warnings: string[] = [];

  for (const entry of manifests) {
    const result = analyzeManifestNetworkSecurity(targetRoot, entry);
    findings.push(...result.findings);
    candidateEvidence.push(...result.candidates);
    evidence.push(
      `${entry.manifestPath}: usesCleartextTraffic=${result.evidence.usesCleartextTraffic.state}, networkSecurityConfig=${result.evidence.networkSecurityConfig.state}`
    );
  }

  const base = buildAndroidManifestCheckResult({
    id: ANDROID_NETWORK_SECURITY_AUDIT_CHECK_ID,
    category: "android-network-security",
    title: "Android cleartext traffic and Network Security Config audit",
    detection,
    manifests,
    findings,
    evidence,
    warnings: [
      ...warnings,
      "Static analysis only: does not evaluate Gradle manifest merging, Android resource overlays, or runtime network/TLS behavior.",
    ],
  });

  return {
    ...base,
    candidateEvidence: sortCandidateEvidence(candidateEvidence),
  };
}
