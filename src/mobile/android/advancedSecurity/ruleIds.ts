// ---------------------------------------------------------------------------
// v0.4.1 Batch 1 — stable rule identifiers for the advanced Android security
// checks planned for later v0.4.1 batches.
//
// This file defines identifiers only. No detector, finding, or check runs
// because a rule id exists here — later batches implement the check logic
// and reference these ids. Follows the existing per-audit-file "android-"
// prefixed string-literal convention (see src/mobile/android/audit/*.ts:
// android-permission-*, android-component-*, android-deep-link-*,
// android-intent-filter-*) rather than inventing a second id scheme.
// ---------------------------------------------------------------------------

export const ANDROID_NETWORK_SECURITY_RULE_IDS = [
  "android-network-cleartext-traffic",
  "android-network-security-config",
  "android-network-user-added-trust-anchor",
  "android-network-debug-trust-override",
  "android-network-broad-domain-config",
  "android-network-pinning-metadata",
  "android-network-pinning-unresolved",
] as const;
export type AndroidNetworkSecurityRuleId = (typeof ANDROID_NETWORK_SECURITY_RULE_IDS)[number];

export const ANDROID_BACKUP_RELEASE_RULE_IDS = [
  "android-backup-allow-backup",
  "android-backup-full-backup-content",
  "android-backup-data-extraction-rules",
  "android-release-debuggable",
  "android-release-test-only",
  "android-release-build-type-configuration",
] as const;
export type AndroidBackupReleaseRuleId = (typeof ANDROID_BACKUP_RELEASE_RULE_IDS)[number];

export const ANDROID_SECRETS_SIGNING_RULE_IDS = [
  "android-secret-hardcoded-candidate",
  "android-secret-private-key-candidate",
  "android-secret-token-password-candidate",
  "android-signing-password-literal",
  "android-signing-keystore-candidate",
  "android-signing-path-leakage",
  "android-signing-debug-in-release",
] as const;
export type AndroidSecretsSigningRuleId = (typeof ANDROID_SECRETS_SIGNING_RULE_IDS)[number];

export const ANDROID_WEBVIEW_RULE_IDS = [
  "android-webview-javascript-enabled",
  "android-webview-javascript-interface-exposure",
  "android-webview-file-content-access",
  "android-webview-universal-file-url-access",
  "android-webview-mixed-content",
  "android-webview-ssl-error-proceed",
  "android-webview-debugging-enabled",
  "android-webview-suspicious-url-loading",
] as const;
export type AndroidWebviewRuleId = (typeof ANDROID_WEBVIEW_RULE_IDS)[number];

export const ANDROID_FILE_PROVIDER_RULE_IDS = [
  "android-file-provider-exported",
  "android-file-provider-missing-protection",
  "android-file-provider-broad-paths",
  "android-file-provider-missing-paths-xml",
  "android-file-provider-malformed-paths-xml",
  "android-file-provider-unresolved-reference",
] as const;
export type AndroidFileProviderRuleId = (typeof ANDROID_FILE_PROVIDER_RULE_IDS)[number];

export const ANDROID_SENSITIVE_DATA_RULE_IDS = [
  "android-sensitive-external-storage",
  "android-sensitive-preferences",
  "android-sensitive-unsafe-file-database-storage",
  "android-sensitive-logging",
  "android-sensitive-clipboard-write",
  "android-sensitive-clipboard-read-review",
] as const;
export type AndroidSensitiveDataRuleId = (typeof ANDROID_SENSITIVE_DATA_RULE_IDS)[number];

export const ANDROID_FIREBASE_GOOGLE_RULE_IDS = [
  "android-firebase-realtime-database-permissive-rules",
  "android-firebase-firestore-permissive-rules",
  "android-firebase-storage-permissive-rules",
  "android-firebase-missing-local-rules",
  "android-firebase-google-configuration-evidence",
] as const;
export type AndroidFirebaseGoogleRuleId = (typeof ANDROID_FIREBASE_GOOGLE_RULE_IDS)[number];

export const ANDROID_OPTIONAL_TOOL_RULE_IDS = [
  "android-optional-tool-semgrep-evidence",
  "android-optional-tool-osv-evidence",
  "android-optional-tool-lint-evidence",
  "android-optional-tool-dependency-check-evidence",
] as const;
export type AndroidOptionalToolRuleId = (typeof ANDROID_OPTIONAL_TOOL_RULE_IDS)[number];

// All planned v0.4.1 advanced Android rule ids in one deterministic,
// duplicate-free list. Uniqueness across every family is verified by a
// regression test (ANDROID-V041-B1-01) rather than assumed.
export const ANDROID_ADVANCED_RULE_IDS = [
  ...ANDROID_NETWORK_SECURITY_RULE_IDS,
  ...ANDROID_BACKUP_RELEASE_RULE_IDS,
  ...ANDROID_SECRETS_SIGNING_RULE_IDS,
  ...ANDROID_WEBVIEW_RULE_IDS,
  ...ANDROID_FILE_PROVIDER_RULE_IDS,
  ...ANDROID_SENSITIVE_DATA_RULE_IDS,
  ...ANDROID_FIREBASE_GOOGLE_RULE_IDS,
  ...ANDROID_OPTIONAL_TOOL_RULE_IDS,
] as const;
export type AndroidAdvancedRuleId = (typeof ANDROID_ADVANCED_RULE_IDS)[number];

// New v0.4.1 check categories, additive to ANDROID_CHECK_CATEGORIES in
// src/mobile/android/validation/checkResult.ts. Kept here (rather than only
// inline in that file) so rule ids and their owning category live next to
// each other; checkResult.ts re-exports/spreads this list additively.
export const ANDROID_ADVANCED_CHECK_CATEGORIES = [
  "android-network-security",
  "android-backup-configuration",
  "android-release-configuration",
  "android-secret-candidates",
  "android-signing-configuration",
  "android-webview",
  "android-file-provider",
  "android-sensitive-storage",
  "android-sensitive-logging",
  "android-clipboard",
  "android-firebase-google-services",
  "android-semgrep",
  "android-osv",
  "android-lint",
  "android-dependency-check",
] as const;
export type AndroidAdvancedCheckCategory = (typeof ANDROID_ADVANCED_CHECK_CATEGORIES)[number];

const RULE_ID_TO_CATEGORY: ReadonlyMap<AndroidAdvancedRuleId, AndroidAdvancedCheckCategory> = new Map([
  ...ANDROID_NETWORK_SECURITY_RULE_IDS.map((id) => [id, "android-network-security"] as const),
  ...ANDROID_BACKUP_RELEASE_RULE_IDS.map((id) =>
    [id, id.startsWith("android-backup-") ? "android-backup-configuration" : "android-release-configuration"] as const
  ),
  ...ANDROID_SECRETS_SIGNING_RULE_IDS.map((id) =>
    [id, id.startsWith("android-secret-") ? "android-secret-candidates" : "android-signing-configuration"] as const
  ),
  ...ANDROID_WEBVIEW_RULE_IDS.map((id) => [id, "android-webview"] as const),
  ...ANDROID_FILE_PROVIDER_RULE_IDS.map((id) => [id, "android-file-provider"] as const),
  ...ANDROID_SENSITIVE_DATA_RULE_IDS.map((id) => {
    if (id === "android-sensitive-logging") return [id, "android-sensitive-logging"] as const;
    if (id.startsWith("android-sensitive-clipboard")) return [id, "android-clipboard"] as const;
    return [id, "android-sensitive-storage"] as const;
  }),
  ...ANDROID_FIREBASE_GOOGLE_RULE_IDS.map((id) => [id, "android-firebase-google-services"] as const),
  ...ANDROID_OPTIONAL_TOOL_RULE_IDS.map((id) => {
    if (id === "android-optional-tool-semgrep-evidence") return [id, "android-semgrep"] as const;
    if (id === "android-optional-tool-osv-evidence") return [id, "android-osv"] as const;
    if (id === "android-optional-tool-lint-evidence") return [id, "android-lint"] as const;
    return [id, "android-dependency-check"] as const;
  }),
]);

export function categoryForAdvancedRuleId(ruleId: AndroidAdvancedRuleId): AndroidAdvancedCheckCategory {
  const category = RULE_ID_TO_CATEGORY.get(ruleId);
  if (category === undefined) {
    throw new Error(`No category registered for advanced Android rule id: ${ruleId}`);
  }
  return category;
}
