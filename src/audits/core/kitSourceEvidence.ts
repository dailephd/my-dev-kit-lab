import { fileURLToPath, pathToFileURL } from "node:url";
import path from "node:path";
import { createHash } from "node:crypto";
import { splitLines } from "./textLines.js";
import type { DeclarationFact, ImportFact, SourceFileFacts } from "./sourceFacts.js";

// ---------------------------------------------------------------------------
// v0.10.0 Gate 3 -- validated Kit source-evidence envelope.
//
// Pure validation, no filesystem or subprocess access. The provider
// (kitSourceProvider.ts) feeds it parsed JSON; the adapter
// (kitSourceAdapter.ts) consumes the validated model. Nothing here produces
// an audit finding or reinterprets a static fact as one.
//
// Contract source: the exact private Kit candidate (package metadata 1.14.0,
// artifact schema 1.0.0, extractor revision source-audit-v1.2.0). The
// extractor revision is not carried by the artifact or manifest; the
// provider verifies it against the installed package instead.
//
// Rule for every validator: unknown, partial, unsupported, stale, truncated
// or malformed evidence throws KitSourceEvidenceAcquisitionError. It is never
// flattened into an empty successful array.
// ---------------------------------------------------------------------------

export const KIT_PACKAGE_NAME = "@dailephd/my-dev-kit";
export const KIT_SOURCE_AUDIT_ARTIFACT_KIND = "my-dev-kit-v1-source-audit-evidence";
export const KIT_SOURCE_AUDIT_SCHEMA_VERSION = "1.1.0";
export const KIT_SOURCE_PROOF_SCHEMA_VERSION = "1.2.0";
export const KIT_SOURCE_AUDIT_ARTIFACT_FILENAME = "source-audit-evidence.json";
export const KIT_SOURCE_AUDIT_EXTRACTOR_REVISION = "source-audit-v1.5.0";

export const KIT_INVENTORY_PAGE_SIZE = 64;
export const KIT_FACT_PAGE_SIZE = 128;
export const KIT_MAX_INVENTORY_PAGES = 4096;
export const KIT_MAX_FACT_PAGES_PER_FILE = 4096;

export const KIT_CAPABILITY_NAMES = [
  "declarations",
  "imports",
  "exports",
  "identifier-literals",
  "test-observations",
  "fixture-references",
  "process-observations",
  "api-client-calls",
  "source-ranges",
] as const;
export type KitCapabilityName = (typeof KIT_CAPABILITY_NAMES)[number];

export const KIT_CAPABILITY_STATUSES = ["complete", "partial", "unsupported", "failed", "not-applicable"] as const;
export type KitCapabilityStatus = (typeof KIT_CAPABILITY_STATUSES)[number];

export const KIT_FILE_STATUSES = ["parsed", "partial", "file-level-only", "unsupported", "failed", "skipped"] as const;
export type KitFileStatus = (typeof KIT_FILE_STATUSES)[number];

export const KIT_FILE_ROLES = ["source", "test", "script", "unknown"] as const;
export type KitFileRole = (typeof KIT_FILE_ROLES)[number];

export type KitEvidenceFailureCategory =
  | "package-missing"
  | "package-identity"
  | "cli-containment"
  | "subprocess-failed"
  | "subprocess-timeout"
  | "output-limit"
  | "invalid-json"
  | "artifact-missing"
  | "artifact-invalid"
  | "schema-mismatch"
  | "extractor-mismatch"
  | "snapshot-mismatch"
  | "page-invalid"
  | "traversal-incomplete"
  | "selection-incomplete"
  | "stale-evidence"
  | "capability-insufficient"
  | "path-invalid"
  | "root-mismatch"
  | "invalid-request";

// Fatal source-evidence acquisition failure. Thrown out of runAudit and mapped
// to exit code 2 by the existing runtime-failure boundary in
// runAuditCommand.ts, independent of --fail-on.
export class KitSourceEvidenceAcquisitionError extends Error {
  readonly category: KitEvidenceFailureCategory;
  readonly detail: string | undefined;
  constructor(category: KitEvidenceFailureCategory, message: string, detail?: string) {
    super(`Kit source evidence unavailable (${category}): ${message}`);
    this.name = "KitSourceEvidenceAcquisitionError";
    this.category = category;
    this.detail = detail;
  }
}

function fail(category: KitEvidenceFailureCategory, message: string): never {
  throw new KitSourceEvidenceAcquisitionError(category, message);
}

// ---------------------------------------------------------------------------
// Model
// ---------------------------------------------------------------------------

export type KitProducerIdentity = {
  packageName: string;
  packageVersion: string;
};

// Exact installed candidate JSON contract (findExactFileOccurrences).
export type KitOccurrence = {
  schemaVersion: "1.0.0" | "1.1.0"; mode: "exact-file-occurrence"; snapshotId: string;
  filePath: string; value: string; scannedBytes: number; complete: boolean;
  reasonCode: string | null; matchCount: number; returnedMatches: number; truncated: boolean;
  matches: Array<{ line: number; column: number; windowStart: number; windowEnd: number; content: string }>;
};
export type KitImportProof = {
  schemaVersion: "1.0.0" | "1.1.0"; mode: "audit-import-target"; snapshotId: string;
  importFactId: string; originFile: string; sourceSpecifier: string;
  status: "present" | "proven-missing" | "outside-selected-roots" | "indeterminate";
  candidatePaths: string[]; selectionComplete: boolean; reasonCode: string;
  declarationProof?: {
    scope: "selected-ordinary-jvm-sources";
    targetKind: "java-type" | "java-static-owner" | "kotlin-direct" | "unsupported";
    targetQualifiedName: string | null; targetPackageName: string | null;
    domainComplete: boolean; packageWitnessFactIds: string[];
    matchingDeclarationFactIds: string[]; matchingSourcePaths: string[]; matchingQualifiedNames: string[];
    incompletenessReasons: string[];
  };
};

// Already validated Kit windows may overlap or come from separate literal
// queries. Only the exact selected byte identity establishes whole content.
export function authenticateKitWindowContent(filePath: string, file: Pick<KitFileRecord, "contentSha256" | "sizeBytes">,
  matches: readonly KitOccurrence["matches"][number][]): string | null {
  if (!file.contentSha256 || matches.length === 0) return null;
  const lines = new Map<number, string>();
  for (const match of matches) for (const [offset, line] of splitLines(match.content).entries()) {
    const number = match.windowStart + offset;
    if (lines.has(number) && lines.get(number) !== line) fail("artifact-invalid", `${filePath} has conflicting authenticated source windows.`);
    lines.set(number, line);
  }
  let end = 0;
  while (lines.has(end + 1)) end++;
  const normalized = Array.from({ length: end }, (_, index) => lines.get(index + 1)!).join("\n");
  for (const newline of ["\n", "\r\n"]) {
    const text = normalized.replace(/\n/g, newline);
    for (const candidate of [text, text + newline]) {
      if (Buffer.byteLength(candidate, "utf8") === file.sizeBytes &&
          createHash("sha256").update(candidate, "utf8").digest("hex") === file.contentSha256) return candidate;
    }
  }
  return null;
}

export function validateKitOccurrence(raw: unknown, expected: {
  snapshotId: string; file: KitFileRecord; value: string; rawOnlyTextUnavailable?: boolean;
}): KitOccurrence {
  const r = raw as KitOccurrence;
  const integer = (n: unknown, min = 0): n is number => Number.isSafeInteger(n) && (n as number) >= min;
  if (!r || r.mode !== "exact-file-occurrence" || !["1.0.0", "1.1.0"].includes(r.schemaVersion)) fail("schema-mismatch", "Invalid exact-file occurrence envelope.");
  if (r.snapshotId !== expected.snapshotId) fail("snapshot-mismatch", "Occurrence snapshot differs from the validated audit snapshot.");
  if (r.filePath !== expected.file.path || r.value !== expected.value) fail("path-invalid", "Occurrence file or literal differs from the request.");
  if (!integer(r.matchCount) || r.matchCount > 200000 || !integer(r.returnedMatches) || r.returnedMatches > 200 ||
      !Array.isArray(r.matches) || r.matches.length !== r.returnedMatches || r.matchCount < r.returnedMatches ||
      !integer(r.scannedBytes) || r.scannedBytes > 200000 || typeof r.complete !== "boolean" || typeof r.truncated !== "boolean" ||
      !(r.reasonCode === null || typeof r.reasonCode === "string") || r.truncated !== (r.matchCount > r.returnedMatches) ||
      (r.complete ? r.reasonCode !== null || r.truncated || expected.file.contentSha256 === null || r.scannedBytes !== expected.file.sizeBytes : !r.reasonCode)) {
    fail("artifact-invalid", "Inconsistent occurrence bounds or completeness.");
  }
  if (!r.complete && (!["CONTENT_HASH_UNAVAILABLE", "FILE_NOT_VALID_UTF8", "FILE_EXCEEDS_SCAN_LIMIT", "MATCHES_TRUNCATED"].includes(r.reasonCode!) ||
      (r.reasonCode === "CONTENT_HASH_UNAVAILABLE" &&
        ((!expected.rawOnlyTextUnavailable && expected.file.contentSha256 !== null) || r.scannedBytes !== 0 || r.matchCount !== 0)) ||
      (r.reasonCode === "FILE_EXCEEDS_SCAN_LIMIT" && r.scannedBytes !== 200000) ||
      (r.reasonCode === "MATCHES_TRUNCATED" && (!r.truncated || r.returnedMatches !== 200)))) fail("artifact-invalid", "Inconsistent occurrence limitation.");
  let lastLine = 0, lastColumn = -1;
  for (const m of r.matches) {
    if (!m || !integer(m.line, 1) || !integer(m.column, 1) || !integer(m.windowStart, 1) || !integer(m.windowEnd, 1) ||
        m.windowStart > m.line || m.windowEnd < m.line || m.line - m.windowStart > 40 || m.windowEnd - m.line > 40 ||
        (expected.file.lineCount !== null && m.windowEnd > expected.file.lineCount) || typeof m.content !== "string") fail("artifact-invalid", "Invalid occurrence coordinates.");
    const lines = splitLines(m.content);
    if (lines.length !== m.windowEnd - m.windowStart + 1 || !lines[m.line - m.windowStart]?.startsWith(r.value, m.column - 1) ||
        m.line < lastLine || (m.line === lastLine && m.column <= lastColumn)) fail("artifact-invalid", "Invalid occurrence context or ordering.");
    lastLine = m.line; lastColumn = m.column;
  }
  return r;
}

export function validateKitImportProof(raw: unknown, expected: { snapshotId: string; fact: KitFact; evidence?: KitSourceEvidence }): KitImportProof {
  const r = raw as KitImportProof;
  if (!r || r.mode !== "audit-import-target" || !["1.0.0", "1.1.0"].includes(r.schemaVersion)) fail("schema-mismatch", "Invalid import-target envelope.");
  if (r.snapshotId !== expected.snapshotId) fail("snapshot-mismatch", "Import proof snapshot differs from the audit snapshot.");
  if (expected.evidence && r.schemaVersion !== (expected.evidence.artifactSchemaVersion === "1.2.0" ? "1.1.0" : expected.evidence.artifactSchemaVersion)) fail("schema-mismatch", "Import proof schema differs from the validated artifact.");
  if (r.importFactId !== expected.fact.id || r.originFile !== expected.fact.span.path || r.sourceSpecifier !== expected.fact.sourceSpecifier ||
      !["present", "proven-missing", "outside-selected-roots", "indeterminate"].includes(r.status) ||
      typeof r.selectionComplete !== "boolean" || typeof r.reasonCode !== "string" || !Array.isArray(r.candidatePaths)) fail("artifact-invalid", "Import proof does not match the validated fact.");
  for (const p of r.candidatePaths) validateKitRelativePath(p, "import proof candidate");
  if (expected.fact.kind === "export") {
    const presentReason = r.candidatePaths.length === 1 ? "TARGET_IN_SELECTED_INVENTORY" : "MULTIPLE_TARGETS_IN_SELECTED_INVENTORY";
    const evidence = expected.evidence;
    if (!evidence || r.selectionComplete !== (evidence.coverage.inventoryComplete && evidence.coverage.exclusionsAreExplicit) ||
        r.declarationProof !== undefined ||
        (r.status === "present" && (r.reasonCode !== presentReason || !r.candidatePaths.length ||
          r.candidatePaths.some(candidate => !evidence.inventory.some(file => file.path === candidate)))) ||
        (r.status === "proven-missing" && (r.reasonCode !== "ALL_CANDIDATES_ABSENT_IN_COMPLETE_SELECTION" ||
          evidence.inventory.some(file => r.candidatePaths.includes(file.path))))) {
      fail("artifact-invalid", "Re-export target proof contradicts the selected target domain.");
    }
  }
  if (r.declarationProof !== undefined) {
    const d = r.declarationProof;
    const keys = ["scope", "targetKind", "targetQualifiedName", "targetPackageName", "domainComplete", "packageWitnessFactIds", "matchingDeclarationFactIds", "matchingSourcePaths", "matchingQualifiedNames", "incompletenessReasons"];
    if (!d || typeof d !== "object" || Object.keys(d).length !== keys.length || Object.keys(d).some(key => !keys.includes(key)) ||
        r.schemaVersion !== "1.1.0" || d.scope !== "selected-ordinary-jvm-sources" || r.candidatePaths.length !== 0 ||
        !["java-type", "java-static-owner", "kotlin-direct", "unsupported"].includes(d.targetKind) || typeof d.domainComplete !== "boolean") fail("artifact-invalid", "Malformed JVM declaration proof discriminator or domain.");
    for (const list of [d.packageWitnessFactIds, d.matchingDeclarationFactIds, d.matchingSourcePaths, d.matchingQualifiedNames, d.incompletenessReasons]) {
      if (!Array.isArray(list) || list.some(value => typeof value !== "string" || !value)) fail("artifact-invalid", "Malformed declaration proof evidence array.");
    }
    if (new Set(d.matchingDeclarationFactIds).size !== d.matchingDeclarationFactIds.length || new Set(d.packageWitnessFactIds).size !== d.packageWitnessFactIds.length ||
        d.matchingDeclarationFactIds.length !== d.matchingSourcePaths.length || d.matchingDeclarationFactIds.length !== d.matchingQualifiedNames.length) fail("artifact-invalid", "Inconsistent declaration match identities.");
    const target = expected.fact.jvmImportTarget;
    if (!target || d.targetKind !== target.kind || d.targetQualifiedName !== target.qualifiedName ||
        !(d.targetPackageName === null || typeof d.targetPackageName === "string" && (d.targetPackageName === "" || /^[A-Za-z_$][\w$]*(?:\.[A-Za-z_$][\w$]*)*$/.test(d.targetPackageName)))) fail("artifact-invalid", "Declaration target differs from the validated import identity.");
    if (/\.java$/i.test(expected.fact.span.path) && target.kind === "kotlin-direct" || /\.kt$/i.test(expected.fact.span.path) && (target.kind === "java-type" || target.kind === "java-static-owner")) fail("artifact-invalid", "Import target kind contradicts its ordinary source language.");
    if (target.qualifiedName !== null && target.kind !== "unsupported" && (target.kind === "java-static-owner"
      ? !r.sourceSpecifier.startsWith(target.qualifiedName + ".") || r.sourceSpecifier.slice(target.qualifiedName.length + 1).includes(".")
      : r.sourceSpecifier !== target.qualifiedName)) fail("artifact-invalid", "Qualified target does not describe the recorded import.");
    const evidence = expected.evidence;
    if (!evidence) fail("artifact-invalid", "Declaration proof requires validated canonical domain evidence.");
    const ordinary = evidence.inventory.filter(file => /\.(java|kt)$/i.test(file.path));
    const complete = evidence.traversalComplete && evidence.coverage.inventoryComplete && evidence.coverage.exclusionsAreExplicit && evidence.coverage.recordedFileCount === evidence.inventory.length && evidence.coverage.selectedFileCount === evidence.inventory.length && ordinary.every(file => {
      const full = evidence.fileEvidence.get(file.path);
      return full && full.record.jvmPackageName !== undefined && full.record.capabilities.jvmDeclarations === "complete" && full.record.capabilities.declarations === "complete" &&
        !full.record.diagnostics?.some(diagnostic => /truncat|dropped/.test(diagnostic.code)) && full.facts.filter(fact => fact.kind === "declaration").every(fact => fact.jvmDeclaration?.packageName === full.record.jvmPackageName);
    });
    const declarations = ordinary.flatMap(file => evidence.fileEvidence.get(file.path)?.facts.filter(fact => fact.kind === "declaration" && fact.jvmDeclaration) ?? []);
    const matches = declarations.filter(fact => fact.jvmDeclaration!.qualifiedName === d.targetQualifiedName && (d.targetKind === "kotlin-direct" || fact.jvmDeclaration!.role === "type")).sort((a, b) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
    const witnesses = declarations.filter(fact => fact.jvmDeclaration!.packageName === d.targetPackageName).map(fact => fact.id).sort();
    const matchingPackages = [...new Set(matches.map(fact => fact.jvmDeclaration!.packageName))];
    const packageCandidates = [...new Set(ordinary.flatMap(file => file.jvmPackageName !== undefined && d.targetQualifiedName &&
      (file.jvmPackageName === "" ? !d.targetQualifiedName.includes(".") : d.targetQualifiedName.startsWith(file.jvmPackageName + ".")) ? [file.jvmPackageName] : []))];
    const qualifiedPackage = matchingPackages.length === 1 ? matchingPackages[0] : packageCandidates.length === 1 ? packageCandidates[0] : null;
    if (d.targetPackageName !== qualifiedPackage) fail("artifact-invalid", "Target package partition is not established by the selected declaration domain.");
    if (d.targetPackageName !== null && d.targetQualifiedName !== null && d.targetPackageName !== "" && !d.targetQualifiedName.startsWith(d.targetPackageName + ".")) fail("artifact-invalid", "Target package is not a qualified namespace of its target.");
    const equal = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);
    if (!equal(d.matchingDeclarationFactIds, matches.map(fact => fact.id)) || !equal(d.matchingSourcePaths, matches.map(fact => fact.span.path)) ||
        !equal(d.matchingQualifiedNames, matches.map(fact => fact.jvmDeclaration!.qualifiedName)) || !equal(d.packageWitnessFactIds, witnesses)) fail("artifact-invalid", "Declaration match or witness provenance differs from canonical facts.");
    if (d.domainComplete && (!complete || !r.selectionComplete || d.targetKind === "unsupported" || !d.targetQualifiedName || d.targetPackageName === null || witnesses.length === 0 || d.incompletenessReasons.length > 0)) fail("artifact-invalid", "Unqualified declaration-domain completeness.");
    if (!d.domainComplete && d.incompletenessReasons.length === 0) fail("artifact-invalid", "Incomplete declaration evidence requires explicit reasons.");
    if (r.status === "proven-missing" && (!d.domainComplete || matches.length !== 0) || r.status === "present" && (!d.domainComplete || matches.length === 0)) fail("artifact-invalid", "Declaration proof status contradicts its qualified evidence.");
    return r;
  }
  if (expected.fact.jvmImportTarget && ["present", "proven-missing"].includes(r.status)) fail("artifact-invalid", "JVM identity requires a declaration proof.");
  if (new Set(r.candidatePaths).size !== r.candidatePaths.length ||
      (r.status === "proven-missing" && (!r.selectionComplete || r.candidatePaths.length === 0))) fail("artifact-invalid", "Incomplete import absence proof.");
  return r;
}

export type KitSourceSelection = {
  projectRoot: string;
  sourceRoots: string[];
  excludes: string[];
  symbolIndexSchemaVersion: string;
  codeGraphSchemaVersion: string;
  selectionFingerprint: string;
  snapshotId: string;
};

export type KitCoverage = {
  selectedFileCount: number;
  recordedFileCount: number;
  unreadableFileCount: number;
  excludedPathCount: number;
  unsupportedFileCount: number;
  inventoryComplete: boolean;
  exclusionsAreExplicit: boolean;
};

export type KitFileRecord = {
  jvmPackageName?: string;
  path: string;
  sizeBytes: number;
  contentSha256: string | null;
  language: string;
  role: KitFileRole;
  status: KitFileStatus;
  lineCount: number | null;
  analyzerId: string | null;
  capabilities: Record<KitCapabilityName, KitCapabilityStatus> & { jvmDeclarations?: KitCapabilityStatus; "dynamic-import-expressions"?: KitCapabilityStatus };
  ambientClassification?: KitAmbientClassification;
  warnings: string[];
  // Present on exact-file lookups only.
  diagnostics?: KitDiagnostic[];
};

export type KitDiagnostic = {
  code: string;
  message: string;
};

export type KitSourceSpan = {
  path: string;
  startLine: number;
  startColumn: number | null;
  endLine: number | null;
  endColumn: number | null;
};

export type KitAmbientClassification = {
  profile: "typescript-ambient-stub-v1";
  scope: "entire-file";
  contentSha256: string;
  outcome: "proven-ambient-only" | "not-ambient-only" | "undetermined";
  reasonCode: null | "EXECUTABLE_SYNTAX_PRESENT" | "UNSUPPORTED_AMBIENT_PROFILE" | "PARSE_UNCERTAINTY";
  witnessFactIds: string[];
};

export type KitDynamicImportExpression = {
  operandForm: "string-literal" | "qualified-string-binding" | "computed";
  operandSpan: KitSourceSpan;
  literalImportFactId?: string;
};

export type KitFact = {
  dynamicImport?: KitDynamicImportExpression;
  jvmDeclaration?: { packageName: string; qualifiedName: string; role: "type" | "kotlin-top-level-function" | "kotlin-top-level-property" };
  jvmImportTarget?: { kind: "java-type" | "java-static-owner" | "kotlin-direct" | "unsupported"; qualifiedName: string | null };
  id: string;
  kind: string;
  span: KitSourceSpan;
  extractionMethod: string;
  name?: string;
  symbolId?: string;
  declarationKind?: string;
  ownerKey?: string | null;
  visibility?: string;
  exported?: boolean | null;
  exportOrigin?: string;
  sourceSpecifier?: string;
  importedNames?: string[];
  importResolution?: string;
  targetPaths?: string[];
  observationKind?: string;
  value?: string | null;
  valueSha256?: string;
  valueTruncated?: boolean;
};

export type KitArtifactHeader = {
  artifactKind: string;
  schemaVersion: string;
  producer: KitProducerIdentity;
  source: KitSourceSelection;
  coverage: KitCoverage;
  // Compact identity of each recorded file, used to cross-check inventory pages.
  files: Array<Pick<KitFileRecord, "path" | "contentSha256" | "language" | "role" | "status">>;
};

export type KitManifestReference = {
  path: string;
  schemaVersion: string;
  sha256: string;
  snapshotId: string;
};

export type KitInventoryPage = {
  snapshotId: string;
  pageIndex: number;
  totalItems: number;
  totalPages: number;
  nextPageIndex: number | null;
  coverage: KitCoverage;
  files: KitFileRecord[];
};

export type KitFactPage = {
  snapshotId: string;
  pageIndex: number;
  totalItems: number;
  totalPages: number;
  nextPageIndex: number | null;
  status: "found" | "unsupported";
  file: KitFileRecord;
  facts: KitFact[];
};

export type KitFileEvidence = {
  record: KitFileRecord;
  facts: KitFact[];
  factPages: number;
};

// Everything the adapter needs, already validated.
export type KitSourceEvidence = {
  producer: KitProducerIdentity;
  artifactSchemaVersion: string;
  extractorRevision: string;
  source: KitSourceSelection;
  coverage: KitCoverage;
  snapshotId: string;
  inventory: KitFileRecord[];
  inventoryPages: number;
  // Files whose exact-file facts were retrieved and validated, by path.
  fileEvidence: Map<string, KitFileEvidence>;
  factPages: number;
  traversalComplete: boolean;
};

// ---------------------------------------------------------------------------
// Primitive validators
// ---------------------------------------------------------------------------

type JsonObject = Record<string, unknown>;

function asObject(value: unknown, label: string, category: KitEvidenceFailureCategory): JsonObject {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    fail(category, `${label} must be a JSON object.`);
  }
  return value as JsonObject;
}

function str(obj: JsonObject, key: string, label: string, category: KitEvidenceFailureCategory): string {
  const value = obj[key];
  if (typeof value !== "string" || value.length === 0) {
    fail(category, `${label}.${key} must be a non-empty string.`);
  }
  return value;
}

function int(obj: JsonObject, key: string, label: string, category: KitEvidenceFailureCategory): number {
  const value = obj[key];
  if (typeof value !== "number" || !Number.isInteger(value) || value < 0) {
    fail(category, `${label}.${key} must be a non-negative integer.`);
  }
  return value;
}

function bool(obj: JsonObject, key: string, label: string, category: KitEvidenceFailureCategory): boolean {
  const value = obj[key];
  if (typeof value !== "boolean") {
    fail(category, `${label}.${key} must be a boolean.`);
  }
  return value;
}

function strArray(obj: JsonObject, key: string, label: string, category: KitEvidenceFailureCategory): string[] {
  const value = obj[key];
  if (!Array.isArray(value) || value.some((entry) => typeof entry !== "string")) {
    fail(category, `${label}.${key} must be an array of strings.`);
  }
  return value as string[];
}

function oneOf<T extends string>(
  value: unknown,
  allowed: readonly T[],
  label: string,
  category: KitEvidenceFailureCategory
): T {
  if (typeof value !== "string" || !(allowed as readonly string[]).includes(value)) {
    fail(category, `${label} must be one of ${allowed.join(", ")}; received ${JSON.stringify(value)}.`);
  }
  return value as T;
}

const SHA256_PATTERN = /^[0-9a-f]{64}$/;

export function sha256Hex(bytes: Uint8Array | string): string {
  return createHash("sha256").update(bytes).digest("hex");
}

// Canonical selected path: relative, forward-slash, no traversal, no empty or
// dot segments, no drive or UNC form. Mirrors the shape Kit emits.
export function validateKitRelativePath(value: unknown, label: string): string {
  if (typeof value !== "string" || value.length === 0) {
    fail("path-invalid", `${label} must be a non-empty relative path.`);
  }
  if (
    value.includes("\\") ||
    value.includes("\0") ||
    value.startsWith("/") ||
    /^[A-Za-z]:/.test(value) ||
    value.endsWith("/")
  ) {
    fail("path-invalid", `${label} is not a canonical relative path: ${JSON.stringify(value)}.`);
  }
  for (const segment of value.split("/")) {
    if (segment === "" || segment === "." || segment === "..") {
      fail("path-invalid", `${label} contains an invalid segment: ${JSON.stringify(value)}.`);
    }
  }
  return value;
}

export function requestedPathMatchesCanonical(requested: string): boolean {
  try {
    validateKitRelativePath(requested, "requested path");
    return true;
  } catch {
    return false;
  }
}

// ---------------------------------------------------------------------------
// Structured validators
// ---------------------------------------------------------------------------

export function validateKitCoverage(value: unknown, label: string): KitCoverage {
  const obj = asObject(value, label, "artifact-invalid");
  return {
    selectedFileCount: int(obj, "selectedFileCount", label, "artifact-invalid"),
    recordedFileCount: int(obj, "recordedFileCount", label, "artifact-invalid"),
    unreadableFileCount: int(obj, "unreadableFileCount", label, "artifact-invalid"),
    excludedPathCount: int(obj, "excludedPathCount", label, "artifact-invalid"),
    unsupportedFileCount: int(obj, "unsupportedFileCount", label, "artifact-invalid"),
    inventoryComplete: bool(obj, "inventoryComplete", label, "artifact-invalid"),
    exclusionsAreExplicit: bool(obj, "exclusionsAreExplicit", label, "artifact-invalid"),
  };
}

export function validateKitFileRecord(value: unknown, label: string, schema?: unknown): KitFileRecord {
  const obj = asObject(value, label, "page-invalid");
  const filePath = validateKitRelativePath(obj.path, `${label}.path`);
  const hash = obj.contentSha256;
  if (hash !== null && (typeof hash !== "string" || !SHA256_PATTERN.test(hash))) {
    fail("page-invalid", `${label}.contentSha256 must be a lowercase SHA-256 or null.`);
  }
  const capabilitiesRaw = asObject(obj.capabilities, `${label}.capabilities`, "page-invalid");
  const capabilities = {} as Record<KitCapabilityName, KitCapabilityStatus>;
  for (const name of KIT_CAPABILITY_NAMES) {
    capabilities[name] = oneOf(
      capabilitiesRaw[name],
      KIT_CAPABILITY_STATUSES,
      `${label}.capabilities.${name}`,
      "page-invalid"
    );
  }
  const analyzerId = obj.analyzerId;
  if (analyzerId !== null && analyzerId !== undefined && typeof analyzerId !== "string") {
    fail("page-invalid", `${label}.analyzerId must be a string or null.`);
  }
  const record: KitFileRecord = {
    path: filePath,
    sizeBytes: int(obj, "sizeBytes", label, "page-invalid"),
    contentSha256: hash ?? null,
    language: str(obj, "language", label, "page-invalid"),
    role: oneOf(obj.role, KIT_FILE_ROLES, `${label}.role`, "page-invalid"),
    status: oneOf(obj.status, KIT_FILE_STATUSES, `${label}.status`, "page-invalid"),
    // The producer has no source-line inventory for unsupported non-source
    // files (for example JSON fixtures). Preserve unknown instead of zero.
    lineCount: obj.lineCount === null && obj.status === "unsupported"
      ? null
      : int(obj, "lineCount", label, "page-invalid"),
    analyzerId: analyzerId ?? null,
    capabilities,
    warnings: strArray(obj, "warnings", label, "page-invalid"),
  };
  if (schema === KIT_SOURCE_PROOF_SCHEMA_VERSION) {
    record.capabilities["dynamic-import-expressions"] = oneOf(capabilitiesRaw["dynamic-import-expressions"],
      KIT_CAPABILITY_STATUSES, "dynamic-import-expressions", "page-invalid");
    if (record.capabilities["dynamic-import-expressions"] === "complete" &&
        (!record.contentSha256 || !["typescript", "javascript"].includes(record.language) ||
         record.analyzerId !== "typescript-ast" || record.status !== "parsed")) {
      fail("page-invalid", "Complete expression coverage requires authenticated parsed JS/TS.");
    }
    if (obj.ambientClassification !== undefined) record.ambientClassification = validateAmbientClassification(obj.ambientClassification, record);
  } else if (obj.ambientClassification !== undefined || capabilitiesRaw["dynamic-import-expressions"] !== undefined) {
    fail("schema-mismatch", "Proof-only fields require source-audit schema 1.2.0.");
  }
  if (obj.jvmPackageName !== undefined) {
    if (typeof obj.jvmPackageName !== "string" || obj.jvmPackageName !== "" && !/^[A-Za-z_$][\w$]*(?:\.[A-Za-z_$][\w$]*)*$/.test(obj.jvmPackageName)) fail("page-invalid", "Invalid JVM package identity.");
    record.jvmPackageName = obj.jvmPackageName;
  }
  if (capabilitiesRaw.jvmDeclarations !== undefined) record.capabilities.jvmDeclarations = oneOf(capabilitiesRaw.jvmDeclarations, KIT_CAPABILITY_STATUSES, "jvmDeclarations", "page-invalid");
  if (record.capabilities.jvmDeclarations === "complete" && (!/\.(java|kt)$/i.test(record.path) || record.jvmPackageName === undefined || record.capabilities.declarations !== "complete" || record.contentSha256 === null || !["parsed", "partial"].includes(record.status))) fail("page-invalid", "Contradictory JVM declaration completeness.");
  if (obj.diagnostics !== undefined) {
    if (!Array.isArray(obj.diagnostics)) {
      fail("page-invalid", `${label}.diagnostics must be an array.`);
    }
    record.diagnostics = obj.diagnostics.map((entry, index) => {
      const diagnostic = asObject(entry, `${label}.diagnostics[${index}]`, "page-invalid");
      return {
        code: str(diagnostic, "code", `${label}.diagnostics[${index}]`, "page-invalid"),
        message: str(diagnostic, "message", `${label}.diagnostics[${index}]`, "page-invalid"),
      };
    });
  }
  return record;
}

function validateAmbientClassification(raw: unknown, file: KitFileRecord): KitAmbientClassification {
  const c = asObject(raw, "ambient classification", "page-invalid");
  const outcome = oneOf(c.outcome, ["proven-ambient-only", "not-ambient-only", "undetermined"] as const, "ambient outcome", "page-invalid");
  const witnessFactIds = strArray(c, "witnessFactIds", "ambient classification", "page-invalid");
  if (Object.keys(c).length !== 6 || c.profile !== "typescript-ambient-stub-v1" || c.scope !== "entire-file" ||
      !file.contentSha256 || c.contentSha256 !== file.contentSha256 || file.language !== "typescript" || file.analyzerId !== "typescript-ast" ||
      new Set(witnessFactIds).size !== witnessFactIds.length ||
      (outcome === "proven-ambient-only" && (c.reasonCode !== null || !witnessFactIds.length ||
        file.status !== "parsed" || file.capabilities.declarations !== "complete")) ||
      (outcome === "not-ambient-only" && c.reasonCode !== "EXECUTABLE_SYNTAX_PRESENT") ||
      (outcome === "undetermined" && c.reasonCode !== "UNSUPPORTED_AMBIENT_PROFILE" && c.reasonCode !== "PARSE_UNCERTAINTY") ||
      (outcome !== "proven-ambient-only" && witnessFactIds.length !== 0)) {
    fail("page-invalid", "Contradictory whole-file ambient classification.");
  }
  return { profile: c.profile, scope: c.scope, contentSha256: file.contentSha256, outcome,
    reasonCode: c.reasonCode as KitAmbientClassification["reasonCode"], witnessFactIds };
}

function optionalColumn(obj: JsonObject, key: string, label: string): number | null {
  const value = obj[key];
  if (value === null || value === undefined) return null;
  if (typeof value !== "number" || !Number.isInteger(value) || value < 0) {
    fail("page-invalid", `${label}.${key} must be a non-negative integer or null.`);
  }
  return value;
}

function comparePosition(line: number, column: number | null, otherLine: number, otherColumn: number | null): number {
  return line - otherLine || (column ?? -1) - (otherColumn ?? -1);
}

function validExpressionSpan(span: KitSourceSpan): boolean {
  return span.startLine > 0 && span.startColumn !== null &&
    (span.endLine === null ? span.endColumn === null :
      span.endColumn !== null && comparePosition(span.endLine, span.endColumn, span.startLine, span.startColumn) > 0);
}

export function validateKitFact(value: unknown, label: string, filePath: string, schema?: unknown): KitFact {
  const obj = asObject(value, label, "page-invalid");
  const id = str(obj, "id", label, "page-invalid");
  if (!id.startsWith("audit-fact:")) {
    fail("page-invalid", `${label}.id is not a Kit audit fact identity: ${JSON.stringify(id)}.`);
  }
  const spanRaw = asObject(obj.span, `${label}.span`, "page-invalid");
  const spanPath = validateKitRelativePath(spanRaw.path, `${label}.span.path`);
  if (spanPath !== filePath) {
    fail("page-invalid", `${label}.span.path ${JSON.stringify(spanPath)} does not match file ${JSON.stringify(filePath)}.`);
  }
  const startLine = spanRaw.startLine;
  if (typeof startLine !== "number" || !Number.isInteger(startLine) || startLine < 1) {
    fail("page-invalid", `${label}.span.startLine must be a 1-based integer.`);
  }
  const fact: KitFact = {
    id,
    kind: str(obj, "kind", label, "page-invalid"),
    span: {
      path: spanPath,
      startLine,
      startColumn: optionalColumn(spanRaw, "startColumn", `${label}.span`),
      endLine: optionalColumn(spanRaw, "endLine", `${label}.span`),
      endColumn: optionalColumn(spanRaw, "endColumn", `${label}.span`),
    },
    extractionMethod: str(obj, "extractionMethod", label, "page-invalid"),
  };
  if (fact.kind === "dynamic-import-expression") {
    if (schema !== KIT_SOURCE_PROOF_SCHEMA_VERSION) fail("schema-mismatch", "Dynamic expression requires source-audit schema 1.2.0.");
    const operand = asObject(obj.operandSpan, "operand span", "page-invalid");
    const span = {
      path: filePath,
      startLine: int(operand, "startLine", "operand span", "page-invalid"),
      startColumn: optionalColumn(operand, "startColumn", "operand span"),
      endLine: optionalColumn(operand, "endLine", "operand span"),
      endColumn: optionalColumn(operand, "endColumn", "operand span"),
    };
    const operandForm = oneOf(obj.operandForm, ["string-literal", "qualified-string-binding", "computed"] as const,
      "dynamic operand form", "page-invalid");
    const linked = obj.literalImportFactId;
    const call = fact.span;
    if (Object.keys(obj).length !== (linked === undefined ? 6 : 7) || fact.extractionMethod !== "typescript-ast" ||
        Object.keys(spanRaw).length !== 5 || Object.keys(operand).length !== 5 || operand.path !== filePath ||
        !validExpressionSpan(call) || !validExpressionSpan(span) ||
        comparePosition(span.startLine, span.startColumn, call.startLine, call.startColumn) <= 0 ||
        (call.endLine !== null && (span.endLine === null ||
          comparePosition(span.endLine, span.endColumn, call.endLine, call.endColumn) > 0)) ||
        (linked !== undefined && (typeof linked !== "string" || operandForm === "computed" || !linked.startsWith("audit-fact:")))) {
      fail("page-invalid", "Malformed dynamic import expression or literal linkage.");
    }
    fact.dynamicImport = { operandForm, operandSpan: span, ...(typeof linked === "string" ? { literalImportFactId: linked } : {}) };
    return fact;
  }
  if (obj.operandForm !== undefined || obj.operandSpan !== undefined || obj.literalImportFactId !== undefined) {
    fail("page-invalid", "Dynamic expression fields require a dynamic expression fact.");
  }
  if (obj.jvmDeclaration !== undefined) {
    const identity = asObject(obj.jvmDeclaration, "jvmDeclaration", "page-invalid");
    if (fact.kind !== "declaration" || Object.keys(identity).sort().join(",") !== "packageName,qualifiedName,role" ||
        typeof identity.packageName !== "string" || identity.packageName !== "" && !/^[A-Za-z_$][\w$]*(?:\.[A-Za-z_$][\w$]*)*$/.test(identity.packageName) ||
        typeof identity.qualifiedName !== "string" || !/^[A-Za-z_$][\w$]*(?:\.[A-Za-z_$][\w$]*)*$/.test(identity.qualifiedName)) fail("page-invalid", "Malformed JVM declaration identity.");
    fact.jvmDeclaration = { packageName: identity.packageName, qualifiedName: identity.qualifiedName,
      role: oneOf(identity.role, ["type", "kotlin-top-level-function", "kotlin-top-level-property"] as const, "JVM declaration role", "page-invalid") };
  }
  if (obj.jvmImportTarget !== undefined) {
    const target = asObject(obj.jvmImportTarget, "jvmImportTarget", "page-invalid");
    if (fact.kind !== "import" || Object.keys(target).sort().join(",") !== "kind,qualifiedName" ||
        target.qualifiedName !== null && (typeof target.qualifiedName !== "string" || !/^[A-Za-z_$][\w$]*(?:\.[A-Za-z_$][\w$]*)*$/.test(target.qualifiedName))) fail("page-invalid", "Malformed JVM import target.");
    const kind = oneOf(target.kind, ["java-type", "java-static-owner", "kotlin-direct", "unsupported"] as const, "JVM target kind", "page-invalid");
    if (kind === "unsupported" && target.qualifiedName !== null) fail("page-invalid", "Unsupported JVM import has a guessed target.");
    fact.jvmImportTarget = { kind, qualifiedName: target.qualifiedName as string | null };
  }
  const optionalStrings = [
    "name",
    "symbolId",
    "declarationKind",
    "visibility",
    "exportOrigin",
    "sourceSpecifier",
    "importResolution",
    "observationKind",
  ] as const;
  for (const key of optionalStrings) {
    if (obj[key] === undefined) continue;
    if (typeof obj[key] !== "string") fail("page-invalid", `${label}.${key} must be a string.`);
    fact[key] = obj[key] as string;
  }
  // Kit's bounded literal payload is distinct from incomplete page traversal.
  // A redacted scalar stays unknown; no detector consumes it as an empty value.
  if (obj.value !== undefined) {
    if (obj.value !== null && typeof obj.value !== "string") fail("page-invalid", `${label}.value must be a string or null.`);
    fact.value = obj.value as string | null;
  }
  if (obj.valueSha256 !== undefined) {
    if (typeof obj.valueSha256 !== "string" || !SHA256_PATTERN.test(obj.valueSha256)) fail("page-invalid", `${label}.valueSha256 must be a SHA-256.`);
    fact.valueSha256 = obj.valueSha256;
  }
  if (obj.valueTruncated !== undefined) {
    if (typeof obj.valueTruncated !== "boolean" || obj.value === undefined) fail("page-invalid", `${label}.valueTruncated requires a boolean and value.`);
    fact.valueTruncated = obj.valueTruncated;
  }
  if (fact.valueTruncated === true && (fact.value !== null || fact.valueSha256 === undefined)) fail("page-invalid", `${label} truncated literal requires null and a hash.`);
  if (obj.ownerKey !== undefined) {
    if (obj.ownerKey !== null && typeof obj.ownerKey !== "string") {
      fail("page-invalid", `${label}.ownerKey must be a string or null.`);
    }
    fact.ownerKey = obj.ownerKey as string | null;
  }
  if (obj.exported !== undefined) {
    if (obj.exported !== null && typeof obj.exported !== "boolean") {
      fail("page-invalid", `${label}.exported must be a boolean or null.`);
    }
    fact.exported = obj.exported as boolean | null;
  }
  if (obj.importedNames !== undefined) fact.importedNames = strArray(obj, "importedNames", label, "page-invalid");
  if (obj.targetPaths !== undefined) {
    fact.targetPaths = strArray(obj, "targetPaths", label, "page-invalid").map((entry, index) =>
      validateKitRelativePath(entry, `${label}.targetPaths[${index}]`)
    );
  }
  if (fact.kind === "import" && fact.sourceSpecifier === undefined) {
    fail("page-invalid", `${label} is an import fact without sourceSpecifier.`);
  }
  if ((fact.kind === "declaration" || fact.kind === "export") && fact.name === undefined) {
    fail("page-invalid", `${label} is a ${fact.kind} fact without name.`);
  }
  if (fact.jvmDeclaration) {
    const identity = fact.jvmDeclaration;
    const owners = fact.ownerKey ? fact.ownerKey.split("/").slice(1).map(part => part.slice(part.indexOf(":") + 1)) : [];
    if (identity.qualifiedName !== [identity.packageName, ...owners, fact.name].filter(Boolean).join(".") || identity.role !== "type" && owners.length > 0) fail("page-invalid", "JVM declaration name or owner chain is inconsistent.");
  }
  return fact;
}

// ---------------------------------------------------------------------------
// Manifest reference and artifact header
// ---------------------------------------------------------------------------

export function validateKitManifestReference(manifest: unknown): KitManifestReference {
  const obj = asObject(manifest, "manifest", "artifact-invalid");
  if (obj.sourceAuditEvidence === undefined || obj.sourceAuditEvidence === null) {
    fail("artifact-missing", "the Kit manifest has no sourceAuditEvidence reference.");
  }
  const ref = asObject(obj.sourceAuditEvidence, "manifest.sourceAuditEvidence", "artifact-invalid");
  const reference: KitManifestReference = {
    path: str(ref, "path", "manifest.sourceAuditEvidence", "artifact-invalid"),
    schemaVersion: str(ref, "schemaVersion", "manifest.sourceAuditEvidence", "artifact-invalid"),
    sha256: str(ref, "sha256", "manifest.sourceAuditEvidence", "artifact-invalid"),
    snapshotId: str(ref, "snapshotId", "manifest.sourceAuditEvidence", "artifact-invalid"),
  };
  if (reference.path !== KIT_SOURCE_AUDIT_ARTIFACT_FILENAME) {
    fail("artifact-invalid", `manifest artifact path must be ${KIT_SOURCE_AUDIT_ARTIFACT_FILENAME}.`);
  }
  if (!["1.0.0", KIT_SOURCE_AUDIT_SCHEMA_VERSION, KIT_SOURCE_PROOF_SCHEMA_VERSION].includes(reference.schemaVersion)) {
    fail(
      "schema-mismatch",
      `manifest artifact schema ${reference.schemaVersion} is not ${KIT_SOURCE_AUDIT_SCHEMA_VERSION}.`
    );
  }
  if (!SHA256_PATTERN.test(reference.sha256) || !SHA256_PATTERN.test(reference.snapshotId)) {
    fail("artifact-invalid", "manifest artifact sha256 and snapshotId must be lowercase SHA-256 values.");
  }
  return reference;
}

export type KitArtifactExpectation = {
  packageName: string;
  packageVersion: string;
  artifactSchemaVersion: string;
};

export function validateKitArtifact(
  artifactBytes: Uint8Array,
  reference: KitManifestReference,
  expectation: KitArtifactExpectation
): KitArtifactHeader {
  const actualHash = sha256Hex(artifactBytes);
  if (actualHash !== reference.sha256) {
    fail(
      "artifact-invalid",
      `source-audit artifact SHA-256 ${actualHash} does not match the manifest value ${reference.sha256}.`
    );
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(Buffer.from(artifactBytes).toString("utf8"));
  } catch (error) {
    fail("invalid-json", `source-audit artifact is not valid JSON: ${error instanceof Error ? error.message : error}`);
  }
  const obj = asObject(parsed, "artifact", "artifact-invalid");
  if (obj.artifactKind !== KIT_SOURCE_AUDIT_ARTIFACT_KIND) {
    fail("artifact-invalid", `artifactKind must be ${KIT_SOURCE_AUDIT_ARTIFACT_KIND}.`);
  }
  if (obj.schemaVersion !== expectation.artifactSchemaVersion) {
    fail("schema-mismatch", `artifact schemaVersion ${JSON.stringify(obj.schemaVersion)} is not ${expectation.artifactSchemaVersion}.`);
  }
  const producerRaw = asObject(obj.producer, "artifact.producer", "artifact-invalid");
  const producer: KitProducerIdentity = {
    packageName: str(producerRaw, "packageName", "artifact.producer", "artifact-invalid"),
    packageVersion: str(producerRaw, "packageVersion", "artifact.producer", "artifact-invalid"),
  };
  if (producer.packageName !== expectation.packageName || producer.packageVersion !== expectation.packageVersion) {
    fail(
      "package-identity",
      `artifact producer ${producer.packageName}@${producer.packageVersion} is not ${expectation.packageName}@${expectation.packageVersion}.`
    );
  }
  const sourceRaw = asObject(obj.source, "artifact.source", "artifact-invalid");
  const source: KitSourceSelection = {
    projectRoot: str(sourceRaw, "projectRoot", "artifact.source", "artifact-invalid"),
    sourceRoots: strArray(sourceRaw, "sourceRoots", "artifact.source", "artifact-invalid"),
    excludes: strArray(sourceRaw, "excludes", "artifact.source", "artifact-invalid"),
    symbolIndexSchemaVersion: str(sourceRaw, "symbolIndexSchemaVersion", "artifact.source", "artifact-invalid"),
    codeGraphSchemaVersion: str(sourceRaw, "codeGraphSchemaVersion", "artifact.source", "artifact-invalid"),
    selectionFingerprint: str(sourceRaw, "selectionFingerprint", "artifact.source", "artifact-invalid"),
    snapshotId: str(sourceRaw, "snapshotId", "artifact.source", "artifact-invalid"),
  };
  if (source.snapshotId !== reference.snapshotId) {
    fail("snapshot-mismatch", "artifact snapshotId differs from the manifest snapshotId.");
  }
  const coverage = validateKitCoverage(obj.coverage, "artifact.coverage");
  if (!Array.isArray(obj.files)) {
    fail("artifact-invalid", "artifact.files must be an array.");
  }
  const seen = new Set<string>();
  const files = obj.files.map((entry, index) => {
    const file = asObject(entry, `artifact.files[${index}]`, "artifact-invalid");
    const filePath = validateKitRelativePath(file.path, `artifact.files[${index}].path`);
    if (seen.has(filePath)) fail("artifact-invalid", `artifact repeats file ${filePath}.`);
    seen.add(filePath);
    const hash = file.contentSha256 ?? null;
    if (hash !== null && (typeof hash !== "string" || !SHA256_PATTERN.test(hash))) {
      fail("artifact-invalid", `artifact.files[${index}].contentSha256 is invalid.`);
    }
    return {
      path: filePath,
      contentSha256: hash as string | null,
      language: str(file, "language", `artifact.files[${index}]`, "artifact-invalid"),
      role: oneOf(file.role, KIT_FILE_ROLES, `artifact.files[${index}].role`, "artifact-invalid"),
      status: oneOf(file.status, KIT_FILE_STATUSES, `artifact.files[${index}].status`, "artifact-invalid"),
    };
  });
  return {
    artifactKind: KIT_SOURCE_AUDIT_ARTIFACT_KIND,
    schemaVersion: expectation.artifactSchemaVersion,
    producer,
    source,
    coverage,
    files,
  };
}

// ---------------------------------------------------------------------------
// Page validation
// ---------------------------------------------------------------------------

type PageEnvelope = {
  snapshotId: string;
  pageIndex: number;
  totalItems: number;
  totalPages: number;
  nextPageIndex: number | null;
};

function validateEnvelope(
  obj: JsonObject,
  expected: { mode: string; snapshotId: string; pageIndex: number; pageSize: number },
  label: string
): PageEnvelope {
  if (!["1.0.0", KIT_SOURCE_AUDIT_SCHEMA_VERSION, KIT_SOURCE_PROOF_SCHEMA_VERSION].includes(obj.schemaVersion as string)) {
    fail("schema-mismatch", `${label} schemaVersion ${JSON.stringify(obj.schemaVersion)} is not ${KIT_SOURCE_AUDIT_SCHEMA_VERSION}.`);
  }
  if (obj.mode !== expected.mode) {
    fail("page-invalid", `${label} mode ${JSON.stringify(obj.mode)} is not ${expected.mode}.`);
  }
  const snapshotId = str(obj, "snapshotId", label, "page-invalid");
  if (snapshotId !== expected.snapshotId) {
    fail("snapshot-mismatch", `${label} snapshotId ${snapshotId} differs from ${expected.snapshotId}.`);
  }
  const pageIndex = int(obj, "pageIndex", label, "page-invalid");
  if (pageIndex !== expected.pageIndex) {
    fail("page-invalid", `${label} returned page ${pageIndex} but page ${expected.pageIndex} was requested.`);
  }
  if (int(obj, "pageSize", label, "page-invalid") !== expected.pageSize) {
    fail("page-invalid", `${label} pageSize is not ${expected.pageSize}.`);
  }
  const totalItems = int(obj, "totalItems", label, "page-invalid");
  const totalPages = int(obj, "totalPages", label, "page-invalid");
  const derivedPages = Math.max(1, Math.ceil(totalItems / expected.pageSize));
  if (totalPages !== derivedPages) {
    fail("page-invalid", `${label} totalPages ${totalPages} is inconsistent with totalItems ${totalItems} (expected ${derivedPages}).`);
  }
  if (pageIndex >= totalPages) {
    fail("page-invalid", `${label} page ${pageIndex} is beyond the declared ${totalPages} page(s).`);
  }
  const next = obj.nextPageIndex;
  const terminal = pageIndex === totalPages - 1;
  if (terminal ? next !== null : next !== pageIndex + 1) {
    fail("page-invalid", `${label} nextPageIndex ${JSON.stringify(next)} is invalid for page ${pageIndex} of ${totalPages}.`);
  }
  return { snapshotId, pageIndex, totalItems, totalPages, nextPageIndex: next as number | null };
}

function expectedRecordCount(envelope: PageEnvelope, pageSize: number): number {
  return envelope.pageIndex === envelope.totalPages - 1
    ? envelope.totalItems - envelope.pageIndex * pageSize
    : pageSize;
}

export function validateInventoryPage(raw: unknown, expected: { snapshotId: string; pageIndex: number }): KitInventoryPage {
  const label = `inventory page ${expected.pageIndex}`;
  const obj = asObject(raw, label, "page-invalid");
  const envelope = validateEnvelope(obj, { mode: "audit-files", pageSize: KIT_INVENTORY_PAGE_SIZE, ...expected }, label);
  const coverage = validateKitCoverage(obj.coverage, `${label}.coverage`);
  if (!Array.isArray(obj.files)) fail("page-invalid", `${label}.files must be an array.`);
  if (obj.files.length !== expectedRecordCount(envelope, KIT_INVENTORY_PAGE_SIZE)) {
    fail("page-invalid", `${label} holds ${obj.files.length} record(s), expected ${expectedRecordCount(envelope, KIT_INVENTORY_PAGE_SIZE)}.`);
  }
  const files = obj.files.map((entry, index) => {
    const record = validateKitFileRecord(entry, `${label}.files[${index}]`, obj.schemaVersion);
    if (record.diagnostics !== undefined) {
      fail("page-invalid", `${label}.files[${index}] unexpectedly carries diagnostics.`);
    }
    return record;
  });
  return { ...envelope, coverage, files };
}

export function validateFactPage(
  raw: unknown,
  expected: { snapshotId: string; pageIndex: number; path: string }
): KitFactPage {
  const label = `fact page ${expected.pageIndex} of ${expected.path}`;
  const obj = asObject(raw, label, "page-invalid");
  const envelope = validateEnvelope(obj, { mode: "audit-file", pageSize: KIT_FACT_PAGE_SIZE, snapshotId: expected.snapshotId, pageIndex: expected.pageIndex }, label);
  const status = oneOf(obj.status, ["found", "unsupported"] as const, `${label}.status`, "selection-incomplete");
  if (obj.file === null || obj.file === undefined) {
    fail("selection-incomplete", `${label} returned no file record.`);
  }
  const file = validateKitFileRecord(obj.file, `${label}.file`, obj.schemaVersion);
  if (file.path !== expected.path) {
    fail("page-invalid", `${label} describes ${file.path}.`);
  }
  if (!Array.isArray(obj.facts)) fail("page-invalid", `${label}.facts must be an array.`);
  if (obj.facts.length !== expectedRecordCount(envelope, KIT_FACT_PAGE_SIZE)) {
    fail("page-invalid", `${label} holds ${obj.facts.length} fact(s), expected ${expectedRecordCount(envelope, KIT_FACT_PAGE_SIZE)}.`);
  }
  const facts = obj.facts.map((entry, index) => validateKitFact(entry, `${label}.facts[${index}]`, expected.path, obj.schemaVersion));
  for (const fact of facts) {
    if (fact.jvmDeclaration && (!/\.(java|kt)$/i.test(file.path) || fact.jvmDeclaration.packageName !== file.jvmPackageName)) fail("page-invalid", "Declaration package differs from its ordinary file identity.");
    if (file.capabilities.jvmDeclarations === "complete" && fact.kind === "declaration" && !fact.jvmDeclaration) fail("page-invalid", "Complete JVM declarations omit identity.");
  }
  return { ...envelope, status, file, facts };
}

// Drives a zero-based page sequence to its declared end. The fetcher owns
// transport; this owns the completeness rule: a traversal is complete only
// when every declared page was fetched, validated, and the terminal page
// reports no next page. Never stops at the first page.
export async function collectAllPages<TPage extends PageEnvelope>(
  fetchPage: (pageIndex: number) => Promise<TPage>,
  options: { maxPages: number; label: string }
): Promise<TPage[]> {
  const pages: TPage[] = [];
  let pageIndex = 0;
  for (;;) {
    if (pages.length >= options.maxPages) {
      fail("traversal-incomplete", `${options.label} exceeded the ${options.maxPages}-page traversal limit.`);
    }
    const page = await fetchPage(pageIndex);
    const first = pages[0];
    if (first !== undefined) {
      if (page.snapshotId !== first.snapshotId) {
        fail("snapshot-mismatch", `${options.label} mixes snapshot ids across pages.`);
      }
      if (page.totalItems !== first.totalItems || page.totalPages !== first.totalPages) {
        fail("page-invalid", `${options.label} reports inconsistent totals across pages.`);
      }
    }
    pages.push(page);
    if (page.nextPageIndex === null) break;
    if (page.nextPageIndex !== pageIndex + 1) {
      fail("page-invalid", `${options.label} skipped from page ${pageIndex} to ${page.nextPageIndex}.`);
    }
    pageIndex = page.nextPageIndex;
  }
  const last = pages[pages.length - 1]!;
  if (pages.length !== last.totalPages) {
    fail("traversal-incomplete", `${options.label} fetched ${pages.length} page(s) of ${last.totalPages} declared.`);
  }
  return pages;
}

export function flattenInventoryPages(pages: readonly KitInventoryPage[]): KitFileRecord[] {
  const seen = new Set<string>();
  const files: KitFileRecord[] = [];
  for (const page of pages) {
    for (const file of page.files) {
      if (seen.has(file.path.toLowerCase())) {
        fail("page-invalid", `inventory repeats file identity ${file.path}.`);
      }
      seen.add(file.path.toLowerCase());
      files.push(file);
    }
  }
  const total = pages[0]?.totalItems ?? 0;
  if (files.length !== total) {
    fail("traversal-incomplete", `inventory traversal collected ${files.length} file(s) of ${total} declared.`);
  }
  return files;
}

export function flattenFactPages(path: string, pages: readonly KitFactPage[], globalFactIds: Set<string>): KitFact[] {
  const facts: KitFact[] = [];
  for (const page of pages) {
    if (pages[0]) crossValidateFileRecord(pages[0].file, page.file);
    for (const fact of page.facts) {
      if (globalFactIds.has(fact.id)) {
        fail("page-invalid", `fact identity ${fact.id} is repeated (file ${path}).`);
      }
      globalFactIds.add(fact.id);
      facts.push(fact);
    }
  }
  const total = pages[0]?.totalItems ?? 0;
  if (facts.length !== total) {
    fail("traversal-incomplete", `fact traversal of ${path} collected ${facts.length} fact(s) of ${total} declared.`);
  }
  const record = pages[0]?.file;
  if (record?.capabilities["dynamic-import-expressions"] !== undefined) validateVersionedFileFacts(record, facts);
  return facts;
}

function validateVersionedFileFacts(record: KitFileRecord, facts: readonly KitFact[]): void {
  const byId = new Map(facts.map(fact => [fact.id, fact]));
  const expressions = new Set<string>();
  for (const fact of facts) {
    const expression = fact.dynamicImport;
    if (!expression) continue;
    const location = [fact.span.startLine, fact.span.startColumn].join("#");
    const expectedId = ["audit-fact:" + encodeURIComponent(record.path), fact.kind, location, "0"].join("#");
    if (!["complete", "partial"].includes(record.capabilities["dynamic-import-expressions"] ?? "") ||
        fact.id !== expectedId || expressions.has(location) || record.lineCount === null ||
        [fact.span, expression.operandSpan].some(span => (span.endLine ?? span.startLine) > record.lineCount!)) {
      fail("page-invalid", "Invalid dynamic expression identity or capability.");
    }
    expressions.add(location);
    if (expression.literalImportFactId !== undefined) {
      const linked = byId.get(expression.literalImportFactId);
      const importId = ["audit-fact:" + encodeURIComponent(record.path), "import", location, "0"].join("#");
      if (!linked || linked.id !== importId || linked.kind !== "import" || linked.extractionMethod !== fact.extractionMethod ||
          linked.sourceSpecifier === undefined || JSON.stringify(linked.span) !== JSON.stringify(fact.span)) {
        fail("page-invalid", "Dynamic expression has an invalid linked ordinary import.");
      }
    }
  }
  const ambient = record.ambientClassification;
  if (ambient?.outcome === "proven-ambient-only" &&
      (ambient.witnessFactIds.length !== facts.length || ambient.witnessFactIds.some(id => {
        const fact = byId.get(id);
        return !fact || fact.kind !== "declaration" || fact.declarationKind !== "ambient-module" ||
          fact.extractionMethod !== "typescript-ast" || !fact.name || !validExpressionSpan(fact.span);
      }))) {
    fail("page-invalid", "Whole-file ambient proof does not identify its actual declaration witnesses.");
  }
}

// ---------------------------------------------------------------------------
// Cross-validation and completeness
// ---------------------------------------------------------------------------

export function expectedSourceRootsMatch(selected: readonly string[], requested: readonly string[]): boolean {
  return selected.length === requested.length && selected.every((root, index) => root === requested[index]);
}

// Artifact header, inventory pages and the traversal must describe the same
// selection. Inventory pages are an index snapshot, not live filesystem proof.
export function crossValidateInventory(
  header: KitArtifactHeader,
  inventory: readonly KitFileRecord[],
  pages: readonly KitInventoryPage[],
  requestedRoots: readonly string[]
): void {
  if (pages.some((page) => page.snapshotId !== header.source.snapshotId)) {
    fail("snapshot-mismatch", "inventory snapshotId differs from the artifact snapshotId.");
  }
  if (!expectedSourceRootsMatch(header.source.sourceRoots, requestedRoots)) {
    fail(
      "root-mismatch",
      `artifact sourceRoots [${header.source.sourceRoots.join(", ")}] differ from requested [${requestedRoots.join(", ")}].`
    );
  }
  const { coverage } = header;
  if (!coverage.inventoryComplete || !coverage.exclusionsAreExplicit) {
    fail("selection-incomplete", "Kit reports an incomplete inventory or non-explicit exclusions.");
  }
  if (coverage.unreadableFileCount > 0) {
    fail("selection-incomplete", `Kit reports ${coverage.unreadableFileCount} unreadable selected file(s).`);
  }
  if (coverage.selectedFileCount !== coverage.recordedFileCount || coverage.recordedFileCount !== inventory.length) {
    fail(
      "selection-incomplete",
      `coverage selected=${coverage.selectedFileCount} recorded=${coverage.recordedFileCount} but ${inventory.length} inventory record(s) were traversed.`
    );
  }
  for (const page of pages) {
    if (JSON.stringify(page.coverage) !== JSON.stringify(coverage)) {
      fail("page-invalid", "an inventory page coverage block differs from the artifact coverage.");
    }
  }
  const byPath = new Map(header.files.map((file) => [file.path, file]));
  if (byPath.size !== inventory.length) {
    fail("selection-incomplete", "artifact file list and inventory traversal differ in size.");
  }
  for (const record of inventory) {
    const artifactEntry = byPath.get(record.path);
    if (
      artifactEntry === undefined ||
      artifactEntry.contentSha256 !== record.contentSha256 ||
      artifactEntry.language !== record.language ||
      artifactEntry.role !== record.role ||
      artifactEntry.status !== record.status
    ) {
      fail("selection-incomplete", `inventory record for ${record.path} does not match the artifact.`);
    }
  }
}

// An exact-file lookup must describe the file as the inventory did. Any
// difference means the source or index changed between calls.
export function crossValidateFileRecord(inventoryRecord: KitFileRecord, lookupRecord: KitFileRecord): void {
  const a = { ...inventoryRecord, diagnostics: undefined };
  const b = { ...lookupRecord, diagnostics: undefined };
  if (JSON.stringify(a) !== JSON.stringify(b)) {
    fail("stale-evidence", `exact-file record for ${inventoryRecord.path} differs from its inventory record.`);
  }
}

// Capabilities Lab requires per language group. A missing, unsupported,
// failed or partial required capability is fatal for the applicable file;
// not-applicable is accepted only where Kit says the capability does not
// apply to the file role.
export type KitRequiredCapabilities = readonly KitCapabilityName[];

// Private consumer qualification, never a producer or persisted schema. Only
// the adapter registers authenticated, fully traversed evidence. Object identity
// and captured values prevent later fabricated or mutated facts gaining trust.
export type KitPredicateQualification = "QUALIFIED_POSITIVE" | "QUALIFIED_NEGATIVE" | "UNAVAILABLE";
const predicateEvidence = new WeakMap<SourceFileFacts, {
  identity: string; declarations: Map<DeclarationFact, string>; negative: boolean; allDeclarations: string;
  imports: Map<ImportFact, string>; negativeImports: boolean; allImports: string;
}>();
const predicateFileIdentity = (file: SourceFileFacts) => JSON.stringify({ path: file.relativePath,
  language: file.language, role: file.role, analyzerId: file.analyzerId, kit: file.kit });

export function registerKitDeclarationPredicateEvidence(file: SourceFileFacts, evidence: KitSourceEvidence): void {
  const exact = evidence.fileEvidence.get(file.relativePath);
  if (!exact || !evidence.traversalComplete || !evidence.coverage.inventoryComplete ||
      !/^[a-f0-9]{64}$/.test(evidence.snapshotId) || !exact.record.contentSha256 ||
      !["parsed", "partial"].includes(exact.record.status)) return;
  const declarations = new Map<DeclarationFact, string>();
  for (const declaration of file.declarations) {
    const fact = exact.facts.find(f => f.kind === "declaration" && f.id === declaration.provenance?.factId);
    if (fact && fact.name === declaration.name && fact.span.path === file.relativePath &&
        fact.span.startLine === declaration.provenance?.startLine &&
        ["complete", "partial"].includes(exact.record.capabilities.declarations)) {
      declarations.set(declaration, JSON.stringify(declaration));
    }
  }
  const imports = new Map<ImportFact, string>();
  for (const observed of file.imports) {
    const fact = exact.facts.find(f => f.kind === "import" && f.id === observed.provenance?.factId);
    if (fact && fact.sourceSpecifier === observed.source && fact.span.path === file.relativePath &&
        fact.span.startLine === observed.provenance?.startLine &&
        ["complete", "partial"].includes(exact.record.capabilities.imports)) imports.set(observed, JSON.stringify(observed));
  }
  predicateEvidence.set(file, { identity: predicateFileIdentity(file), declarations, imports,
    // This proves the declaration-name domain only. A qualified-identity
    // predicate must separately account for observed names lacking identity.
    negative: exact.record.capabilities.declarations === "complete",
    negativeImports: exact.record.capabilities.imports === "complete",
    allImports: JSON.stringify(file.imports),
    allDeclarations: JSON.stringify(file.declarations) });
}

export function qualifyKitDeclarationPredicate(file: SourceFileFacts, declaration?: DeclarationFact): KitPredicateQualification {
  const trusted = predicateEvidence.get(file);
  if (!trusted || trusted.identity !== predicateFileIdentity(file)) return "UNAVAILABLE";
  if (declaration === undefined) return trusted.negative &&
    trusted.allDeclarations === JSON.stringify(file.declarations) ? "QUALIFIED_NEGATIVE" : "UNAVAILABLE";
  if (!file.declarations.includes(declaration) || trusted.declarations.get(declaration) !== JSON.stringify(declaration)) return "UNAVAILABLE";
  const supported = ["class", "interface", "enum", "function"].includes(declaration.kind) ||
    (file.language === "kotlin" && declaration.kind === "unknown" && declaration.providerKind === "object" &&
      declaration.jvmDeclaration?.role === "type" && declaration.provenance?.extractionMethod === "kotlin-lexical");
  return supported ? "QUALIFIED_POSITIVE" : "UNAVAILABLE";
}

// Completeness qualifies only this file's explicit import inventory. It does
// not establish resolution, cross-file absence or audit readiness.
export function qualifyKitImportPredicate(file: SourceFileFacts, observed?: ImportFact): KitPredicateQualification {
  const trusted = predicateEvidence.get(file);
  if (!trusted || trusted.identity !== predicateFileIdentity(file)) return "UNAVAILABLE";
  if (observed === undefined) return trusted.negativeImports && trusted.allImports === JSON.stringify(file.imports)
    ? "QUALIFIED_NEGATIVE" : "UNAVAILABLE";
  return file.imports.includes(observed) && trusted.imports.get(observed) === JSON.stringify(observed)
    ? "QUALIFIED_POSITIVE" : "UNAVAILABLE";
}

// Internal acquisition route only after the provider validates explicit known
// detector requirements. Retention is not a completeness or negative claim.
export function assertPredicateScopedCapabilities(record: KitFileRecord, required: KitRequiredCapabilities): void {
  if (!["parsed", "partial"].includes(record.status) || !record.contentSha256 || !/^[a-f0-9]{64}$/.test(record.contentSha256)) {
    fail("capability-insufficient", `${record.path} lacks hash-identified parsed/partial predicate evidence.`);
  }
  for (const capability of required) {
    if (!["declarations", "imports"].includes(capability) ||
        !["complete", "partial"].includes(record.capabilities[capability])) assertRequiredCapabilities(record, [capability]);
  }
}

// Acquisition permission for the registry's docs-only positive route. This
// permits retrieval, not negative inference or a claim of complete parsing.
export function assertQualifiedPartialDeclarations(record: KitFileRecord, required: KitRequiredCapabilities): void {
  if (required.length !== 1 || required[0] !== "declarations" ||
      !["java", "kotlin"].includes(record.language) || !["parsed", "partial"].includes(record.status) ||
      !["complete", "partial"].includes(record.capabilities.declarations) ||
      !record.contentSha256 || !/^[a-f0-9]{64}$/.test(record.contentSha256)) {
    assertRequiredCapabilities(record, required);
  }
}

// Retrieval permission only: a pinned producer's explicit unresolved import is
// valid evidence, but cannot discharge an import-dependent audit predicate.
export function hasQualifiedPartialImports(record: KitFileRecord): boolean {
  return record.status === "parsed" && record.capabilities.imports === "partial" &&
    record.contentSha256 !== null && /^[a-f0-9]{64}$/.test(record.contentSha256) &&
    !!record.diagnostics?.some(d => ["unsupported-dynamic-import", "unsupported-require"].includes(d.code));
}

export function assertRequiredCapabilities(
  record: KitFileRecord,
  required: KitRequiredCapabilities
): void {
  if (required.length === 0) return;
  if (record.status !== "parsed") {
    fail("capability-insufficient", `${record.path} has Kit file status ${record.status}; parsed evidence is required.`);
  }
  for (const capability of required) {
    const status = record.capabilities[capability];
    if (status !== "complete") {
      fail(
        "capability-insufficient",
        `${record.path} capability ${capability} is ${status ?? "missing"}; complete evidence is required.`
      );
    }
  }
}

// Raw content is a separate contract from parsed language facts. Callers must
// first establish selected-inventory authority and test-content applicability.
// A hash permits an exact-file query; only its validated complete response can
// establish literal presence/absence. This grants no semantic capabilities.
export function assertKitJsonRawContent(record: KitFileRecord, qualifiedProducer: boolean): void {
  if (!qualifiedProducer || !record.path.endsWith(".json") || record.status !== "unsupported" ||
      record.contentSha256 === null || !/^[a-f0-9]{64}$/.test(record.contentSha256)) {
    fail("capability-insufficient", `${record.path} lacks qualified hash-identified JSON raw content evidence.`);
  }
}

export function assertSelectionCoversRequired(
  inventory: readonly KitFileRecord[],
  requiredPaths: readonly string[]
): void {
  const selected = new Set<string>();
  const identities = new Set<string>();
  for (const file of inventory) {
    validateKitRelativePath(file.path, "selected Kit path");
    if (identities.has(file.path.toLowerCase())) fail("path-invalid", `ambiguous selected file identity ${file.path}.`);
    identities.add(file.path.toLowerCase());
    selected.add(file.path);
  }
  const requiredIdentities = new Set<string>();
  for (const required of requiredPaths) {
    validateKitRelativePath(required, "required Lab path");
    if (requiredIdentities.has(required.toLowerCase())) fail("path-invalid", `ambiguous required file identity ${required}.`);
    requiredIdentities.add(required.toLowerCase());
    if (!selected.has(required) && identities.has(required.toLowerCase())) fail("path-invalid", `case-ambiguous file identity ${required}.`);
  }
  const missing = requiredPaths.filter((entry) => !selected.has(entry));
  if (missing.length > 0) {
    const shown = missing.slice(0, 20).join(", ");
    fail(
      "selection-incomplete",
      `${missing.length} Lab source/test file(s) fall outside Kit's selected coverage (${shown}${missing.length > 20 ? ", ..." : ""}).`
    );
  }
}


export type KitImportDomain = {
  expressionFactId: string;
  snapshotId: string;
  reasonCode: string | null;
  outcome: "finite" | "indeterminate" | "disjoint-selected-domain";
  domainComplete: boolean;
  positivePaths: readonly string[];
  excludesSelectedDomain: boolean;
};

export function validateKitImportDomain(raw: unknown, evidence: KitSourceEvidence, fact: KitFact): KitImportDomain {
  const r = asObject(raw, "import domain", "artifact-invalid");
  const origin = evidence.fileEvidence.get(fact.span.path);
  const sameSpan = (a: unknown, b: KitSourceSpan | undefined) => {
    if (!b || !a || typeof a !== "object") return false;
    const x = a as Record<string, unknown>;
    return x.path === b.path && x.startLine === b.startLine && x.startColumn === b.startColumn &&
      x.endLine === b.endLine && x.endColumn === b.endColumn;
  };
  const selected = new Map(evidence.inventory.map(f => [f.path, f]));
  if (r.mode !== "audit-import-domain" || r.schemaVersion !== "1.0.0" || evidence.artifactSchemaVersion !== "1.2.0")
    fail("schema-mismatch", "Unqualified import-domain protocol.");
  if (!origin?.record.contentSha256 || !fact.dynamicImport || r.snapshotId !== evidence.snapshotId ||
      r.selectionFingerprint !== evidence.source.selectionFingerprint || r.originFile !== fact.span.path ||
      r.originContentSha256 !== origin.record.contentSha256 || r.importExpressionFactId !== fact.id ||
      r.resolverProfile !== "js-ts-dynamic-import-v1" || r.pathIdentityProfile !== "selected-source-path-v1" ||
      r.resolutionPlatform !== (process.platform === "win32" ? "win32" : "posix") ||
      r.selectedDomainDigest !== sha256Hex(JSON.stringify([...selected.keys()].sort())))
    fail("artifact-invalid", "Import domain identity or resolver profile differs from validated evidence.");
  const outcome = oneOf(r.outcome, ["finite", "indeterminate", "disjoint-selected-domain"] as const, "domain outcome", "artifact-invalid");
  const refs = r.premiseRefs, alternatives = r.operandAlternatives, witnesses = r.qualifiedPositiveWitnesses;
  const finite = outcome !== "indeterminate";
  if (!Array.isArray(refs) || refs.length > 256 || !Array.isArray(alternatives) || alternatives.length > 64 ||
      !Array.isArray(witnesses) || witnesses.length > 1 || r.domainComplete !== finite ||
      (finite ? !alternatives.length || !refs.length || r.reasonCode !== null :
        alternatives.length || refs.length || witnesses.length || typeof r.reasonCode !== "string" || !r.reasonCode))
    fail("artifact-invalid", "Invalid import-domain completeness or budget.");
  for (const rawRef of refs) {
    const ref = asObject(rawRef, "domain premise", "artifact-invalid");
    if (ref.type !== "source-span" || ref.filePath !== fact.span.path || ref.contentSha256 !== origin.record.contentSha256 ||
        !["operand", "guard", "operation", "binding"].includes(String(ref.role))) fail("artifact-invalid", "Wrong premise provenance.");
    const span = asObject(ref.span, "premise span", "artifact-invalid");
    if (span.path !== fact.span.path || ![span.startLine, span.endLine].every(v => Number.isSafeInteger(v) && Number(v) >= 1 && Number(v) <= (origin.record.lineCount ?? 0)) ||
        ![span.startColumn, span.endColumn].every(v => Number.isSafeInteger(v) && Number(v) >= 0) ||
        Number(span.startLine) > Number(span.endLine) ||
        (span.startLine === span.endLine && Number(span.startColumn) > Number(span.endColumn)) ||
        (ref.role === "operand" && !sameSpan(span, fact.dynamicImport.operandSpan))) fail("artifact-invalid", "Invalid premise span.");
  }
  const validIndexes = (v: unknown): v is number[] => Array.isArray(v) && v.length > 0 &&
    new Set(v).size === v.length && v.every(i => Number.isSafeInteger(i) && i >= 0 && i < refs.length) &&
    v.some(i => refs[i]?.role === "operand");
  const seen = new Set<string>(), paths: string[] = [];
  const selectionComplete = evidence.coverage.inventoryComplete && evidence.coverage.exclusionsAreExplicit;
  const candidates = alternatives.map((rawAlt, i) => {
    const a = asObject(rawAlt, "domain alternative", "artifact-invalid");
    const q = asObject(a.resolution, "alternative resolution", "artifact-invalid");
    if (a.alternativeIndex !== i || typeof a.specifier !== "string" || Buffer.byteLength(a.specifier) > 4096 ||
        seen.has(a.specifier) || !validIndexes(a.premiseIndexes) ||
        !["present", "proven-missing", "indeterminate", "outside-selected-roots"].includes(String(q.status)) ||
        typeof q.reasonCode !== "string" || typeof q.candidateEnumerationComplete !== "boolean" ||
        q.selectionComplete !== selectionComplete || !Array.isArray(q.candidatePaths) ||
        new Set(q.candidatePaths).size !== q.candidatePaths.length)
      fail("artifact-invalid", "Invalid import-domain alternative.");
    seen.add(a.specifier);
    const pp = q.candidatePaths.map(v => validateKitRelativePath(v, "domain candidate"));
    const isSelected = (p: string) => selected.has(p) || (process.platform === "win32" &&
      [...selected.keys()].some(k => k.toLowerCase() === p.toLowerCase()));
    if (q.status === "proven-missing" && (!selectionComplete || !q.candidateEnumerationComplete ||
        q.reasonCode !== "ALL_CANDIDATES_ABSENT_IN_COMPLETE_SELECTION" || !pp.length || pp.some(isSelected)))
      fail("artifact-invalid", "Contradictory absence in a domain alternative.");
    if (q.candidateEnumerationComplete && q.status !== "present" && q.status !== "proven-missing")
      fail("artifact-invalid", "An indeterminate alternative cannot close its candidate domain.");
    paths.push(...pp);
    return { status: q.status, complete: q.candidateEnumerationComplete, specifier: a.specifier, paths: pp };
  });
  if (paths.length > 256) fail("artifact-invalid", "Domain candidate path budget exceeded.");
  if (outcome === "disjoint-selected-domain") {
    const proof = asObject(r.disjointProof, "disjoint proof", "artifact-invalid");
    if (!selectionComplete || !evidence.traversalComplete || !paths.length || proof.rule !== "fixed-normalized-path-v1" ||
        !validIndexes(proof.premiseIndexes) || JSON.stringify(proof.values) !== JSON.stringify([...new Set(paths)].sort()) ||
        candidates.some(a => a.status !== "proven-missing" || !a.complete))
      fail("artifact-invalid", "Unqualified selected-domain exclusion.");
  } else if (r.disjointProof !== null) fail("artifact-invalid", "Unexpected disjoint proof.");

  const link = origin.facts.find(f => f.id === fact.dynamicImport?.literalImportFactId);
  if (link && finite && (candidates.length !== 1 || candidates[0]?.specifier !== link.sourceSpecifier))
    fail("artifact-invalid", "Domain operand differs from linked literal fact.");
  const positivePaths = witnesses.map(rawWitness => {
    const witness = asObject(rawWitness, "positive witness", "artifact-invalid");
    const target = validateKitRelativePath(witness.targetPath, "positive witness target");
    const record = selected.get(target);
    if (!link || witness.importFactId !== link.id || outcome !== "finite" || !record?.contentSha256 ||
        record.contentSha256 !== witness.targetContentSha256 || candidates.length !== 1 ||
        candidates[0]?.status !== "present" || !candidates[0].complete || !candidates[0].paths.includes(target))
      fail("artifact-invalid", "Unqualified positive reference witness.");
    const proof = validateKitImportProof(witness.targetProof, { snapshotId: evidence.snapshotId, fact: link, evidence });
    if (proof.status !== "present" || proof.reasonCode !== "TARGET_IN_SELECTED_INVENTORY" ||
        proof.candidatePaths.length !== 1 || proof.candidatePaths[0] !== target) fail("artifact-invalid", "Wrong linked target witness.");
    // Check the producer's exact file identity claim without enumerating or resolving any alternatives.
    try {
      const url = new URL(link.sourceSpecifier!, pathToFileURL(path.resolve(evidence.source.projectRoot, fact.span.path)));
      if (path.relative(evidence.source.projectRoot, fileURLToPath(url)).split(path.sep).join("/") !== target)
        fail("artifact-invalid", "Positive witness refers to a substituted path.");
    } catch { fail("artifact-invalid", "Positive witness is not an exact file URL identity."); }
    return target;
  });
  return { expressionFactId: fact.id, snapshotId: evidence.snapshotId,
    reasonCode: typeof r.reasonCode === "string" ? r.reasonCode : null, outcome, domainComplete: finite, positivePaths, excludesSelectedDomain: outcome === "disjoint-selected-domain" };
}

export type KitByteOccurrence = { complete: boolean; matchCount: number; matches: { startByte: number; endByteExclusive: number }[] };

export function validateKitByteOccurrence(raw: unknown, evidence: KitSourceEvidence, file: KitFileRecord, needle: string): KitByteOccurrence {
  const r = asObject(raw, "byte occurrence", "artifact-invalid");
  if (r.mode !== "exact-file-byte-occurrence" || r.schemaVersion !== "1.0.0" || evidence.artifactSchemaVersion !== "1.2.0")
    fail("schema-mismatch", "Unqualified byte occurrence protocol.");
  if (r.snapshotId !== evidence.snapshotId || r.selectionFingerprint !== evidence.source.selectionFingerprint ||
      r.filePath !== file.path || r.sizeBytes !== file.sizeBytes || r.needleHex !== needle ||
      r.matching !== "literal-bytes-overlapping" || r.expectedContentSha256 !== file.contentSha256)
    fail("artifact-invalid", "Byte occurrence identity mismatch.");
  const integer = (v: unknown, max: number): v is number => Number.isSafeInteger(v) && Number(v) >= 0 && Number(v) <= max;
  if (!integer(r.scannedBytes, Math.min(file.sizeBytes, 200000)) || !integer(r.matchCount, 200000) ||
      !integer(r.returnedMatches, 200) || !Array.isArray(r.matches) || r.matches.length !== r.returnedMatches ||
      r.returnedMatches > r.matchCount ||
      ![r.complete, r.scanComplete, r.matchesComplete, r.matchCountExact, r.sourceAuthenticated, r.truncated].every(v => typeof v === "boolean") ||
      r.complete !== (r.scanComplete && r.matchesComplete) ||
      r.matchCountExact !== r.scanComplete ||
      r.matchesComplete !== (r.scanComplete && !r.truncated) ||
      r.truncated !== (r.matchCount > r.returnedMatches) ||
      (r.scanComplete ? !r.sourceAuthenticated || !file.contentSha256 || r.scannedBytes !== file.sizeBytes ||
        r.verifiedContentSha256 !== file.contentSha256 : r.sourceAuthenticated || r.verifiedContentSha256 !== null || r.matches.length !== 0) ||
      (r.complete ? r.reasonCode !== null : !["CONTENT_HASH_UNAVAILABLE", "FILE_EXCEEDS_SCAN_LIMIT", "MATCHES_TRUNCATED"].includes(String(r.reasonCode))) ||
      (r.truncated && (r.reasonCode !== "MATCHES_TRUNCATED" || r.returnedMatches !== 200)))
    fail("artifact-invalid", "Invalid byte occurrence bounds or completeness.");
  let previous = -1;
  const matches = r.matches.map(v => {
    const m = asObject(v, "byte match", "artifact-invalid");
    if (!integer(m.startByte, r.scannedBytes as number) || !integer(m.endByteExclusive, r.scannedBytes as number) ||
        m.startByte <= previous || m.endByteExclusive - m.startByte !== needle.length / 2)
      fail("artifact-invalid", "Invalid byte occurrence offsets.");
    previous = m.startByte;
    return { startByte: m.startByte, endByteExclusive: m.endByteExclusive };
  });
  return { complete: r.complete === true, matchCount: r.matchCount, matches };
}
