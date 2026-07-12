import type { SecurityFinding } from "../../../../securityValidation/types.js";
import { makeAndroidFinding } from "../../audit/androidFinding.js";
import { makeCandidateEvidence, type CandidateEvidence } from "../candidateEvidence.js";
import { buildAndroidSourceLocation } from "../sourceLocation.js";
import { classifyDirectExpression } from "../sensitiveData/classifyDirectExpression.js";
import { classifySensitiveIdentifier } from "../sensitiveData/classifySensitiveIdentifier.js";
import type { SecretScanFile } from "../secretCandidates/types.js";
import { collectLoggingEvidence } from "./collectLoggingEvidence.js";
import type { LoggingMatch } from "./types.js";

// ---------------------------------------------------------------------------
// v0.4.1 Batch 6 — sensitive-logging analysis: turns raw LoggingMatch
// evidence into CandidateEvidence / SecurityFinding. Only "android-sensitive-
// logging" (the sole Batch 1 logging rule id) is used — severity and
// resolutionState carry the distinction between direct sensitive evidence
// and lower-confidence review evidence, following the same pattern the
// Batch 4 secret scanner uses for its single hardcoded-candidate rule id.
//
// Policy: a log/print/Crashlytics argument that is a bare identifier or
// simple member-access whose *name* classifies as sensitive (via the shared
// classifySensitiveIdentifier) is treated as direct evidence regardless of
// whether the variable happens to hold a literal or a dynamic value — this
// module has no cross-statement variable-declaration tracking, so the
// identifier's name is the only signal available, exactly as documented in
// agents.txt Batch 6 section 9.2. A bare string literal's *content* is never
// inspected for sensitive keywords (that would require value-level analysis
// this batch explicitly excludes), so logging the literal text "password" is
// never itself a finding — only a variable/expression *named* password is.
// ---------------------------------------------------------------------------

export type AnalyzeSensitiveLoggingResult = { candidates: CandidateEvidence[]; findings: SecurityFinding[] };

// Authorization/Bearer/Cookie/session/token identifiers are already covered
// by classifySensitiveIdentifier's shared vocabulary (no separate header
// word list here) — a bare string literal equal to a header *name* (e.g.
// "Authorization" used as a log tag) is deliberately never inspected for
// content, so it never produces a finding (see module header note above).

function sensitiveIdentifierNameFor(expression: string | undefined): { sensitiveDataCategory: ReturnType<typeof classifySensitiveIdentifier> } | undefined {
  if (expression === undefined) return undefined;
  const classification = classifyDirectExpression(expression);
  if (classification.kind !== "identifier" && classification.kind !== "member-access") return undefined;
  const name = expression.replace(/^.*\./, "");
  const result = classifySensitiveIdentifier(name);
  return result ? { sensitiveDataCategory: result } : undefined;
}

function isExceptionMessageExpression(expression: string | undefined): boolean {
  if (expression === undefined) return false;
  return /\.(message|localizedMessage)$/.test(expression) || /\.(getMessage|stackTraceToString)\s*\(\s*\)$/.test(expression);
}

export function analyzeSensitiveLoggingFile(targetRoot: string, file: SecretScanFile): AnalyzeSensitiveLoggingResult {
  const candidates: CandidateEvidence[] = [];
  const findings: SecurityFinding[] = [];
  const matches = collectLoggingEvidence(file.content);
  const limitations = [
    "Bounded lexical source analysis; does not prove a log call executed, that logs are present on a device, or that Crashlytics uploaded data.",
  ];

  const location = (m: LoggingMatch) => buildAndroidSourceLocation(targetRoot, file.absolutePath, { line: m.line });

  const finding = (m: LoggingMatch, title: string, evidenceDetails: string[]) =>
    findings.push(
      makeAndroidFinding({
        ruleId: "android-sensitive-logging",
        title,
        severity: m.debugGuarded ? "minor" : "major",
        confidence: "high",
        description: `${title} via ${m.api}. Static source evidence only; does not prove the call executed or that logs were collected.`,
        manifestPath: file.relativePath,
        identity: `${m.api}:${m.line}`,
        location: { line: m.line },
        evidenceDetails: [...evidenceDetails, m.debugGuarded ? "debug-guard=present" : "debug-guard=none"],
        recommendation: "Remove sensitive values from log statements, or guard them out of release builds entirely.",
      })
    );

  const candidate = (m: LoggingMatch, summary: string, rawValue: string | undefined, confidence: "low" | "medium" | "high" = "medium", resolutionState: "resolved" | "unresolved" | "not-applicable" = "resolved") =>
    candidates.push(
      makeCandidateEvidence({
        ruleId: "android-sensitive-logging",
        category: "android-sensitive-logging",
        confidence,
        modulePath: file.modulePath,
        location: location(m),
        summary,
        rawValue,
        resolutionState,
        staticAnalysisLimitations: limitations,
      })
    );

  for (const m of matches) {
    if (m.kind === "isloggable") {
      candidate(m, "Log.isLoggable is contextual evidence; it is not a security control by itself", undefined, "low", "not-applicable");
      continue;
    }

    if (m.kind === "print-stack-trace") {
      candidate(m, "printStackTrace() called; review evidence only, does not prove secrets are present", m.throwableExpression, "low", "not-applicable");
      continue;
    }

    if (m.kind === "crashlytics") {
      if (m.api === "Crashlytics.recordException") {
        candidate(m, "Crashlytics recordException() called", undefined, "low", "not-applicable");
        continue;
      }
      if (m.api === "Crashlytics.setCustomKey") {
        const keyLiteral = m.tagExpression !== undefined ? classifyDirectExpression(m.tagExpression) : undefined;
        const sensitive = keyLiteral?.kind === "string-literal" && keyLiteral.literalValue !== undefined ? classifySensitiveIdentifier(keyLiteral.literalValue) : sensitiveIdentifierNameFor(m.tagExpression);
        if (sensitive) {
          finding(m, "Sensitive Crashlytics custom key or value set", [`key=${m.tagExpression}`]);
        } else {
          candidate(m, "Crashlytics setCustomKey() called", m.messageExpression, "low");
        }
        continue;
      }
      if (m.api === "Crashlytics.setUserId") {
        const sensitive = sensitiveIdentifierNameFor(m.messageExpression);
        if (sensitive) {
          finding(m, "Direct personal identifier supplied to Crashlytics setUserId", [`value=${m.messageExpression}`]);
        } else {
          candidate(m, "Crashlytics setUserId() called; privacy review evidence", m.messageExpression, "low");
        }
        continue;
      }
      // Crashlytics.log — same sensitive-message policy as Log/Timber below.
    }

    // Log / Timber / stdout / Crashlytics.log share one sensitive-argument policy.
    const tagSensitive = sensitiveIdentifierNameFor(m.tagExpression);
    const messageSensitive = sensitiveIdentifierNameFor(m.messageExpression);

    if (tagSensitive || messageSensitive) {
      finding(m, `Direct sensitive value logged via ${m.api}`, [`argument=${messageSensitive ? m.messageExpression : m.tagExpression}`]);
      continue;
    }

    if (isExceptionMessageExpression(m.messageExpression)) {
      candidate(m, "Exception message/stack-trace text logged; content not inspected", m.messageExpression, "low", "not-applicable");
      continue;
    }

    if (m.messageExpression !== undefined) {
      const classification = classifyDirectExpression(m.messageExpression);
      if (classification.kind === "method-call" || classification.kind === "collection-object" || classification.kind === "member-access" || classification.kind === "dynamic-unsupported") {
        candidate(m, `Dynamic ${classification.kind.replace("-", " ")} logged; contents not inspected`, m.messageExpression, "low", "unresolved");
      } else if (classification.kind === "identifier") {
        candidate(m, "Dynamic log message logged; identifier not recognized as sensitive by name", m.messageExpression, "low", "unresolved");
      }
    }
  }

  return { candidates, findings };
}
