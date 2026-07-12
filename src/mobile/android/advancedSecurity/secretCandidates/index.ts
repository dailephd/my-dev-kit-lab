// ---------------------------------------------------------------------------
// v0.4.1 Batch 4 — public exports for the standalone Android secret-
// candidate audit. Deliberately does not export the raw matcher
// (matchSecretCandidates.ts), suppression internals, or raw match types —
// only the discovery/analysis/check-result layers that already redact.
// ---------------------------------------------------------------------------

export { discoverSecretSourceFiles, SECRET_SCAN_GLOBS, MAX_SECRET_SCAN_FILE_BYTES, MAX_SECRET_SCAN_FILE_COUNT } from "./discoverSecretSourceFiles.js";
export type { SecretScanFile, SecretScanSkippedFile, SecretScanSkipReason, SecretScanDiscoveryResult } from "./types.js";
export { analyzeSecretCandidateFile } from "./analyzeSecretCandidates.js";
export type { AnalyzeSecretCandidatesResult } from "./analyzeSecretCandidates.js";
export { auditAndroidSecretCandidates, ANDROID_SECRET_CANDIDATES_AUDIT_CHECK_ID } from "./checkResult.js";
