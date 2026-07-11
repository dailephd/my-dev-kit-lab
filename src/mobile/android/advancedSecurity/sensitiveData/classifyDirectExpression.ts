// ---------------------------------------------------------------------------
// v0.4.1 Batch 6 — shared bounded direct-expression classification.
//
// Classifies a single, already-extracted argument/value expression string
// (captured by an analyzer's own bounded regex, e.g. the second argument to
// a Log.d(...) call, or the value passed to putString(...)) into a coarse
// syntactic kind. This performs no evaluation, no alias resolution beyond
// what the caller already resolved, and no interprocedural analysis — it is
// purely a classifier over the literal text of the expression.
//
// Safety invariant: `rawExpression` and the derived `literalValue` are
// returned for the caller's own redaction step (via
// makeCandidateEvidence/redactedPreviewForCandidate) — `boundedSummary` never
// contains literal content, only the classified kind and shape, so a caller
// that forgets to redact still cannot leak a raw value through the summary.
// ---------------------------------------------------------------------------

export const DIRECT_EXPRESSION_KINDS = [
  "string-literal",
  "numeric-literal",
  "boolean-literal",
  "null-literal",
  "identifier",
  "member-access",
  "method-parameter",
  "method-call",
  "environment-lookup",
  "property-lookup",
  "placeholder-interpolation",
  "collection-object",
  "dynamic-unsupported",
] as const;
export type DirectExpressionKind = (typeof DIRECT_EXPRESSION_KINDS)[number];

export type DirectExpressionClassification = {
  kind: DirectExpressionKind;
  isDirectLiteral: boolean;
  /** Unquoted literal content when kind is "string-literal"; undefined otherwise. Never logged directly by this module. */
  literalValue?: string;
  boundedSummary: string;
};

const MAX_EXPRESSION_LENGTH = 400;

function bound(expression: string): string {
  return expression.length > MAX_EXPRESSION_LENGTH ? `${expression.slice(0, MAX_EXPRESSION_LENGTH)}...` : expression;
}

function unquoteJavaKotlinString(literal: string): string | undefined {
  const tripleMatch = /^"""([\s\S]*)"""$/.exec(literal);
  if (tripleMatch) return tripleMatch[1];
  const doubleMatch = /^"((?:[^"\\]|\\.)*)"$/.exec(literal);
  if (doubleMatch) {
    try {
      return JSON.parse(literal) as string;
    } catch {
      return doubleMatch[1];
    }
  }
  return undefined;
}

export function classifyDirectExpression(rawExpression: string): DirectExpressionClassification {
  const trimmed = bound(rawExpression.trim());
  const summaryFor = (kind: DirectExpressionKind): string => `${kind} (length=${trimmed.length})`;

  if (trimmed.length === 0) {
    return { kind: "dynamic-unsupported", isDirectLiteral: false, boundedSummary: summaryFor("dynamic-unsupported") };
  }

  // Kotlin string templates / Java concatenation with a dynamic operand:
  // treated as placeholder-interpolation, not a pure literal, even though it
  // may still contain a sensitive literal fragment — callers that need the
  // literal fragment extract it separately before classification.
  if (/\$\{[^}]*\}|\$[A-Za-z_][\w]*/.test(trimmed) && /^"/.test(trimmed)) {
    return { kind: "placeholder-interpolation", isDirectLiteral: false, boundedSummary: summaryFor("placeholder-interpolation") };
  }
  if (/^"[^"]*"\s*\+/.test(trimmed) || /\+\s*"[^"]*"$/.test(trimmed) || (/^".*"$/.test(trimmed) && /\+/.test(trimmed))) {
    return { kind: "placeholder-interpolation", isDirectLiteral: false, boundedSummary: summaryFor("placeholder-interpolation") };
  }

  const unquoted = unquoteJavaKotlinString(trimmed);
  if (unquoted !== undefined) {
    return { kind: "string-literal", isDirectLiteral: true, literalValue: unquoted, boundedSummary: summaryFor("string-literal") };
  }

  if (/^-?\d+(\.\d+)?[fFdDlL]?$/.test(trimmed)) {
    return { kind: "numeric-literal", isDirectLiteral: true, literalValue: trimmed, boundedSummary: summaryFor("numeric-literal") };
  }
  if (trimmed === "true" || trimmed === "false") {
    return { kind: "boolean-literal", isDirectLiteral: true, literalValue: trimmed, boundedSummary: summaryFor("boolean-literal") };
  }
  if (trimmed === "null") {
    return { kind: "null-literal", isDirectLiteral: false, boundedSummary: summaryFor("null-literal") };
  }

  if (/^(System\.getenv|getenv)\s*\(/.test(trimmed)) {
    return { kind: "environment-lookup", isDirectLiteral: false, boundedSummary: summaryFor("environment-lookup") };
  }
  if (/^BuildConfig\./.test(trimmed)) {
    return { kind: "property-lookup", isDirectLiteral: false, boundedSummary: summaryFor("property-lookup") };
  }
  if (/^[{\[]/.test(trimmed)) {
    return { kind: "collection-object", isDirectLiteral: false, boundedSummary: summaryFor("collection-object") };
  }
  if (/^[A-Za-z_$][\w$]*(\.[A-Za-z_$][\w$]*)*\s*\(/.test(trimmed)) {
    return { kind: "method-call", isDirectLiteral: false, boundedSummary: summaryFor("method-call") };
  }
  if (/^[A-Za-z_$][\w$]*(\.[A-Za-z_$][\w$]*)+$/.test(trimmed)) {
    return { kind: "member-access", isDirectLiteral: false, boundedSummary: summaryFor("member-access") };
  }
  if (/^[A-Za-z_$][\w$]*$/.test(trimmed)) {
    return { kind: "identifier", isDirectLiteral: false, boundedSummary: summaryFor("identifier") };
  }

  return { kind: "dynamic-unsupported", isDirectLiteral: false, boundedSummary: summaryFor("dynamic-unsupported") };
}
