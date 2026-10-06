import { compareCodeUnits } from "../../../evaluation/indexSnapshot.js";
import { normalizeRetrievedRepositoryPath } from "../../../evaluation/retrievalQuality/buildRetrievalEvidence.js";
import type { RetrievalQualityIdentityEvidence } from "../../../evaluation/retrievalQuality/metrics.js";
import type { ContextPack, ContextPackAvailability } from "./types.js";

/**
 * Minimal structural view of an already-validated my-dev-kit `symbol-index` file entry. These helpers never read the
 * index from disk, never run my-dev-kit, and never consult the benchmark answer key.
 */
export type IndexedSourceFileSymbols = {
  path: string;
  symbols: readonly { name: string; location: { line: number } }[];
};

type SymbolIdentity = { name: string; file?: string };

function canonicalSymbols(identities: Iterable<SymbolIdentity>): SymbolIdentity[] {
  const unique = new Map<string, SymbolIdentity>();
  for (const identity of identities) unique.set(`${identity.file ?? ""}\0${identity.name}`, identity);
  return [...unique.values()].sort((a, b) => compareCodeUnits(a.file ?? "", b.file ?? "") || compareCodeUnits(a.name, b.name));
}

/** Raw-full-file rule: every indexed symbol defined in a file the raw baseline actually included. */
export function collectRawFullFileSymbols(
  indexedFiles: readonly IndexedSourceFileSymbols[],
  includedFiles: readonly string[]
): { name: string; file: string }[] {
  const included = new Set<string>();
  for (const file of includedFiles) {
    const normalized = normalizeRetrievedRepositoryPath(file);
    if (normalized !== null) included.add(normalized);
  }
  const found: SymbolIdentity[] = [];
  for (const entry of indexedFiles) {
    const path = normalizeRetrievedRepositoryPath(entry.path);
    if (path === null || !included.has(path)) continue;
    for (const symbol of entry.symbols) found.push({ name: symbol.name, file: path });
  }
  return canonicalSymbols(found) as { name: string; file: string }[];
}

/**
 * Context-pack rule: the union of the explicitly selected symbols and the indexed symbols whose definition line falls
 * inside a selected (post-cap) source slice range of the same file.
 */
export function collectContextPackSymbols(
  pack: Pick<ContextPack, "symbols" | "sourceSlices">,
  indexedFiles: readonly IndexedSourceFileSymbols[]
): SymbolIdentity[] {
  const found: SymbolIdentity[] = pack.symbols.map((symbol) => (symbol.file === null ? { name: symbol.name } : { name: symbol.name, file: symbol.file }));
  for (const entry of indexedFiles) {
    const path = normalizeRetrievedRepositoryPath(entry.path);
    if (path === null) continue;
    const slices = pack.sourceSlices.filter((slice) => slice.file === path);
    if (slices.length === 0) continue;
    for (const symbol of entry.symbols) {
      if (slices.some((slice) => symbol.location.line >= slice.startLine && symbol.location.line <= slice.endLine)) {
        found.push({ name: symbol.name, file: path });
      }
    }
  }
  return canonicalSymbols(found);
}

type AvailabilityInput = { availability: ContextPackAvailability; reason: string | null };

const withReason = (input: AvailabilityInput): { availability: ContextPackAvailability; availabilityReason?: string } =>
  input.reason === null ? { availability: input.availability } : { availability: input.availability, availabilityReason: input.reason };

/** Context-pack identity evidence for the existing retrieval-quality calculator. Tests stay descriptive and are excluded. */
export function buildContextPackIdentityEvidence(
  pack: Pick<ContextPack, "files" | "symbols" | "sourceSlices" | "availability" | "reason">,
  indexedFiles: readonly IndexedSourceFileSymbols[]
): RetrievalQualityIdentityEvidence {
  const files = new Set<string>([...pack.files.map((file) => file.path), ...pack.sourceSlices.map((slice) => slice.file)]);
  return {
    ...withReason({ availability: pack.availability, reason: pack.reason }),
    files: [...files].sort(compareCodeUnits),
    symbols: collectContextPackSymbols(pack, indexedFiles)
  };
}

/** Raw-full-file identity evidence; availability is supplied by the caller, never inferred from an empty list. */
export function buildRawFullFileIdentityEvidence(input: {
  includedFiles: readonly string[];
  indexedFiles: readonly IndexedSourceFileSymbols[];
  availability: ContextPackAvailability;
  reason: string | null;
}): RetrievalQualityIdentityEvidence {
  const files = new Set<string>();
  for (const file of input.includedFiles) {
    const normalized = normalizeRetrievedRepositoryPath(file);
    if (normalized !== null) files.add(normalized);
  }
  return {
    ...withReason(input),
    files: [...files].sort(compareCodeUnits),
    symbols: collectRawFullFileSymbols(input.indexedFiles, input.includedFiles)
  };
}
