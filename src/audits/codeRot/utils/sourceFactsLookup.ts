import type { SourceFactsSnapshot, SourceFileFacts } from "../../core/sourceFacts.js";
import { baseNameNoExt } from "./filePatternUtils.js";
import type { KitSourceReader } from "../../core/kitSourceProvider.js";
import { createHash } from "node:crypto";
import { KitSourceEvidenceAcquisitionError, qualifyKitImportPredicate, type KitOccurrence } from "../../core/kitSourceEvidence.js";

export function requireCompleteKitOccurrence(result: KitOccurrence): KitOccurrence {
  if (!result.complete) throw new KitSourceEvidenceAcquisitionError("capability-insufficient",
    `${result.filePath} literal ${JSON.stringify(result.value)} is incomplete (${result.reasonCode}).`);
  return result;
}

// A conservative bridge for the existing whole-content regex predicates.
// A nonzero anchor needs whole-file text. The separately qualified range
// reader verifies original bytes; occurrence windows are never enlarged.
export async function kitPredicateContent(reader: KitSourceReader | undefined, filePath: string, anchors: readonly string[], byteNeighborhood = false): Promise<string> {
  if (!reader) throw new KitSourceEvidenceAcquisitionError("invalid-request", `${filePath} requires its validated Kit source reader.`);
  const file = reader.selectedFile(filePath);
  for (const anchor of anchors) {
    const result = requireCompleteKitOccurrence(await reader.occurrences(filePath, anchor));
    if (!result.matchCount) continue;
    // Qualified selected JSON may have no semantic line count. Whole-byte
    // identity establishes raw context without creating semantic capabilities.
    if (filePath.endsWith(".json") && reader.authenticatedContent && file.contentSha256) {
      let wholeByteLength = false;
      for (const match of result.matches) {
        for (const text of [match.content, match.content + "\n", match.content.replace(/\n/g, "\r\n"), match.content.replace(/\n/g, "\r\n") + "\r\n"]) {
          if (Buffer.byteLength(text, "utf8") !== file.sizeBytes) continue;
          wholeByteLength = true;
          if (createHash("sha256").update(text, "utf8").digest("hex") === file.contentSha256) return text;
        }
      }
      if (wholeByteLength) throw new KitSourceEvidenceAcquisitionError("stale-evidence", `${filePath} JSON windows differ from authenticated file bytes.`);
    }
    const whole = result.matches.find((match) => match.windowStart === 1 && file.lineCount !== null &&
      (match.windowEnd === file.lineCount || (match.windowEnd === file.lineCount - 1 && match.windowEnd < match.line + 40)) &&
      (!byteNeighborhood || Buffer.byteLength(match.content, "utf8") === file.sizeBytes || Buffer.byteLength(match.content, "utf8") + 1 === file.sizeBytes));
    if (!whole && reader.authenticatedContent) return reader.authenticatedContent(filePath);
    if (!whole) throw new KitSourceEvidenceAcquisitionError("capability-insufficient",
      `${filePath} has insufficient contiguous source context for the original predicate (including newline identity).`);
    return whole.content;
  }
  return "";
}

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

// Import consumers must not discard authenticated complete imports merely
// because an unrelated declaration capability downgraded the file status.
export function getImportSourceFacts(index: Map<string, SourceFileFacts>, relativePath: string): SourceFileFacts | null {
  const facts = index.get(relativePath);
  return facts && (facts.kit ? qualifyKitImportPredicate(facts) === "QUALIFIED_NEGATIVE" : facts.parseStatus === "parsed") ? facts : null;
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
    for (const imp of file.imports) {
      if (file.kit ? qualifyKitImportPredicate(file, imp) !== "QUALIFIED_POSITIVE" : file.parseStatus !== "parsed") continue;
      if (!imp.source.startsWith(".")) continue;
      const base = baseNameNoExt(imp.source.split("?")[0]);
      basenames.add(base.toLowerCase());
    }
  }
  return basenames;
}
