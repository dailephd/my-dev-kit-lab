// ---------------------------------------------------------------------------
// v0.4.1 Batch 2 — public exports for the standalone Android network-
// security (cleartext traffic / Network Security Config) audit.
//
// Exports only what a later integration batch (or a test) needs: the parser,
// the effective-policy deriver, the analyzer, and the standalone check-result
// builder. Internal helpers (attribute parsing, bounded previews, per-scope
// finding builders) stay unexported.
// ---------------------------------------------------------------------------

export { parseNetworkSecurityConfig } from "./parseNetworkSecurityConfig.js";
export { deriveEffectiveNetworkPolicy } from "./deriveEffectiveNetworkPolicy.js";
export type { EffectiveNetworkPolicy, EffectiveNetworkScope, EffectiveCleartextSource, EffectiveTrustAnchorsSource } from "./deriveEffectiveNetworkPolicy.js";
export { extractManifestNetworkSecurityEvidence } from "./manifestEvidence.js";
export type { ManifestNetworkSecurityEvidence, UsesCleartextTrafficEvidence, NetworkSecurityConfigReferenceEvidence } from "./manifestEvidence.js";
export { analyzeManifestNetworkSecurity } from "./analyzeNetworkSecurity.js";
export type { AnalyzeNetworkSecurityResult } from "./analyzeNetworkSecurity.js";
export { auditAndroidNetworkSecurity, ANDROID_NETWORK_SECURITY_AUDIT_CHECK_ID } from "./checkResult.js";
export type {
  NetworkSecurityConfigParseResult,
  NscBaseConfig,
  NscDomainConfig,
  NscDomainEntry,
  NscTrustAnchors,
  NscCertificatesEntry,
  NscPinSet,
  NscPinEntry,
  NscDebugOverrides,
  NscTrustAnchorSourceKind,
} from "./types.js";
