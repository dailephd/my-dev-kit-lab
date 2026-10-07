import type { RetrievalEvidenceAvailability } from "../../../evaluation/retrievalQuality/types.js";
import type { TaskLocality } from "../../../evaluation/types.js";

/** Domain schema of the Lab-owned experimental context pack. It is a measurement artifact, not a production contract. */
export const CONTEXT_PACK_SCHEMA_VERSION = "my-dev-kit-lab-context-pack-experiment-v1";

/** Reuses the existing retrieval availability vocabulary; no second equivalent model. */
export type ContextPackAvailability = RetrievalEvidenceAvailability;

/** Logical section order of the pack. */
export const CONTEXT_PACK_SECTION_IDS = [
  "task",
  "files",
  "symbols",
  "sourceSlices",
  "callRelationships",
  "tests",
  "evidenceNotes"
] as const;

export type ContextPackSectionId = (typeof CONTEXT_PACK_SECTION_IDS)[number];

/**
 * Closed fixed vocabulary. Only codes produced by the pure Batch 1 domain exist; no free-form warning text, and no
 * execution, indexing, privacy or persistence failure codes.
 */
export const CONTEXT_PACK_EVIDENCE_NOTE_CODES = [
  "symbol-end-unknown",
  "source-slice-cap-reached",
  "total-source-line-cap-reached",
  "source-slice-count-cap-reached",
  "seed-cap-reached",
  "file-cap-reached",
  "symbol-cap-reached",
  "test-file-cap-reached",
  "call-relationship-cap-reached",
  "invalid-repository-path-ignored",
  "invalid-source-slice-ignored"
] as const;

export type ContextPackEvidenceNoteCode = (typeof CONTEXT_PACK_EVIDENCE_NOTE_CODES)[number];

/** Which my-dev-kit command family surfaced an item. */
export type ContextPackProvenanceCommand = "search" | "lookup" | "slice" | "source";

export type ContextPackProvenance = {
  command: ContextPackProvenanceCommand;
  nodeId: string | null;
  /** Upstream rank of the evidence, or null when none applies. */
  rank: number | null;
};

export type ContextPackFileReason = "search-candidate" | "lookup-evidence" | "graph-neighbor" | "test-candidate";

export type ContextPackFile = {
  path: string;
  /** Upstream rank of the best evidence for this file. */
  rank: number;
  reason: ContextPackFileReason;
  provenance: ContextPackProvenance[];
};

export type ContextPackSymbol = {
  name: string;
  nodeId: string | null;
  file: string | null;
  rank: number;
  /** Definition line when upstream provided one. */
  line: number | null;
  provenance: ContextPackProvenance[];
};

export type ContextPackSourceSlice = {
  file: string;
  nodeId: string | null;
  symbolName: string | null;
  startLine: number;
  endLine: number;
  lineCount: number;
  /** Verbatim bounded source text, LF normalized, without a trailing newline. */
  text: string;
  /** False when the semantic end of the symbol is not known (upstream `symbol-end-unknown`). */
  boundaryKnown: boolean;
  truncated: boolean;
  continuationAvailable: boolean;
  provenance: ContextPackProvenance[];
};

/** Only actual call relationships belong in the pack. */
export type ContextPackCallRelationshipKind = "calls";

export type ContextPackCallRelationship = {
  fromNodeId: string;
  toNodeId: string;
  kind: ContextPackCallRelationshipKind;
  provenance: ContextPackProvenance[];
};

export type ContextPackTestOrigin = "graph-neighbor" | "search-candidate";

export type ContextPackTest = {
  path: string;
  rank: number | null;
  how: ContextPackTestOrigin;
  provenance: ContextPackProvenance[];
};

export type ContextPackTask = {
  title: string;
  summary: string;
};

/** The complete frozen selection policy, recorded on every pack. */
export type ContextPackSelectionPolicy = {
  id: string;
  searchResultLimit: number;
  maxSeedNodes: number;
  graphDepth: number;
  maxFiles: number;
  maxSymbols: number;
  maxSourceSlices: number;
  maxSourceLinesPerSlice: number;
  maxTotalSourceLines: number;
  maxTestFiles: number;
  maxCallRelationships: number;
  myDevKitVersion: string;
};

/** Explicit caller-supplied availability; the pure builder never derives it from absence alone. */
export type ContextPackSectionAvailabilityInput = {
  availability: ContextPackAvailability;
  reason: string | null;
};

export type ContextPackSectionSummary = {
  id: ContextPackSectionId;
  availability: ContextPackAvailability;
  reason: string | null;
  itemCount: number;
  /** Measured from this section's exact rendered string. */
  estimatedTokens: number;
};

export type ContextPackSize = {
  totalChars: number;
  totalEstimatedTokens: number;
  tokenCountMethod: string;
};

export type ContextPack = {
  schemaVersion: typeof CONTEXT_PACK_SCHEMA_VERSION;
  caseId: string;
  benchmarkProject: string;
  taskLocality: TaskLocality | null;
  task: ContextPackTask;
  selectionPolicy: ContextPackSelectionPolicy;
  files: ContextPackFile[];
  symbols: ContextPackSymbol[];
  sourceSlices: ContextPackSourceSlice[];
  callRelationships: ContextPackCallRelationship[];
  tests: ContextPackTest[];
  evidenceNotes: ContextPackEvidenceNoteCode[];
  sections: ContextPackSectionSummary[];
  /** Measured from `renderedText` only. */
  size: ContextPackSize;
  availability: ContextPackAvailability;
  reason: string | null;
  renderedText: string;
};
