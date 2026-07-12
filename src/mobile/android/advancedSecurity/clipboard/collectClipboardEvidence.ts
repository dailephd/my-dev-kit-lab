import { executableMask, lineForOffset, methodScopes, scopeAt } from "../sensitiveData/localSourceContext.js";
import { splitTopLevelArguments } from "../sensitiveData/splitArguments.js";
import type { ClipboardMatch, ClipboardMatchKind } from "./types.js";

// ---------------------------------------------------------------------------
// v0.4.1 Batch 6 — bounded direct evidence collection for clipboard APIs
// (ClipData creation, setPrimaryClip/getPrimaryClip/clearPrimaryClip, legacy
// android.text.ClipboardManager, and the EXTRA_IS_SENSITIVE marker). Purely
// lexical over comment/string-masked text, argument text re-sliced from
// original content via regex match indices — see
// sensitiveStorage/collectStorageEvidence.ts for the same pattern.
// ---------------------------------------------------------------------------

// Greedy (not lazy) argument capture: setPrimaryClip's single argument is
// frequently itself a nested ClipData.newPlainText(...) call, and a lazy
// quantifier would stop at that inner call's closing paren instead of the
// outer call's. Still bounded to one statement by excluding newlines/`;`.
const CLIP_CREATE = /(?:(?:val|var|ClipData)\s+([A-Za-z_]\w*)\s*=\s*)?ClipData\.(newPlainText|newHtmlText|newUri)\s*\(([^;\n]*)\)/gd;
const CLIP_SET = /([A-Za-z_][\w.]*)\.setPrimaryClip\s*\(([^;\n]*)\)/gd;
const LEGACY_SET_TEXT = /([A-Za-z_][\w.]*[Cc]lipboard[A-Za-z_]*)\.setText\s*\(([^;\n]*)\)/gd;
const CLIP_GET_CALL = /([A-Za-z_][\w.]*)\.(getPrimaryClip|hasPrimaryClip|getItemAt|coerceToText)\s*\(([^;\n]*?)\)/gd;
const CLIP_GET_PROPERTY = /([A-Za-z_][\w.]*[Cc]lipboard[A-Za-z_]*)\.(primaryClip|hasText)\b(?!\s*\()/gd;
const LEGACY_GET_TEXT = /([A-Za-z_][\w.]*[Cc]lipboard[A-Za-z_]*)\.getText\s*\(\s*\)/gd;
const CLIP_CLEAR = /([A-Za-z_][\w.]*)\.clearPrimaryClip\s*\(\s*\)/gd;
const SENSITIVE_MARKER = /\bClipDescription\.EXTRA_IS_SENSITIVE\b/g;

type IndexedMatch = RegExpMatchArray & { indices?: Array<[number, number] | undefined> };

function realGroup(content: string, match: IndexedMatch, group: number): string | undefined {
  const span = match.indices?.[group];
  if (!span) return match[group];
  return content.slice(span[0], span[1]);
}

function push(list: ClipboardMatch[], content: string, scopes: ReturnType<typeof methodScopes>, kind: ClipboardMatchKind, api: string, offset: number, extra: Partial<ClipboardMatch>): void {
  list.push({ kind, api, offset, line: lineForOffset(content, offset), scopeId: scopeAt(scopes, offset)?.id, ...extra });
}

export function collectClipboardEvidence(content: string): ClipboardMatch[] {
  const mask = executableMask(content);
  const scopes = methodScopes(mask);
  const matches: ClipboardMatch[] = [];

  for (const match of mask.matchAll(CLIP_CREATE) as IterableIterator<IndexedMatch>) {
    const offset = match.index ?? 0;
    const args = splitTopLevelArguments(realGroup(content, match, 3) ?? "");
    push(matches, content, scopes, "clip-create", `ClipData.${match[2]}`, offset, {
      assignedVariable: match[1],
      labelExpression: args[0],
      valueExpression: args[1],
    });
  }

  for (const match of mask.matchAll(CLIP_SET) as IterableIterator<IndexedMatch>) {
    const offset = match.index ?? 0;
    const args = splitTopLevelArguments(realGroup(content, match, 2) ?? "");
    push(matches, content, scopes, "clip-set", "ClipboardManager.setPrimaryClip", offset, {
      receiver: match[1],
      argumentExpression: args[0],
    });
  }

  for (const match of mask.matchAll(LEGACY_SET_TEXT) as IterableIterator<IndexedMatch>) {
    const offset = match.index ?? 0;
    const args = splitTopLevelArguments(realGroup(content, match, 2) ?? "");
    push(matches, content, scopes, "legacy-set-text", "ClipboardManager.setText", offset, {
      receiver: match[1],
      valueExpression: args[0],
    });
  }

  for (const match of mask.matchAll(CLIP_GET_CALL) as IterableIterator<IndexedMatch>) {
    const offset = match.index ?? 0;
    push(matches, content, scopes, "clip-get", `ClipboardManager.${match[2]}`, offset, { receiver: match[1] });
  }

  for (const match of mask.matchAll(CLIP_GET_PROPERTY) as IterableIterator<IndexedMatch>) {
    const offset = match.index ?? 0;
    push(matches, content, scopes, "clip-get", `ClipboardManager.${match[2]}`, offset, { receiver: match[1] });
  }

  for (const match of mask.matchAll(LEGACY_GET_TEXT) as IterableIterator<IndexedMatch>) {
    const offset = match.index ?? 0;
    push(matches, content, scopes, "clip-get", "ClipboardManager.getText", offset, { receiver: match[1] });
  }

  for (const match of mask.matchAll(CLIP_CLEAR) as IterableIterator<IndexedMatch>) {
    const offset = match.index ?? 0;
    push(matches, content, scopes, "clip-clear", "ClipboardManager.clearPrimaryClip", offset, { receiver: match[1] });
  }

  for (const match of mask.matchAll(SENSITIVE_MARKER)) {
    const offset = match.index ?? 0;
    push(matches, content, scopes, "sensitive-marker", "ClipDescription.EXTRA_IS_SENSITIVE", offset, {});
  }

  return matches.sort((a, b) => a.offset - b.offset);
}
