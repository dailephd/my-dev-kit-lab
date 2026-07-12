import { type SensitiveDataCategory } from "../sensitiveCategories.js";

// ---------------------------------------------------------------------------
// v0.4.1 Batch 6 — shared direct sensitive-identifier classification used by
// the sensitive-storage, sensitive-logging, clipboard, and Firebase/Google
// analyzers. Reuses the Batch 1 SensitiveDataCategory vocabulary (no second
// category enum). Deliberately conservative: exact normalized-word matching
// only, never broad substring matching, so ordinary identifiers ("password"
// inside "PasswordResetActivity" is still matched as the whole word
// "password" after camelCase splitting, but "passwordless" is not silently
// matched as "password"). This mirrors the same "no forced-substring false
// positive" discipline already documented for Batch 4's identifier matcher.
//
// Explicitly excluded from this vocabulary (see sensitiveCategories.ts and
// agents.txt Batch 6 section 9.2/22): apiKey, projectId, appId, packageName,
// storageBucket, databaseUrl, senderId — these are Firebase/Google
// configuration identifiers, not private secrets, and must never classify as
// sensitive by name alone.
// ---------------------------------------------------------------------------

export type SensitiveIdentifierClassification = {
  sensitiveDataCategory: SensitiveDataCategory;
  normalized: string;
};

const EXACT_WORD_CATEGORY: ReadonlyMap<string, SensitiveDataCategory> = new Map<string, SensitiveDataCategory>([
  // Authentication and credentials
  ["password", "password"],
  ["passwd", "password"],
  ["pwd", "password"],
  ["passcode", "password"],
  ["pin", "password"],
  ["secret", "unknown-sensitive-value"],
  ["credential", "unknown-sensitive-value"],
  ["credentials", "unknown-sensitive-value"],
  ["auth", "access-token"],
  ["authorization", "access-token"],
  ["bearer", "bearer-token"],
  ["bearertoken", "bearer-token"],
  ["token", "access-token"],
  ["accesstoken", "access-token"],
  ["refreshtoken", "access-token"],
  ["authtoken", "access-token"],
  ["sessiontoken", "access-token"],
  ["apisecret", "cloud-secret-key"],
  ["clientsecret", "oauth-client-secret"],
  // Signing and recovery
  ["signingpassword", "signing-password"],
  ["storepassword", "signing-password"],
  ["keypassword", "signing-password"],
  ["recoverycode", "recovery-code"],
  ["backupcode", "recovery-code"],
  ["otp", "recovery-code"],
  ["onetimepassword", "recovery-code"],
  // Personal and account data
  ["email", "personal-data"],
  ["phone", "personal-data"],
  ["phonenumber", "personal-data"],
  ["address", "personal-data"],
  ["location", "personal-data"],
  ["latitude", "personal-data"],
  ["longitude", "personal-data"],
  ["userid", "personal-data"],
  ["accountid", "personal-data"],
  ["deviceid", "personal-data"],
  ["advertisingid", "personal-data"],
  // Financial or regulated data (no dedicated category — reuses
  // personal-data, the closest Batch 1 regulated-data category)
  ["cardnumber", "personal-data"],
  ["creditcard", "personal-data"],
  ["bankaccount", "personal-data"],
  ["ssn", "personal-data"],
  ["taxid", "personal-data"],
  // Database/session data
  ["session", "access-token"],
  ["cookie", "access-token"],
  ["databasepassword", "database-credential"],
  ["dbpassword", "database-credential"],
  ["connectionstring", "database-credential"],
]);

// Public identifiers that must never be classified as sensitive by name
// alone, even though a naive substring match might otherwise catch them.
const PUBLIC_IDENTIFIER_WORDS = new Set([
  "apikey",
  "projectid",
  "appid",
  "packagename",
  "storagebucket",
  "databaseurl",
  "senderid",
  "clientid",
  "mobilesdkappid",
  "applicationid",
  "namespace",
]);

// Splits camelCase/PascalCase/snake_case/kebab-case identifiers into
// lowercase words, e.g. "userAuthToken" / "user_auth_token" -> ["user",
// "auth", "token"].
export function splitIdentifierWords(identifier: string): string[] {
  return identifier
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/([A-Z]+)([A-Z][a-z])/g, "$1 $2")
    .replace(/[-_.]+/g, " ")
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .map((word) => word.toLowerCase());
}

function normalizeCompound(words: readonly string[]): string {
  return words.join("");
}

// Returns a classification only for a defensible direct match: either the
// whole normalized identifier (with separators removed) matches a known
// compound entry, or any individual word in the identifier exactly matches a
// known single-word entry. Never matches on an arbitrary substring.
export function classifySensitiveIdentifier(identifier: string): SensitiveIdentifierClassification | undefined {
  const words = splitIdentifierWords(identifier);
  if (words.length === 0) return undefined;

  const compound = normalizeCompound(words);
  if (PUBLIC_IDENTIFIER_WORDS.has(compound)) return undefined;

  const compoundCategory = EXACT_WORD_CATEGORY.get(compound);
  if (compoundCategory !== undefined) {
    return { sensitiveDataCategory: compoundCategory, normalized: compound };
  }

  for (const word of words) {
    if (PUBLIC_IDENTIFIER_WORDS.has(word)) continue;
    const category = EXACT_WORD_CATEGORY.get(word);
    if (category !== undefined) {
      return { sensitiveDataCategory: category, normalized: word };
    }
  }

  return undefined;
}
