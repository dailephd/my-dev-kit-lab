// ---------------------------------------------------------------------------
// v0.4.1 Batch 3 — public exports for the standalone Android debuggable/
// testOnly/release build-type audit.
// ---------------------------------------------------------------------------

export { extractManifestReleaseEvidence } from "./manifestEvidence.js";
export type { ManifestReleaseEvidence, ManifestBooleanAttributeEvidence } from "./manifestEvidence.js";
export { analyzeApplicationReleaseConfiguration } from "./analyzeReleaseConfiguration.js";
export type { AnalyzeReleaseConfigurationResult } from "./analyzeReleaseConfiguration.js";
export { auditAndroidReleaseConfiguration, ANDROID_RELEASE_CONFIGURATION_AUDIT_CHECK_ID } from "./checkResult.js";
