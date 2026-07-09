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
};

export type ExportFactKind = "named" | "default" | "namespace" | "commonjs" | "unknown";
export type ExportFact = {
  name: string;
  kind: ExportFactKind;
  line?: number;
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
};

export type ReferenceFact = {
  name: string;
  kind?: string;
  line?: number;
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
  imports: ImportFact[];
  exports: ExportFact[];
  declarations: DeclarationFact[];
  references: ReferenceFact[];
  diagnostics: SourceFactDiagnostic[];
};

export type SourceFactsSnapshot = {
  targetRoot: string;
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
