// ---------------------------------------------------------------------------
// v0.4.1 Batch 7 — package-owned, bounded Android-focused Semgrep rule pack.
//
// Small, stable supplement to the internal checks — NOT a replacement.
// Deliberately excludes hardcoded-secret rules (owned by Batch 4's
// secretCandidates analyzer) and manifest-attribute rules (owned by the
// internal manifest parser); covers source-level patterns those analyzers
// do not reach. Caller-provided configuration is never accepted — this is
// the only rule pack Semgrep is ever invoked with.
// ---------------------------------------------------------------------------

export type SemgrepRuleDefinition = {
  id: string;
  languages: readonly string[];
  message: string;
  severity: "ERROR" | "WARNING" | "INFO";
  cwe?: readonly string[];
  owasp?: readonly string[];
  patterns: readonly string[];
};

export const ANDROID_SEMGREP_RULE_PACK: readonly SemgrepRuleDefinition[] = [
  {
    id: "android-semgrep-trust-all-hostname-verifier",
    languages: ["java", "kotlin"],
    message: "A HostnameVerifier implementation unconditionally returns true, disabling TLS hostname verification.",
    severity: "ERROR",
    cwe: ["CWE-297"],
    owasp: ["A02:2021"],
    patterns: ["new HostnameVerifier() { ... boolean verify(...) { return true; } ... }"],
  },
  {
    id: "android-semgrep-permissive-x509-trust-manager",
    languages: ["java", "kotlin"],
    message: "An X509TrustManager implementation has an empty or no-op certificate validation method, accepting any certificate chain.",
    severity: "ERROR",
    cwe: ["CWE-295"],
    owasp: ["A02:2021"],
    patterns: [
      "class $T : X509TrustManager { ... override fun checkServerTrusted(...) { } ... }",
      "new X509TrustManager() { ... public void checkServerTrusted(...) { } ... }",
    ],
  },
  {
    id: "android-semgrep-ssl-error-handler-proceed",
    languages: ["java", "kotlin"],
    message: "onReceivedSslError calls handler.proceed(), ignoring the certificate error and continuing the connection.",
    severity: "ERROR",
    cwe: ["CWE-295"],
    patterns: ["... onReceivedSslError(...) { ... $HANDLER.proceed() ... }"],
  },
  {
    id: "android-semgrep-webview-universal-file-url-access",
    languages: ["java", "kotlin"],
    message: "setAllowUniversalAccessFromFileURLs(true) allows file:// content to access any origin.",
    severity: "WARNING",
    cwe: ["CWE-668"],
    patterns: ["$WEBVIEW.settings.allowUniversalAccessFromFileURLs = true", "$SETTINGS.setAllowUniversalAccessFromFileURLs(true)"],
  },
  {
    id: "android-semgrep-webview-debugging-enabled",
    languages: ["java", "kotlin"],
    message: "WebView.setWebContentsDebuggingEnabled(true) is set unconditionally, which may ship to release builds.",
    severity: "INFO",
    patterns: ["WebView.setWebContentsDebuggingEnabled(true)"],
  },
  {
    id: "android-semgrep-world-readable-writable-mode",
    languages: ["java", "kotlin"],
    message: "A file or preferences API is opened with MODE_WORLD_READABLE or MODE_WORLD_WRITEABLE.",
    severity: "ERROR",
    cwe: ["CWE-732"],
    patterns: ["$CTX.getSharedPreferences($NAME, Context.MODE_WORLD_READABLE)", "$CTX.getSharedPreferences($NAME, Context.MODE_WORLD_WRITEABLE)", "$CTX.openFileOutput($NAME, Context.MODE_WORLD_READABLE)", "$CTX.openFileOutput($NAME, Context.MODE_WORLD_WRITEABLE)"],
  },
  {
    id: "android-semgrep-weak-digest-md5-sha1",
    languages: ["java", "kotlin"],
    message: "MessageDigest.getInstance uses a weak digest algorithm (MD5 or SHA-1) for security-sensitive hashing.",
    severity: "WARNING",
    cwe: ["CWE-327"],
    patterns: ['MessageDigest.getInstance("MD5")', 'MessageDigest.getInstance("SHA-1")', 'MessageDigest.getInstance("SHA1")'],
  },
  {
    id: "android-semgrep-insecure-cipher-transformation",
    languages: ["java", "kotlin"],
    message: "Cipher.getInstance uses an insecure transformation (ECB mode, DES, or RC4).",
    severity: "ERROR",
    cwe: ["CWE-327"],
    patterns: ['Cipher.getInstance("...ECB...")', 'Cipher.getInstance("DES")', 'Cipher.getInstance("RC4")'],
  },
] as const;

export function assertUniqueSemgrepRuleIds(): void {
  const ids = ANDROID_SEMGREP_RULE_PACK.map((rule) => rule.id);
  const unique = new Set(ids);
  if (unique.size !== ids.length) {
    throw new Error("Duplicate Semgrep rule id detected in ANDROID_SEMGREP_RULE_PACK.");
  }
}

// Deterministic YAML-compatible serialization (JSON is valid YAML; Semgrep
// accepts a .yaml/.yml config file). Key order is fixed so repeated calls
// produce byte-identical output (config fingerprinting depends on this).
export function serializeSemgrepRulePack(): string {
  const rules = ANDROID_SEMGREP_RULE_PACK.map((rule) => ({
    id: rule.id,
    languages: [...rule.languages],
    message: rule.message,
    severity: rule.severity,
    metadata: {
      ...(rule.cwe ? { cwe: [...rule.cwe] } : {}),
      ...(rule.owasp ? { owasp: [...rule.owasp] } : {}),
      "android-package-owned": true,
    },
    "pattern-either": rule.patterns.map((pattern) => ({ pattern })),
  }));
  return JSON.stringify({ rules }, null, 2);
}
