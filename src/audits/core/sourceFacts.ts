import type { FileRole, NormalizedLanguage } from "./projectInventory.js";

// ---------------------------------------------------------------------------
// v0.3.1 Batch 2 -- normalized source facts model.
//
// Purely additive substrate: no concrete language analyzer exists yet (that
// is Batch 3's TypeScript/JavaScript analyzer), so every SourceFileFacts
// produced in this batch is either a deterministic fallback (see
// collectSourceFacts.ts) or a parse-error record. The fact arrays
// (imports/exports/declarations/references) are always empty in this batch
// -- the shape exists so Batch 3 can populate them without a type change.
// ---------------------------------------------------------------------------

export const SOURCE_FACT_PARSE_STATUSES = [
  "parsed",
  "file-level-only",
  "unsupported",
  "parse-error",
  "skipped",
] as const;
export type SourceFactParseStatus = (typeof SOURCE_FACT_PARSE_STATUSES)[number];

export type SourceFactDiagnosticSeverity = "info" | "warning" | "error";

export type SourceFactDiagnostic = {
  severity: SourceFactDiagnosticSeverity;
  code: string;
  message: string;
  path: string;
  analyzerId: string | null;
};

// v0.10.0 Gate 3 -- additive producer attribution. Facts adapted from the
// managed Kit source-evidence bridge carry the Kit fact identity and span;
// facts produced by the legacy native analyzers never set these fields, so
// the two producers stay distinguishable by `SourceFactsSnapshot.provider`.
export type SourceFactProvenance = {
  producer: "kit";
  factId: string;
  extractionMethod: string;
  startLine: number;
  startColumn: number | null;
  endLine: number | null;
  endColumn: number | null;
};

export type SourceFactVisibility = "public" | "protected" | "private" | "internal" | "package" | "unknown";
// "unknown" means the producer could not decide; it is never a "not exported"
// claim even though the legacy boolean `exported` has to hold a value.
export type SourceFactExportState = "exported" | "not-exported" | "unknown";

// v0.3.1 Batch 3 -- "re-export" added for `export ... from "module"` forms,
// which reference a module specifier the same way an import does but are
// syntactically export statements (see typescriptJavaScriptAnalyzer.ts).
export type ImportFactKind = "static" | "dynamic" | "commonjs" | "re-export" | "unknown";
export type ImportFact = {
  source: string;
  kind: ImportFactKind;
  // v0.3.1 Batch 3 -- optional, analyzer-populated: local binding names
  // introduced by the import (default/namespace/named), when straightforward
  // to determine from syntax alone.
  importedNames?: string[];
  line?: number;
  // v0.10.0 Gate 3 -- additive, Kit-backed facts only.
  importResolution?: string;
  targetPaths?: string[];
  provenance?: SourceFactProvenance;
};

export type ExportFactKind = "named" | "default" | "namespace" | "commonjs" | "unknown";
export type ExportFact = {
  name: string;
  kind: ExportFactKind;
  line?: number;
  // v0.10.0 Gate 3 -- additive, Kit-backed facts only.
  exportOrigin?: string;
  visibility?: SourceFactVisibility;
  provenance?: SourceFactProvenance;
};

export type DeclarationFactKind =
  | "function"
  | "class"
  | "interface"
  | "type"
  | "variable"
  | "constant"
  | "enum"
  | "method"
  | "unknown";
export type DeclarationFact = {
  name: string;
  kind: DeclarationFactKind;
  exported: boolean;
  line?: number;
  // v0.10.0 Gate 3 -- additive, Kit-backed facts only. `exportState` keeps
  // producer uncertainty the legacy boolean cannot express.
  exportState?: SourceFactExportState;
  exportOrigin?: string;
  visibility?: SourceFactVisibility;
  ownerKey?: string | null;
  // Raw producer declaration kind when it was mapped to "unknown"
  // (object, record, annotation, ...).
  providerKind?: string;
  // Canonical producer identities, distinct from a simple declaration name.
  // Missing means unqualified; consumers must not derive them from a basename.
  symbolId?: string;
  jvmDeclaration?: {
    packageName: string;
    qualifiedName: string;
    role: "type" | "kotlin-top-level-function" | "kotlin-top-level-property";
  };
  provenance?: SourceFactProvenance;
};

export type ReferenceFact = {
  name: string;
  kind?: string;
  line?: number;
};

// v0.10.0 Gate 3 -- producer-side file evidence kept next to the adapted
// Lab facts so Kit uncertainty is never lost in the mapping.
export type SourceFileKitEvidence = {
  producerLanguage: string;
  // Empty string is the qualified default package; absence remains unknown.
  jvmPackageName?: string;
  producerRole: string;
  producerStatus: string;
  contentSha256: string | null;
  capabilities: Record<string, string>;
};

export type SourceFileFacts = {
  relativePath: string;
  language: NormalizedLanguage;
  role: FileRole;
  parseStatus: SourceFactParseStatus;
  // Id of the LanguageAnalyzer that produced these facts, or null when the
  // file was handled by fallback/skip policy (collectSourceFacts.ts) rather
  // than a registered analyzer.
  analyzerId: string | null;
  // Carried over from the Batch 1 inventory entry when available -- cheap,
  // already-computed evidence that doesn't require an analyzer.
  lineCount?: number;
  // v0.10.0 Gate 3 -- additive. Absent on legacy-analyzer records.
  kit?: SourceFileKitEvidence;
  imports: ImportFact[];
  exports: ExportFact[];
  declarations: DeclarationFact[];
  references: ReferenceFact[];
  diagnostics: SourceFactDiagnostic[];
};

// v0.10.0 Gate 3 -- which provider produced a snapshot. "not-collected" is an
// explicit empty snapshot for runs whose selected detectors need no source
// evidence; it is not a statement that the target has no source.
export type SourceFactsProvider = "kit" | "legacy-comparison" | "not-collected";

export type SourceFactsKitSummary = {
  packageName: string;
  packageVersion: string;
  artifactSchemaVersion: string;
  extractorRevision: string;
  snapshotId: string;
  selectionFingerprint: string;
  sourceRoots: string[];
  excludes: string[];
  selectedFileCount: number;
  inventoryPages: number;
  factPages: number;
  traversalComplete: boolean;
  // Kit-selected files that Lab's inventory policy does not treat as
  // source/test. Recorded, not reconciled silently.
  kitFilesOutsideLabPolicy: string[];
};

export type SourceFactsSnapshot = {
  targetRoot: string;
  // Additive. Absent on snapshots built before Gate 3; consumers treat an
  // absent value as the legacy native-analyzer provider.
  provider?: SourceFactsProvider;
  // Kit producer identity and coverage when provider is "kit".
  kitEvidence?: SourceFactsKitSummary;
  // Only files eligible for source-fact extraction (role "source" or "test")
  // are included -- see collectSourceFacts.ts's header comment for the full
  // policy. docs/config/package/generated/vendor/build-output/report-output
  // files are omitted entirely rather than included with a "skipped"
  // placeholder, since source facts are meaningless for them and this keeps
  // the snapshot proportional to actual candidate source files.
  files: SourceFileFacts[];
  filesByLanguage: Record<NormalizedLanguage, number>;
  filesByParseStatus: Record<SourceFactParseStatus, number>;
  // Collector-level diagnostics (currently: analyzer errors caught during
  // collection). Per-file "no analyzer registered" diagnostics live on each
  // file's own `diagnostics` array, not duplicated here.
  analyzerDiagnostics: SourceFactDiagnostic[];
  warnings: string[];
};
