import type { SourceFactsSnapshot, SourceFileFacts } from "../../core/sourceFacts.js";
import { baseNameNoExt } from "./filePatternUtils.js";

// ---------------------------------------------------------------------------
// v0.3.1 Batch 4 -- shared source-facts lookup helpers for code-rot
// detectors.
//
// ctx.sourceFacts is optional (see auditRegistry.ts) precisely so existing
// detector tests that build a literal AuditDetectorContext without it keep
// working unchanged -- every helper here accepts `undefined` and degrades to
// an empty result rather than throwing, so a caller never needs its own
// null-check before using them.
// ---------------------------------------------------------------------------

// Indexes a SourceFactsSnapshot's files by relativePath for O(1) per-file
// lookups. Returns an empty map when sourceFacts is undefined.
export function indexSourceFactsByPath(sourceFacts?: SourceFactsSnapshot): Map<string, SourceFileFacts> {
  const index = new Map<string, SourceFileFacts>();
  if (!sourceFacts) return index;
  for (const file of sourceFacts.files) index.set(file.relativePath, file);
  return index;
}

// Returns the facts for relativePath only when parseStatus is "parsed" --
// callers that want analyzer-derived evidence (imports/exports/declarations)
// should use this rather than reading the index directly, since
// file-level-only/parse-error/skipped/unsupported entries carry empty fact
// arrays that would silently look like "no imports" rather than "unknown".
export function getParsedSourceFacts(
  index: Map<string, SourceFileFacts>,
  relativePath: string
): SourceFileFacts | null {
  const facts = index.get(relativePath);
  return facts && facts.parseStatus === "parsed" ? facts : null;
}

// Basenames referenced by any parsed file's relative import/re-export
// specifier, lowercased. Mirrors deadCodeCandidateDetector.ts's regex-based
// buildReverseReferenceIndex() basename matching, but sourced from
// structured analyzer facts -- so it also catches import forms the regex
// misses (e.g. multi-line import statements) for files a registered
// analyzer actually parsed. Returns an empty set when sourceFacts is
// undefined, so merging it into an existing Set is always safe.
export function collectRelativeImportBasenames(sourceFacts?: SourceFactsSnapshot): Set<string> {
  const basenames = new Set<string>();
  if (!sourceFacts) return basenames;
  for (const file of sourceFacts.files) {
    if (file.parseStatus !== "parsed") continue;
    for (const imp of file.imports) {
      if (!imp.source.startsWith(".")) continue;
      const base = baseNameNoExt(imp.source.split("?")[0]);
      basenames.add(base.toLowerCase());
    }
  }
  return basenames;
}
