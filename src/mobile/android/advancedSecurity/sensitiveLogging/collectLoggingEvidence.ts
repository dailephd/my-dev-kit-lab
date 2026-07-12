import { executableMask, lineForOffset } from "../sensitiveData/localSourceContext.js";
import { splitTopLevelArguments } from "../sensitiveData/splitArguments.js";
import type { LoggingMatch, LoggingMatchKind } from "./types.js";

// ---------------------------------------------------------------------------
// v0.4.1 Batch 6 — bounded direct evidence collection for sensitive-logging
// sinks (Android Log, Timber, stdout/stderr, printStackTrace, and
// Crashlytics payload sinks). Purely lexical, over comment/string-masked
// text with argument text re-sliced from the original content via regex
// match indices (see sensitiveStorage/collectStorageEvidence.ts for the same
// pattern and its rationale). Nothing here constructs CandidateEvidence or
// SecurityFinding.
// ---------------------------------------------------------------------------

const LOG_CALL = /\bLog\.(v|d|i|w|e|wtf|println)\s*\(([^;\n]*?)\)/gd;
const TIMBER_CALL = /\bTimber\.(v|d|i|w|e|wtf|log|tag)\s*\(([^;\n]*?)\)/gd;
const STDOUT_CALL = /(System\.out|System\.err)\.(print|println)\s*\(([^;\n]*?)\)/gd;
const KOTLIN_PRINT = /(?<![.\w])(print|println)\s*\(([^;\n]*?)\)/gd;
const PRINT_STACK_TRACE = /([A-Za-z_][\w.]*)\.printStackTrace\s*\(\s*\)/gd;
const CRASHLYTICS_CALL = /\b(FirebaseCrashlytics(?:\.getInstance\(\))?|crashlytics)\.(log|setCustomKey|setUserId|recordException)\s*\(([^;\n]*?)\)/gd;
const IS_LOGGABLE = /\bLog\.isLoggable\s*\(([^;\n]*?)\)/gd;
const DEBUG_GUARD_WINDOW = 3;

type IndexedMatch = RegExpMatchArray & { indices?: Array<[number, number] | undefined> };

function realGroup(content: string, match: IndexedMatch, group: number): string | undefined {
  const span = match.indices?.[group];
  if (!span) return match[group];
  return content.slice(span[0], span[1]);
}

function isDebugGuarded(content: string, offset: number): boolean {
  const startLine = lineForOffset(content, offset) - DEBUG_GUARD_WINDOW;
  const lines = content.split("\n");
  const from = Math.max(0, startLine - 1);
  const window = lines.slice(from, lineForOffset(content, offset)).join("\n");
  return /BuildConfig\.DEBUG|\bDEBUG\b/.test(window);
}

function push(list: LoggingMatch[], content: string, kind: LoggingMatchKind, api: string, offset: number, extra: Partial<LoggingMatch>): void {
  list.push({
    kind,
    api,
    debugGuarded: isDebugGuarded(content, offset),
    offset,
    line: lineForOffset(content, offset),
    ...extra,
  });
}

export function collectLoggingEvidence(content: string): LoggingMatch[] {
  const mask = executableMask(content);
  const matches: LoggingMatch[] = [];

  for (const match of mask.matchAll(LOG_CALL) as IterableIterator<IndexedMatch>) {
    const offset = match.index ?? 0;
    const args = splitTopLevelArguments(realGroup(content, match, 2) ?? "");
    if (match[1] === "println") {
      push(matches, content, "log", `Log.println`, offset, { messageExpression: args[args.length - 1], tagExpression: args[1] });
      continue;
    }
    push(matches, content, "log", `Log.${match[1]}`, offset, { tagExpression: args[0], messageExpression: args[1], throwableExpression: args[2] });
  }

  for (const match of mask.matchAll(IS_LOGGABLE) as IterableIterator<IndexedMatch>) {
    const offset = match.index ?? 0;
    push(matches, content, "isloggable", "Log.isLoggable", offset, {});
  }

  for (const match of mask.matchAll(TIMBER_CALL) as IterableIterator<IndexedMatch>) {
    const offset = match.index ?? 0;
    const args = splitTopLevelArguments(realGroup(content, match, 2) ?? "");
    push(matches, content, "timber", `Timber.${match[1]}`, offset, { messageExpression: args[0], throwableExpression: args[1] });
  }

  for (const match of mask.matchAll(STDOUT_CALL) as IterableIterator<IndexedMatch>) {
    const offset = match.index ?? 0;
    const args = splitTopLevelArguments(realGroup(content, match, 3) ?? "");
    push(matches, content, "stdout", `${match[1]}.${match[2]}`, offset, { messageExpression: args[0] });
  }

  for (const match of mask.matchAll(KOTLIN_PRINT) as IterableIterator<IndexedMatch>) {
    const offset = match.index ?? 0;
    const args = splitTopLevelArguments(realGroup(content, match, 2) ?? "");
    push(matches, content, "stdout", match[1], offset, { messageExpression: args[0] });
  }

  for (const match of mask.matchAll(PRINT_STACK_TRACE) as IterableIterator<IndexedMatch>) {
    const offset = match.index ?? 0;
    push(matches, content, "print-stack-trace", "printStackTrace", offset, { throwableExpression: match[1] });
  }

  for (const match of mask.matchAll(CRASHLYTICS_CALL) as IterableIterator<IndexedMatch>) {
    const offset = match.index ?? 0;
    const args = splitTopLevelArguments(realGroup(content, match, 3) ?? "");
    push(matches, content, "crashlytics", `Crashlytics.${match[2]}`, offset, {
      tagExpression: match[2] === "setCustomKey" ? args[0] : undefined,
      messageExpression: args[match[2] === "setCustomKey" ? 1 : 0],
    });
  }

  return matches.sort((a, b) => a.offset - b.offset);
}
