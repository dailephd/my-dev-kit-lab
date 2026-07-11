// ---------------------------------------------------------------------------
// v0.4.1 Batch 4 — conservative placeholder/example/reference suppression.
//
// Deliberately a small, exact/narrow-normalized check list rather than a
// large heuristic catalog (agents.txt Batch 4 section 9.9). Operates only on
// the already-captured raw value (never re-reads the file), and this module
// is not exported through index.ts.
// ---------------------------------------------------------------------------

const EXACT_PLACEHOLDER_VALUES = new Set(
  [
    "changeme",
    "change_me",
    "change-me",
    "password",
    "secret",
    "example",
    "sample",
    "dummy",
    "fake",
    "test",
    "your-token-here",
    "your_token_here",
    "replace-me",
    "replace_me",
    "redacted",
    "masked",
    "todo",
    "xxx",
    "placeholder",
    "n/a",
    "none",
  ].map((v) => v.toLowerCase())
);

export function isEmptyValue(value: string): boolean {
  return value.trim().length === 0;
}

export function isObviousPlaceholderValue(value: string): boolean {
  const normalized = value.trim().toLowerCase();
  if (normalized.length === 0) return true;
  if (EXACT_PLACEHOLDER_VALUES.has(normalized)) return true;
  // Fully repeated single character (e.g. "****", "xxxxxxxx", "00000000").
  if (/^(.)\1*$/.test(normalized)) return true;
  return false;
}

// Environment/property/manifest-placeholder reference syntax embedded in the
// literal itself (e.g. a Kotlin string template `"${DB_PASSWORD}"`, a
// properties-file `${some.property}`, a shell-style `$VAR`, a Windows
// `%VAR%`, or an Android manifest `@string/...`/`@xml/...` reference). Any
// of these means the "literal" is not actually a hardcoded value.
const REFERENCE_SYNTAX_PATTERN = /\$\{[^}]*\}|\$[A-Za-z_][A-Za-z0-9_]*|%[A-Za-z_][A-Za-z0-9_]*%|^@(string|xml|raw|array|integer|bool)\//;

export function isReferenceSyntax(value: string): boolean {
  return REFERENCE_SYNTAX_PATTERN.test(value.trim());
}

// True when the value should never become a finding/candidate at all —
// empty or an obvious placeholder/example. Reference syntax is handled
// separately by the caller because it should surface as non-literal
// metadata (Batch 4 section 9.12), not be silently dropped.
export function shouldSuppressEntirely(value: string): boolean {
  return isEmptyValue(value) || isObviousPlaceholderValue(value);
}
