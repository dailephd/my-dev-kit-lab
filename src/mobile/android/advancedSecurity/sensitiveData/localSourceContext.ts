// ---------------------------------------------------------------------------
// v0.4.1 Batch 6 — narrow shared local Java/Kotlin source-context helpers.
//
// Extracted (not copied verbatim) from the bounded masking/scope technique
// Batch 5's WebView analyzer implemented privately in
// advancedSecurity/webview/checkResult.ts. That file is left completely
// unchanged (its own mask/scope logic stays inline) — this module is new,
// additive code used only by the four Batch 6 analyzers, generalized just
// enough to be language-general rather than SSL-callback-specific. It is
// NOT a compiler front end: no AST, no symbol resolution, no cross-method
// data flow. It only offers:
//   - executableMask(): comment/string-masked text with byte-for-byte
//     preserved offsets and line breaks, so downstream regexes never match
//     inside a comment or a string literal, and reported line numbers stay
//     correct against the original source.
//   - methodScopes(): brace-depth-bounded method-like ranges (used for
//     same-method correlation only — never cross-method).
//   - lineForOffset(): 1-based line number for a byte offset.
// ---------------------------------------------------------------------------

export type MethodScope = { from: number; to: number; id: number };

const STRING_OR_COMMENT = /"""[\s\S]*?"""|"(?:[^"\\\n]|\\.)*"|'(?:[^'\\\n]|\\.)*'|\/\/[^\n]*|\/\*[\s\S]*?\*\//g;

// Masks comment and string/char contents with spaces (preserving embedded
// newlines) so line numbers and offsets never shift and downstream regexes
// never match text that only appears inside a comment or a literal.
export function executableMask(source: string): string {
  return source.replace(STRING_OR_COMMENT, (match) => match.replace(/[^\n]/g, " "));
}

export function lineForOffset(source: string, offset: number): number {
  let line = 1;
  for (let i = 0; i < offset && i < source.length; i += 1) {
    if (source[i] === "\n") line += 1;
  }
  return line;
}

const METHOD_HEADER = /(?:fun|void|[A-Za-z_$][\w$.<>,?\[\] ]*?)\s+[A-Za-z_$][\w$]*\s*\([^)]*\)[^{;]*\{/g;

function braceEnd(mask: string, openBraceIndex: number): number {
  let depth = 0;
  for (let i = openBraceIndex; i < mask.length; i += 1) {
    if (mask[i] === "{") depth += 1;
    else if (mask[i] === "}") {
      depth -= 1;
      if (depth === 0) return i;
    }
  }
  return mask.length - 1;
}

// Bounded, best-effort method-like scope extraction over already-masked
// text. Overlapping/nested matches are tolerated (each open-brace found by
// the header regex gets its own scope) — callers only use scope identity for
// "same enclosing scope" correlation, never for accurate call-graph shape.
export function methodScopes(mask: string): MethodScope[] {
  const scopes: MethodScope[] = [];
  let match: RegExpExecArray | null;
  let id = 0;
  METHOD_HEADER.lastIndex = 0;
  while ((match = METHOD_HEADER.exec(mask)) !== null) {
    const openBrace = match.index + match[0].length - 1;
    if (mask[openBrace] !== "{") continue;
    const close = braceEnd(mask, openBrace);
    scopes.push({ from: match.index, to: close, id });
    id += 1;
  }
  return scopes;
}

// Innermost (smallest-span) scope containing offset, or undefined if offset
// is not inside any recognized method-like range (e.g. field initializer).
export function scopeAt(scopes: readonly MethodScope[], offset: number): MethodScope | undefined {
  let best: MethodScope | undefined;
  for (const scope of scopes) {
    if (offset >= scope.from && offset <= scope.to) {
      if (best === undefined || scope.to - scope.from < best.to - best.from) best = scope;
    }
  }
  return best;
}

// Same-method correlation: true only when both offsets resolve to the same
// enclosing scope id (or both resolve to no scope, treated as file-level and
// therefore not correlated across arbitrary distance — callers should apply
// an additional bounded-distance check for the no-scope case).
export function sameScope(scopes: readonly MethodScope[], offsetA: number, offsetB: number): boolean {
  const a = scopeAt(scopes, offsetA);
  const b = scopeAt(scopes, offsetB);
  if (a === undefined || b === undefined) return false;
  return a.id === b.id;
}
