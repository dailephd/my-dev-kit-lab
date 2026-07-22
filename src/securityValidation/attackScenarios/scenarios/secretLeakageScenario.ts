import type { AttackScenario, AttackScenarioContext, AttackScenarioRunOutcome } from "../attackScenario.js";
import type { SecuritySeverity } from "../../types.js";
import { makeEvidence } from "../exploitEvidence.js";
import { collectBoundedSourceFiles, lineNumberAt } from "../boundedSourceScan.js";

// ---------------------------------------------------------------------------
// v0.2.2 Batch 4 — secret leakage scenario.
//
// Bounded, deterministic static scan (see boundedSourceScan.ts) — this is
// NOT an exhaustive secret scanner. A "passed" result is a narrow claim:
// "no high-confidence secret-shaped literal values were found in the bounded
// glob set inspected." It is not a claim that the target has no secrets
// anywhere. Placeholder values (example/changeme/dummy/test/fake/etc.) and
// bare environment-variable-name references (no literal value) are
// deliberately excluded from high-confidence findings to avoid overclaiming.
// ---------------------------------------------------------------------------

type SecretPatternKind = "private-key" | "github-token" | "openai-token" | "aws-key" | "generic-secret-assignment";

const SEVERITY_FOR_KIND: Record<SecretPatternKind, SecuritySeverity> = {
  "private-key": "blocker",
  "github-token": "blocker",
  "openai-token": "blocker",
  "aws-key": "blocker",
  "generic-secret-assignment": "major",
};

const SECRET_PATTERNS: Array<{ kind: SecretPatternKind; regex: RegExp }> = [
  { kind: "private-key", regex: /-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/g },
  { kind: "github-token", regex: /gh[pousr]_[A-Za-z0-9]{16,}/g },
  { kind: "openai-token", regex: /sk-[A-Za-z0-9]{16,}/g },
  { kind: "aws-key", regex: /AKIA[0-9A-Z]{12,}/g },
];

// ---------------------------------------------------------------------------
// Generic sensitive-identifier assignment scanning.
//
// Scanned separately from the shaped-token patterns above because it needs
// syntax-aware boundaries (comment stripping, quote-only requirement for
// source files) that a single regex over raw file content cannot express
// without producing false positives against code that merely mentions a
// sensitive identifier name — a type declaration, a function parameter, a
// function-call expression, or a comment showing example syntax.
// ---------------------------------------------------------------------------

type GenericSecretFileMode = "quoted-only" | "allow-unquoted";

// Only recognized configuration file forms may carry an unquoted literal
// value; every other file (including all TypeScript/JavaScript/JVM/Gradle
// source) requires a genuine quoted string literal before a match is even
// considered.
function genericSecretFileMode(relativePath: string): GenericSecretFileMode {
  const normalized = relativePath.replace(/\\/g, "/");
  const basename = normalized.slice(normalized.lastIndexOf("/") + 1).toLowerCase();
  if (basename === ".env" || basename.startsWith(".env.")) return "allow-unquoted";
  if (/\.(properties|yaml|yml|toml)$/.test(basename)) return "allow-unquoted";
  return "quoted-only";
}

// Deterministic line-by-line comment filter. Preserves the original string
// length and every newline so line numbers computed from the filtered
// content remain identical to the original file; comment content (line or
// block) is replaced with spaces so it can never contribute to a match.
// Quote-aware: a comment marker inside a single- or double-quoted literal
// does not start a comment, and a backslash-escaped quote does not end one.
function stripCodeCommentsPreservingLength(content: string): string {
  const result = new Array<string>(content.length);
  let index = 0;
  let inLineComment = false;
  let inBlockComment = false;
  let inSingleQuote = false;
  let inDoubleQuote = false;

  while (index < content.length) {
    const ch = content[index];
    const next = index + 1 < content.length ? content[index + 1] : "";

    if (inLineComment) {
      if (ch === "\n") {
        inLineComment = false;
        result[index] = "\n";
      } else {
        result[index] = " ";
      }
      index++;
      continue;
    }

    if (inBlockComment) {
      if (ch === "*" && next === "/") {
        result[index] = " ";
        result[index + 1] = " ";
        inBlockComment = false;
        index += 2;
        continue;
      }
      result[index] = ch === "\n" ? "\n" : " ";
      index++;
      continue;
    }

    if (inSingleQuote || inDoubleQuote) {
      result[index] = ch;
      if (ch === "\\" && next !== "") {
        result[index + 1] = next;
        index += 2;
        continue;
      }
      if ((inSingleQuote && ch === "'") || (inDoubleQuote && ch === '"')) {
        inSingleQuote = false;
        inDoubleQuote = false;
      }
      index++;
      continue;
    }

    if (ch === "/" && next === "/") {
      inLineComment = true;
      result[index] = " ";
      index++;
      continue;
    }
    if (ch === "/" && next === "*") {
      inBlockComment = true;
      result[index] = " ";
      index++;
      continue;
    }
    if (ch === "'") {
      inSingleQuote = true;
      result[index] = ch;
      index++;
      continue;
    }
    if (ch === '"') {
      inDoubleQuote = true;
      result[index] = ch;
      index++;
      continue;
    }
    result[index] = ch;
    index++;
  }

  return result.join("");
}

const GENERIC_SENSITIVE_SINGLE_WORDS = new Set(["password", "passwd", "secret", "token"]);

function splitGenericIdentifierWords(identifier: string): string[] {
  const unquoted = identifier.replace(/^['"]|['"]$/g, "");
  return unquoted
    .replace(/([a-z0-9])([A-Z])/g, "$1_$2")
    .split(/[_\-.\s]+/)
    .map((word) => word.toLowerCase())
    .filter((word) => word.length > 0);
}

// Classifies only the complete left-side identifier already isolated by the
// caller. Never inspects right-side text, so a function name, type name, or
// argument on the right of an assignment can never itself be treated as a
// sensitive identifier.
//
// The sensitive word must be the identifier's final component (e.g.
// storePassword, DB_PASSWORD, accessToken) rather than appearing anywhere in
// a compound name — this keeps unrelated metadata fields that merely mention
// "token" as a leading/middle word (tokenUsageSource, tokenCountMethod) from
// being treated as credential-shaped identifiers, while every required
// sensitive example (password, storePassword, keyPassword, DB_PASSWORD,
// SECRET_TOKEN, clientSecret, accessToken, apiKey, api_key) still ends in
// its sensitive word.
function isGenericSecretIdentifier(identifier: string): boolean {
  const words = splitGenericIdentifierWords(identifier);
  if (words.length === 0) return false;
  const lastWord = words[words.length - 1];
  if (GENERIC_SENSITIVE_SINGLE_WORDS.has(lastWord)) return true;
  if (words.length >= 2 && words[words.length - 2] === "api" && lastWord === "key") return true;
  return false;
}

function stripSurroundingQuotes(value: string): string {
  if (value.length >= 2 && ((value[0] === '"' && value.endsWith('"')) || (value[0] === "'" && value.endsWith("'")))) {
    return value.slice(1, -1);
  }
  return value;
}

const DYNAMIC_VALUE_PREFIXES = ["$", "process.env", "system.getenv", "providers.gradleproperty"];

function isDynamicUnquotedValue(rawValue: string): boolean {
  const lower = rawValue.toLowerCase();
  return DYNAMIC_VALUE_PREFIXES.some((prefix) => lower.startsWith(prefix));
}

// Requires an identifier, a separator, and a value immediately following the
// separator whose first non-whitespace character is a quote — this alone
// structurally excludes function calls, identifier references, environment
// lookups, and Gradle-property lookups, none of which begin with a quote.
const QUOTED_ASSIGNMENT_PATTERN =
  /(?<![A-Za-z0-9_$])(["']?)([A-Za-z_$][A-Za-z0-9_$]*)\1\s*[:=]\s*(["'])((?:\\.|(?!\3)[^\\\r\n])*)\3/g;

const UNQUOTED_CONFIG_PATTERN = /^([A-Za-z_][A-Za-z0-9_.-]*)\s*[:=]\s*(\S.*?)\s*$/;

const MIN_GENERIC_SECRET_LENGTH = 8;

function scanGenericSecretAssignments(relativePath: string, content: string): SecretFinding[] {
  const findings: SecretFinding[] = [];
  const mode = genericSecretFileMode(relativePath);
  const scannedContent = mode === "quoted-only" ? stripCodeCommentsPreservingLength(content) : content;
  const lines = scannedContent.split("\n");

  for (let lineIndex = 0; lineIndex < lines.length; lineIndex++) {
    const line = lines[lineIndex];

    if (mode === "allow-unquoted") {
      const trimmed = line.trim();
      if (trimmed.length === 0 || trimmed.startsWith("#") || trimmed.startsWith(";")) continue;
      const unquotedMatch = UNQUOTED_CONFIG_PATTERN.exec(trimmed);
      if (!unquotedMatch) continue;
      const identifier = unquotedMatch[1];
      if (!isGenericSecretIdentifier(identifier)) continue;
      const rawCandidate = unquotedMatch[2];
      if (isDynamicUnquotedValue(rawCandidate)) continue;
      const rawValue = stripSurroundingQuotes(rawCandidate);
      if (rawValue.length < MIN_GENERIC_SECRET_LENGTH) continue;
      if (isPlaceholder(rawValue)) continue;
      findings.push({
        kind: "generic-secret-assignment",
        file: relativePath,
        line: lineIndex + 1,
        matchedText: `${identifier} ${line.includes(":") ? ":" : "="} [REDACTED]`,
        matchLength: rawValue.length,
        severity: SEVERITY_FOR_KIND["generic-secret-assignment"],
      });
      continue;
    }

    QUOTED_ASSIGNMENT_PATTERN.lastIndex = 0;
    let match: RegExpExecArray | null;
    while ((match = QUOTED_ASSIGNMENT_PATTERN.exec(line)) !== null) {
      const identifier = match[2];
      const rawValue = match[4];
      if (match[0].length === 0) {
        QUOTED_ASSIGNMENT_PATTERN.lastIndex += 1;
        continue;
      }
      if (!isGenericSecretIdentifier(identifier)) continue;
      if (rawValue.length < MIN_GENERIC_SECRET_LENGTH) continue;
      if (isPlaceholder(rawValue)) continue;
      findings.push({
        kind: "generic-secret-assignment",
        file: relativePath,
        line: lineIndex + 1,
        matchedText: `${identifier} [REDACTED]`,
        matchLength: rawValue.length,
        severity: SEVERITY_FOR_KIND["generic-secret-assignment"],
      });
    }
  }

  return findings;
}

const PLACEHOLDER_MARKERS: RegExp[] = [
  /\bexample\b/i,
  /change[-_]?me/i,
  /\bdummy\b/i,
  /\btest\b/i,
  /\bfake\b/i,
  /your[-_]?api[-_]?key/i,
  /<[a-z_]+>/i,
  /\bxxxx+\b/i,
  /\bplaceholder\b/i,
  /\bsample\b/i,
  /\bredacted\b/i,
];

function isPlaceholder(text: string): boolean {
  return PLACEHOLDER_MARKERS.some((p) => p.test(text));
}

const SEVERITY_RANK: Record<SecuritySeverity, number> = {
  blocker: 4,
  major: 3,
  minor: 2,
  informational: 1,
  skipped: 0,
};

type SecretFinding = {
  kind: SecretPatternKind;
  file: string;
  line: number;
  matchedText: string;
  matchLength: number;
  severity: SecuritySeverity;
};

function scanFileForSecrets(relativePath: string, content: string): SecretFinding[] {
  const findings: SecretFinding[] = [];
  for (const { kind, regex } of SECRET_PATTERNS) {
    // Each pattern object's `regex` is reused across files; reset lastIndex
    // via a fresh exec loop to stay correct for global regexes.
    const re = new RegExp(regex.source, regex.flags);
    let match: RegExpExecArray | null;
    while ((match = re.exec(content)) !== null) {
      const matchedText = match[0];
      if (isPlaceholder(matchedText)) {
        // Downgrade: not a high-confidence finding, skip entirely rather
        // than add noise — placeholders are expected in source/config.
        continue;
      }
      // Guard against zero-length matches looping forever.
      if (matchedText.length === 0) {
        re.lastIndex += 1;
        continue;
      }
      findings.push({
        kind,
        file: relativePath,
        line: lineNumberAt(content, match.index),
        matchedText,
        matchLength: matchedText.length,
        severity: SEVERITY_FOR_KIND[kind],
      });
    }
  }
  // Generic sensitive-identifier assignment scanning is syntax-aware (see
  // scanGenericSecretAssignments above) and is appended after the shaped-
  // token findings for this file; the caller's global sort by file/line
  // keeps overall ordering deterministic.
  findings.push(...scanGenericSecretAssignments(relativePath, content));
  return findings;
}

export const SECRET_LEAKAGE_SCENARIO: AttackScenario = {
  id: "secret-leakage-bounded-scan",
  title: "Secret leakage: bounded static scan finds no high-confidence secret-shaped literals",
  description:
    "Scans a bounded, deterministic set of project files (manifests, tsconfig, src/, scripts/, .env*) for high-confidence secret-shaped literal values (private keys, GitHub/OpenAI/AWS-style tokens, and generic password/token/secret assignments). Generic assignments in code files require a genuine quoted string literal value; recognized configuration files (.env*, .properties, .yaml/.yml, .toml) may also carry an unquoted literal. Comments, type declarations, function calls, identifier references, and environment/Gradle-property lookups are never treated as literal values. Placeholder values are excluded from findings.",
  checkId: "secrets",
  applicableProfiles: [],
  severityBaseline: "informational",
  verdictImpact: "target-project-blocker",
  expectedSafeBehavior:
    "No high-confidence secret-shaped literal values are present in the bounded glob set inspected.",
  evidenceRequirements: ["secret-leak", "observation"],
  run: async (ctx: AttackScenarioContext): Promise<AttackScenarioRunOutcome> => {
    const files = collectBoundedSourceFiles(ctx.target.targetRoot);

    if (files.length === 0) {
      return {
        status: "passed",
        confidence: "low",
        evidence: [
          makeEvidence({
            kind: "observation",
            source: "bounded secret scan file collection",
            confidence: "low",
            expectedBehavior: "At least one file would be scanned for a meaningful bounded-scan claim.",
            observedBehavior:
              "0 files matched the bounded glob set (package.json/tsconfig/src/scripts/.env*). No findings because there was nothing to scan — this does not prove the target has no secrets elsewhere.",
          }),
        ],
      };
    }

    const allFindings: SecretFinding[] = [];
    for (const file of files) {
      allFindings.push(...scanFileForSecrets(file.relativePath, file.content));
    }
    allFindings.sort((a, b) => a.file.localeCompare(b.file) || a.line - b.line);

    const evidence = [
      makeEvidence({
        kind: "observation",
        source: "bounded secret scan",
        confidence: "medium",
        expectedBehavior: "Bounded scan of manifests/tsconfig/src/scripts/.env* files.",
        observedBehavior: `${files.length} file(s) scanned; ${allFindings.length} high-confidence secret-shaped finding(s).`,
      }),
      ...allFindings.slice(0, 20).map((f) =>
        makeEvidence({
          kind: "secret-leak",
          source: `pattern '${f.kind}'`,
          filePath: f.file,
          line: f.line,
          confidence: "high",
          expectedBehavior: "No literal high-confidence secret values in scanned source paths.",
          // Manually pre-redacted: never pass the raw matched text through —
          // some generic-assignment matches are shorter than the 32-char
          // generic redaction threshold in redactPreview(), so we redact
          // explicitly here rather than relying on it for this scenario.
          rawPreview: `${f.kind} match in ${f.file}:${f.line} [REDACTED:${f.matchLength}chars]`,
        })
      ),
    ];

    if (allFindings.length === 0) {
      return { status: "passed", confidence: "medium", evidence };
    }

    const worstSeverity = allFindings.reduce<SecuritySeverity>(
      (worst, f) => (SEVERITY_RANK[f.severity] > SEVERITY_RANK[worst] ? f.severity : worst),
      "informational"
    );

    return {
      status: "failed",
      confidence: "high",
      evidence,
      severity: worstSeverity,
      recommendation: `Remove or rotate ${allFindings.length} high-confidence secret-shaped value(s) found in the scanned bounded file set; move secrets to environment variables or a secret manager, never literal source/config values.`,
    };
  },
};
