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
  {
    kind: "generic-secret-assignment",
    regex: /(?:password|passwd|secret|api[_-]?key|token)\s*[:=]\s*["']?([A-Za-z0-9_\-]{8,})["']?/gi,
  },
];

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
      // For the generic assignment pattern, judge placeholder-ness on the
      // captured value; for shaped tokens, judge on the whole match.
      const judgedText = kind === "generic-secret-assignment" ? (match[1] ?? matchedText) : matchedText;
      if (isPlaceholder(judgedText) || isPlaceholder(matchedText)) {
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
  return findings;
}

export const SECRET_LEAKAGE_SCENARIO: AttackScenario = {
  id: "secret-leakage-bounded-scan",
  title: "Secret leakage: bounded static scan finds no high-confidence secret-shaped literals",
  description:
    "Scans a bounded, deterministic set of project files (manifests, tsconfig, src/, scripts/, .env*) for high-confidence secret-shaped literal values (private keys, GitHub/OpenAI/AWS-style tokens, generic password/token/secret assignments). Placeholder values and bare env-var-name references are excluded from findings.",
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
