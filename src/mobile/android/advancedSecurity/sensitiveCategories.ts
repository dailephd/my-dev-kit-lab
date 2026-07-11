// ---------------------------------------------------------------------------
// v0.4.1 Batch 1 — sensitive-data category vocabulary for later secret/
// signing/configuration candidate scanners.
//
// Deliberately small and additive. This is not a security-severity scale
// (see SecuritySeverity in src/securityValidation/types.ts, reused as-is by
// candidateEvidence.ts) — it only classifies *what kind* of value a static
// candidate looks like.
//
// A bare Firebase API key (the public `apiKey` field in google-services.json
// / Firebase web config) must NOT be classified as "cloud-secret-key" or any
// other private-secret category by default: Firebase API keys identify a
// Firebase project but are not treated as confidential by Google's own
// documentation, and misclassifying them would produce a permanent, noisy
// false positive for a huge fraction of real Android apps. A later batch's
// Firebase scanner should classify that value as "unknown-sensitive-value"
// (or omit a candidate entirely) rather than a private-secret category.
// ---------------------------------------------------------------------------

export const SENSITIVE_DATA_CATEGORIES = [
  "password",
  "access-token",
  "bearer-token",
  "oauth-client-secret",
  "cloud-secret-key",
  "private-key",
  "database-credential",
  "signing-password",
  "recovery-code",
  "personal-data",
  "unknown-sensitive-value",
] as const;
export type SensitiveDataCategory = (typeof SENSITIVE_DATA_CATEGORIES)[number];

export function isSensitiveDataCategory(value: string): value is SensitiveDataCategory {
  return (SENSITIVE_DATA_CATEGORIES as readonly string[]).includes(value);
}
