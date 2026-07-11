// ---------------------------------------------------------------------------
// v0.4.1 Batch 4 — bounded secret-candidate scan contracts.
//
// Local to this feature; does not duplicate Batch 1's CandidateEvidence,
// SecurityFinding, or the shared bounded-source-scan utility
// (src/securityValidation/attackScenarios/boundedSourceScan.ts) — it wraps
// the existing target-containment/glob-collection primitives
// (src/core/fileGlobs.ts) with Android-appropriate exclusions and adds
// structured skip evidence, which neither existing utility provides.
// ---------------------------------------------------------------------------

export type SecretScanFile = {
  relativePath: string;
  absolutePath: string;
  modulePath?: string;
  content: string;
};

export type SecretScanSkipReason = "oversized" | "unreadable" | "binary-like";

export type SecretScanSkippedFile = {
  relativePath: string;
  reason: SecretScanSkipReason;
  detail?: string;
};

export type SecretScanDiscoveryResult = {
  files: SecretScanFile[];
  skipped: SecretScanSkippedFile[];
};
