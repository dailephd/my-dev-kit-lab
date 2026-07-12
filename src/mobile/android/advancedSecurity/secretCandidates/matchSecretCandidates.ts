// ---------------------------------------------------------------------------
// v0.4.1 Batch 4 — narrow, deterministic in-memory secret-candidate matching.
//
// This is the ONLY layer that ever holds a raw candidate value. Callers
// (analyzeSecretCandidates.ts) must redact/fingerprint immediately and never
// store, log, or export the raw value from this module. Nothing in this
// file is exported through index.ts.
//
// No entropy scoring is implemented: the structural markers (PEM headers)
// and explicit sensitive-identifier context already meet the "high
// confidence" bar the batch requires without it, and entropy alone must
// never create a finding per agents.txt Batch 4 section 9.8 — omitting it
// avoids speculative complexity with no corresponding required rule.
// ---------------------------------------------------------------------------

export type RawPrivateKeyMatch = {
  line: number;
  headerLabel: string;
  rawBlock: string;
  terminated: boolean;
};

export type RawAssignmentMatch = {
  line: number;
  identifier: string;
  rawValue: string;
};

const PRIVATE_KEY_HEADER_PATTERN = /-----BEGIN ([A-Z0-9 ]*?PRIVATE KEY)-----/g;

function findBlockEnd(content: string, searchStart: number, headerLabel: string): { end: number; terminated: boolean } {
  const footer = `-----END ${headerLabel}-----`;
  const footerIndex = content.indexOf(footer, searchStart);
  if (footerIndex === -1) {
    // Unterminated block — bound the captured region rather than reading to
    // end of file unbounded.
    const MAX_UNTERMINATED_BLOCK_LENGTH = 4000;
    return { end: Math.min(content.length, searchStart + MAX_UNTERMINATED_BLOCK_LENGTH), terminated: false };
  }
  return { end: footerIndex + footer.length, terminated: true };
}

function lineNumberAt(content: string, index: number): number {
  let line = 1;
  for (let i = 0; i < index && i < content.length; i++) {
    if (content[i] === "\n") line++;
  }
  return line;
}

// Public keys and certificates ("-----BEGIN PUBLIC KEY-----",
// "-----BEGIN CERTIFICATE-----") never match PRIVATE_KEY_HEADER_PATTERN
// (which requires the literal substring "PRIVATE KEY") — the boundary is
// enforced by construction, not a separate exclusion check.
export function matchPrivateKeyBlocks(content: string): RawPrivateKeyMatch[] {
  const matches: RawPrivateKeyMatch[] = [];
  for (const headerMatch of content.matchAll(PRIVATE_KEY_HEADER_PATTERN)) {
    const headerLabel = headerMatch[1];
    const startIndex = headerMatch.index ?? 0;
    const { end, terminated } = findBlockEnd(content, startIndex, headerLabel);
    matches.push({
      line: lineNumberAt(content, startIndex),
      headerLabel,
      rawBlock: content.slice(startIndex, end),
      terminated,
    });
  }
  return matches;
}

// Sensitive identifier names that, when paired with a literal (never a
// reference/placeholder), are treated as high-confidence secret-shaped
// evidence. Deliberately narrow — matches agents.txt Batch 4 section 9.5.
//
// Splits the identifier into words (snake_case and camelCase boundaries)
// rather than using a single \b-anchored regex, so real-world constant
// naming like `SECRET_TOKEN`, `DB_PASSWORD`, or `placeholderSecret` is
// recognized — a plain `\bsecret\b` regex fails on these because
// underscore and camelCase transitions are not `\b` word boundaries.
const SENSITIVE_SINGLE_WORDS = new Set(["password", "passwd", "pwd", "secret"]);
const SENSITIVE_WORD_PAIRS: ReadonlyArray<readonly [string, string]> = [
  ["client", "secret"],
  ["access", "token"],
  ["bearer", "token"],
  ["auth", "token"],
  ["api", "secret"],
  ["signing", "password"],
  ["store", "password"],
  ["key", "password"],
  ["database", "password"],
  ["db", "password"],
];

function splitIdentifierWords(identifier: string): string[] {
  return identifier
    .replace(/([a-z0-9])([A-Z])/g, "$1_$2")
    .split(/[_\-.\s]+/)
    .map((word) => word.toLowerCase())
    .filter((word) => word.length > 0);
}

function isSensitiveIdentifier(identifier: string): boolean {
  const words = splitIdentifierWords(identifier);
  if (words.some((word) => SENSITIVE_SINGLE_WORDS.has(word))) return true;
  for (const [first, second] of SENSITIVE_WORD_PAIRS) {
    for (let i = 0; i < words.length - 1; i++) {
      if (words[i] === first && words[i + 1] === second) return true;
    }
  }
  return false;
}

// Finds `identifier = "value"` / `identifier: "value"` / `identifier="value"`
// / `"identifier": "value"` (JSON-style quoted key) pairs anywhere on a line
// (the value side quoting is required — code files never match an unquoted
// right-hand side, so a variable/function reference such as
// `val password = getPassword()` can never be mistaken for a literal).
const KEY_VALUE_QUOTED_PATTERN = /["']?([A-Za-z_][A-Za-z0-9_]*)["']?\s*[:=]\s*["']([^"']*)["']/g;

// Properties/YAML/TOML permit unquoted scalar values on a `key = value` /
// `key: value` line; still requires the key itself to match the sensitive
// identifier pattern.
const KEY_VALUE_UNQUOTED_PATTERN = /^\s*([A-Za-z_][A-Za-z0-9_.-]*)\s*[:=]\s*(\S.*?)\s*$/;

export type SecretFileKind = "code" | "config-quotable" | "config-unquoted";

// Scans line-by-line (bounds work naturally; also gives exact line numbers
// without a second pass). Returns only pairs whose *captured identifier*
// (not just the line generally) matches a sensitive name — reference/
// placeholder/empty-value filtering happens in analyzeSecretCandidates.ts,
// which also owns redaction, so this function's return values are the last
// point at which a raw value exists before that immediate conversion.
export function matchSensitiveAssignments(content: string, fileKind: SecretFileKind): RawAssignmentMatch[] {
  const matches: RawAssignmentMatch[] = [];
  const lines = content.split(/\r\n|\r|\n/);

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    if (fileKind === "config-unquoted") {
      const unquoted = line.match(KEY_VALUE_UNQUOTED_PATTERN);
      if (unquoted && isSensitiveIdentifier(unquoted[1])) {
        matches.push({ line: i + 1, identifier: unquoted[1], rawValue: stripSurroundingQuotes(unquoted[2]) });
      }
      continue;
    }

    for (const pairMatch of line.matchAll(KEY_VALUE_QUOTED_PATTERN)) {
      if (isSensitiveIdentifier(pairMatch[1])) {
        matches.push({ line: i + 1, identifier: pairMatch[1], rawValue: pairMatch[2] });
      }
    }
  }
  return matches;
}

function stripSurroundingQuotes(value: string): string {
  if (value.length >= 2 && ((value[0] === '"' && value.endsWith('"')) || (value[0] === "'" && value.endsWith("'")))) {
    return value.slice(1, -1);
  }
  return value;
}
