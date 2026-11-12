import { NORMALIZED_LANGUAGES, type NormalizedLanguage, type ProjectInventorySnapshot } from "./projectInventory.js";
import {
  SOURCE_FACT_PARSE_STATUSES,
  type DeclarationFact,
  type DeclarationFactKind,
  type ExportFact,
  type ExportFactKind,
  type ImportFact,
  type SourceFactDiagnostic,
  type SourceFactParseStatus,
  type SourceFactProvenance,
  type SourceFactVisibility,
  type SourceFactsSnapshot,
  type SourceFileFacts,
} from "./sourceFacts.js";
import type {
  KitFact,
  KitFileEvidence,
  KitFileRecord,
  KitRequiredCapabilities,
  KitSourceEvidence,
} from "./kitSourceEvidence.js";
import { assertSelectionCoversRequired, registerKitDeclarationPredicateEvidence } from "./kitSourceEvidence.js";

// ---------------------------------------------------------------------------
// v0.10.0 Gate 3 -- Kit evidence -> Lab SourceFactsSnapshot adapter.
//
// Maps validated Kit facts onto the existing consumer contract. It reads no
// file, runs no process and produces no finding. Where Kit's semantics are
// weaker or different than the legacy analyzers', the Kit value is kept in an
// additive field and the Lab boolean/kind falls back to its documented
// "unknown" form; it is never promoted to a stronger claim.
// ---------------------------------------------------------------------------

const LAB_SOURCE_LANGUAGES: ReadonlySet<string> = new Set(["typescript", "javascript", "python", "java", "kotlin", "rust"]);

export function mapKitLanguage(kitLanguage: string): NormalizedLanguage {
  return LAB_SOURCE_LANGUAGES.has(kitLanguage) ? (kitLanguage as NormalizedLanguage) : "unknown";
}

const DECLARATION_KIND_MAP: Readonly<Record<string, DeclarationFactKind>> = {
  function: "function",
  class: "class",
  interface: "interface",
  enum: "enum",
  type: "type",
  variable: "variable",
  constant: "constant",
  method: "method",
};

const VISIBILITY_VALUES: ReadonlySet<string> = new Set(["public", "protected", "private", "internal", "package", "unknown"]);

function mapVisibility(value: string | undefined): SourceFactVisibility | undefined {
  if (value === undefined) return undefined;
  // An unrecognized producer value is preserved as unknown, not guessed.
  return VISIBILITY_VALUES.has(value) ? (value as SourceFactVisibility) : "unknown";
}

function provenanceOf(fact: KitFact): SourceFactProvenance {
  return {
    producer: "kit",
    factId: fact.id,
    extractionMethod: fact.extractionMethod,
    startLine: fact.span.startLine,
    startColumn: fact.span.startColumn,
    endLine: fact.span.endLine,
    endColumn: fact.span.endColumn,
  };
}

function exportKindOf(origin: string | undefined): ExportFactKind {
  switch (origin) {
    case "declared-export":
    case "re-export":
    case "python-all":
      return "named";
    case "commonjs":
      return "commonjs";
    default:
      return "unknown";
  }
}

export function adaptKitImport(fact: KitFact): ImportFact {
  return {
    source: fact.sourceSpecifier ?? "",
    // Kit does not distinguish static/dynamic/commonjs forms; do not invent one.
    kind: "unknown",
    ...(fact.importedNames !== undefined ? { importedNames: [...fact.importedNames] } : {}),
    line: fact.span.startLine,
    ...(fact.importResolution !== undefined ? { importResolution: fact.importResolution } : {}),
    ...(fact.targetPaths !== undefined ? { targetPaths: [...fact.targetPaths] } : {}),
    provenance: provenanceOf(fact),
  };
}

export function adaptKitExport(fact: KitFact): ExportFact {
  const visibility = mapVisibility(fact.visibility);
  return {
    name: fact.name ?? "",
    kind: exportKindOf(fact.exportOrigin),
    line: fact.span.startLine,
    ...(fact.exportOrigin !== undefined ? { exportOrigin: fact.exportOrigin } : {}),
    ...(visibility !== undefined ? { visibility } : {}),
    provenance: provenanceOf(fact),
  };
}

export function adaptKitDeclaration(fact: KitFact): DeclarationFact {
  const mapped = fact.declarationKind === undefined ? undefined : DECLARATION_KIND_MAP[fact.declarationKind];
  const visibility = mapVisibility(fact.visibility);
  const exportState = fact.exported === true ? "exported" : fact.exported === false ? "not-exported" : "unknown";
  return {
    name: fact.name ?? "",
    kind: mapped ?? "unknown",
    // The legacy boolean cannot hold "unknown"; exportState carries the truth.
    exported: fact.exported === true,
    line: fact.span.startLine,
    exportState,
    ...(fact.exportOrigin !== undefined ? { exportOrigin: fact.exportOrigin } : {}),
    ...(visibility !== undefined ? { visibility } : {}),
    ...(fact.ownerKey !== undefined ? { ownerKey: fact.ownerKey } : {}),
    ...(fact.symbolId !== undefined ? { symbolId: fact.symbolId } : {}),
    ...(fact.jvmDeclaration !== undefined ? { jvmDeclaration: { ...fact.jvmDeclaration } } : {}),
    ...(mapped === undefined && fact.declarationKind !== undefined ? { providerKind: fact.declarationKind } : {}),
    provenance: provenanceOf(fact),
  };
}

function mapParseStatus(
  record: KitFileRecord,
  required: KitRequiredCapabilities
): { status: SourceFactParseStatus; downgraded: boolean } {
  switch (record.status) {
    case "parsed": {
      const incomplete = required.some((capability) => record.capabilities[capability] !== "complete");
      // Never mark a file parsed while a required capability is not complete.
      return incomplete ? { status: "file-level-only", downgraded: true } : { status: "parsed", downgraded: false };
    }
    case "partial":
    case "file-level-only":
      return { status: "file-level-only", downgraded: record.status === "partial" };
    case "failed":
      return { status: "parse-error", downgraded: false };
    case "skipped":
      return { status: "skipped", downgraded: false };
    case "unsupported":
    default:
      return { status: "unsupported", downgraded: false };
  }
}

function diagnosticsFor(
  record: KitFileRecord,
  analyzerId: string | null,
  extra: SourceFactDiagnostic[]
): SourceFactDiagnostic[] {
  const diagnostics: SourceFactDiagnostic[] = [...extra];
  for (const diagnostic of record.diagnostics ?? []) {
    diagnostics.push({
      severity: "info",
      code: `kit:${diagnostic.code}`,
      message: diagnostic.message,
      path: record.path,
      analyzerId,
    });
  }
  for (const warning of record.warnings) {
    diagnostics.push({ severity: "warning", code: "kit:warning", message: warning, path: record.path, analyzerId });
  }
  // Every non-complete, applicable capability is surfaced, so unsupported or
  // partial evidence is visible instead of looking like a clean empty array.
  for (const [capability, status] of Object.entries(record.capabilities)) {
    if (status === "complete" || status === "not-applicable") continue;
    diagnostics.push({
      severity: status === "failed" ? "error" : "info",
      code: `kit:capability-${status}`,
      message: `Kit capability ${capability} is ${status} for ${record.path}.`,
      path: record.path,
      analyzerId,
    });
  }
  return diagnostics;
}

export function adaptKitFile(
  evidence: KitFileEvidence | undefined,
  record: KitFileRecord,
  labEntry: ProjectInventorySnapshot["files"][number],
  required: KitRequiredCapabilities
): SourceFileFacts {
  const analyzerId = record.analyzerId === null ? null : `kit:${record.analyzerId}`;
  const language = mapKitLanguage(record.language);
  const kitEvidence = {
    producerLanguage: record.language,
    ...(record.jvmPackageName !== undefined ? { jvmPackageName: record.jvmPackageName } : {}),
    producerRole: record.role,
    producerStatus: record.status,
    contentSha256: record.contentSha256,
    capabilities: { ...record.capabilities },
  };
  const base = {
    relativePath: labEntry.relativePath,
    language,
    // Lab's inventory policy owns role; Kit's role is kept as evidence.
    role: labEntry.role,
    analyzerId,
    ...(record.lineCount === null ? {} : { lineCount: record.lineCount }),
    kit: kitEvidence,
  };

  // A language Lab does not model is recorded, but its
  // facts are not forced into Lab kinds.
  if (language === "unknown" && record.language !== "unknown") {
    return {
      ...base,
      parseStatus: "unsupported",
      imports: [],
      exports: [],
      declarations: [],
      references: [],
      diagnostics: diagnosticsFor(record, analyzerId, [
        {
          severity: "info",
          code: "kit:language-not-modeled",
          message: `Kit language "${record.language}" has no Lab language model; facts were not adapted.`,
          path: record.path,
          analyzerId,
        },
      ]),
    };
  }

  const { status, downgraded } = mapParseStatus(record, required);
  const extra: SourceFactDiagnostic[] = downgraded
    ? [
        {
          severity: "warning",
          code: "kit:required-capability-not-complete",
          message: `Kit reports ${record.path} as ${record.status}; it is not treated as parsed.`,
          path: record.path,
          analyzerId,
        },
      ]
    : [];

  const imports: ImportFact[] = [];
  const exports: ExportFact[] = [];
  const declarations: DeclarationFact[] = [];
  // Positive verified facts are retained. Facts not retrieved stay unknown:
  // an absent evidence object yields empty arrays with a diagnostic, never a
  // claim of absence.
  if (evidence === undefined) {
    extra.push({
      severity: "info",
      code: "kit:facts-not-retrieved",
      message: `Exact-file Kit facts were not retrieved for ${record.path}; its fact arrays are unknown, not empty.`,
      path: record.path,
      analyzerId,
    });
  } else {
    for (const fact of evidence.facts) {
      if (fact.kind === "import") imports.push(adaptKitImport(fact));
      else if (fact.kind === "export") exports.push(adaptKitExport(fact));
      else if (fact.kind === "declaration") declarations.push(adaptKitDeclaration(fact));
      // Observation families are kept in Kit evidence; Gate 3 does not map them.
    }
  }

  return {
    ...base,
    parseStatus: evidence === undefined && status === "parsed" ? "file-level-only" : status,
    imports,
    exports,
    declarations,
    references: [],
    diagnostics: diagnosticsFor(record, analyzerId, extra),
  };
}

export type AdaptKitEvidenceOptions = {
  evidence: KitSourceEvidence;
  inventory: ProjectInventorySnapshot;
  targetRoot: string;
  requiredCapabilities: KitRequiredCapabilities;
  capabilitiesForPath?: (filePath: string) => KitRequiredCapabilities;
};

// Lab's inventory remains the authority on which files are source/test for
// audit policy. Files are matched by canonical selected path.
export function adaptKitEvidenceToSourceFacts(options: AdaptKitEvidenceOptions): SourceFactsSnapshot {
  const { evidence, inventory, requiredCapabilities } = options;
  assertSelectionCoversRequired(evidence.inventory, [...evidence.fileEvidence.keys()]);
  const kitByPath = new Map(evidence.inventory.map((record) => [record.path, record]));
  const files: SourceFileFacts[] = [];
  const consumed = new Set<string>();

  // inventory.files is sorted by relativePath, so output order is deterministic.
  for (const entry of inventory.files) {
    if (entry.role !== "source" && entry.role !== "test") continue;
    const record = kitByPath.get(entry.relativePath);
    if (record === undefined) continue; // Not selected by Kit; required paths were verified earlier.
    consumed.add(entry.relativePath);
    const fileEvidence = evidence.fileEvidence.get(entry.relativePath);
    // The exact-file record carries producer diagnostics; the inventory record does not.
    const file = adaptKitFile(fileEvidence, fileEvidence?.record ?? record, entry,
      options.capabilitiesForPath?.(entry.relativePath) ?? requiredCapabilities);
    registerKitDeclarationPredicateEvidence(file, evidence);
    files.push(file);
  }

  const kitFilesOutsideLabPolicy = evidence.inventory
    .map((record) => record.path)
    .filter((recordPath) => !consumed.has(recordPath))
    .sort();

  const filesByLanguage = Object.fromEntries(NORMALIZED_LANGUAGES.map((language) => [language, 0])) as Record<
    NormalizedLanguage,
    number
  >;
  const filesByParseStatus = Object.fromEntries(SOURCE_FACT_PARSE_STATUSES.map((status) => [status, 0])) as Record<
    SourceFactParseStatus,
    number
  >;
  const analyzerDiagnostics: SourceFactDiagnostic[] = [];
  for (const file of files) {
    filesByLanguage[file.language] += 1;
    filesByParseStatus[file.parseStatus] += 1;
    if (file.parseStatus === "parse-error") {
      analyzerDiagnostics.push(...file.diagnostics.filter((diagnostic) => diagnostic.severity === "error"));
    }
  }

  return {
    targetRoot: options.targetRoot,
    provider: "kit",
    kitEvidence: {
      packageName: evidence.producer.packageName,
      packageVersion: evidence.producer.packageVersion,
      artifactSchemaVersion: evidence.artifactSchemaVersion,
      extractorRevision: evidence.extractorRevision,
      snapshotId: evidence.snapshotId,
      selectionFingerprint: evidence.source.selectionFingerprint,
      sourceRoots: [...evidence.source.sourceRoots],
      excludes: [...evidence.source.excludes],
      selectedFileCount: evidence.coverage.selectedFileCount,
      inventoryPages: evidence.inventoryPages,
      factPages: evidence.factPages,
      traversalComplete: evidence.traversalComplete,
      kitFilesOutsideLabPolicy,
    },
    files,
    filesByLanguage,
    filesByParseStatus,
    analyzerDiagnostics,
    warnings: [],
  };
}
