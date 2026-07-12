// ---------------------------------------------------------------------------
// v0.4.1 Batch 6 — shared bounded top-level argument splitter.
//
// Splits a call's argument text on top-level commas only (commas nested
// inside (), [], {}, or string/char literals are not split points). Used by
// all four Batch 6 analyzers to pull individual arguments out of an already
// bounded, already-masked-for-comments call match. Not a parser: does not
// understand trailing lambdas, named/default arguments beyond a literal
// `name = value` prefix strip, or varargs semantics.
// ---------------------------------------------------------------------------

const MAX_ARGUMENTS = 12;

export function splitTopLevelArguments(argsText: string): string[] {
  const args: string[] = [];
  let depth = 0;
  let current = "";
  let quote: string | undefined;
  for (let i = 0; i < argsText.length; i += 1) {
    const ch = argsText[i];
    if (quote) {
      current += ch;
      if (ch === "\\") {
        i += 1;
        if (i < argsText.length) current += argsText[i];
        continue;
      }
      if (ch === quote) quote = undefined;
      continue;
    }
    if (ch === '"' || ch === "'") {
      quote = ch;
      current += ch;
      continue;
    }
    if (ch === "(" || ch === "[" || ch === "{") {
      depth += 1;
      current += ch;
      continue;
    }
    if (ch === ")" || ch === "]" || ch === "}") {
      depth -= 1;
      current += ch;
      continue;
    }
    if (ch === "," && depth === 0) {
      args.push(current.trim());
      current = "";
      if (args.length >= MAX_ARGUMENTS) break;
      continue;
    }
    current += ch;
  }
  if (current.trim().length > 0 || args.length === 0) args.push(current.trim());
  // Strip a leading `name = ` Kotlin named-argument prefix, if present.
  return args.map((arg) => arg.replace(/^[A-Za-z_$][\w$]*\s*=\s*(?!=)/, ""));
}
