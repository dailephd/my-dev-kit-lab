import { createHash } from "node:crypto";
import { countEstimatedTokens, countTextChars, tokenCountMethod } from "../../core/countTokens.js";
import { deriveSyntheticRepositoryLayout } from "./layout.js";
import type { RenderedFile } from "./renderShared.js";
import type { SyntheticRepositoryLanguage, SyntheticRepositoryPlanV1 } from "./types.js";
import type { TaskLocality } from "../types.js";

export const SYNTHETIC_REPOSITORY_MANIFEST_SCHEMA_ID = "my-dev-kit-lab-synthetic-repository-manifest-v1";
export const SYNTHETIC_REPOSITORY_MANIFEST_SCHEMA_VERSION = "1.0.0";
export const SYNTHETIC_REPOSITORY_MANIFEST_FILE_NAME = "synthetic-repository-manifest.json";
export const SYNTHETIC_REPOSITORY_REPOSITORY_DIRECTORY = "repository";

export type SyntheticManifestFileRecord = {
  path: string;
  role: "source" | "test" | "support";
  language?: SyntheticRepositoryLanguage;
  byteLength: number;
  charCount: number;
  estimatedContentTokens: number;
  sha256: string;
};

export type SyntheticManifestDimensions = {
  sourceFileCount: number;
  moduleDepth: number;
  internalImportCount: number;
  symbolCount: number;
  testFileCount: number;
  repeatedPatternCount: number;
};

/**
 * Aggregate content metrics. This is a generated-repository content estimate over the canonical
 * concatenation of file contents in manifest order. It is NOT the raw-full-file baseline context token
 * count, which adds per-file headers and separators.
 */
export type SyntheticManifestAggregate = {
  fileCount: number;
  sourceFileCount: number;
  testFileCount: number;
  supportFileCount: number;
  totalBytes: number;
  totalChars: number;
  estimatedContentTokens: number;
  tokenCountMethod: typeof tokenCountMethod;
};

export type SyntheticRepositoryManifestV1 = {
  schemaId: typeof SYNTHETIC_REPOSITORY_MANIFEST_SCHEMA_ID;
  schemaVersion: typeof SYNTHETIC_REPOSITORY_MANIFEST_SCHEMA_VERSION;
  generationIdentity: string;
  caseId: string;
  language: SyntheticRepositoryLanguage;
  taskLocality: TaskLocality;
  logicalTargetRoot: string;
  requestedDimensions: SyntheticManifestDimensions;
  realizedDimensions: SyntheticManifestDimensions;
  repositoryContentIdentity: string;
  sourceRoots: string[];
  testRoots: string[];
  rawIncludeGlobs: string[];
  files: SyntheticManifestFileRecord[];
  aggregate: SyntheticManifestAggregate;
  task: {
    taskId: string;
    expectedFiles: string[];
    expectedSymbols: string[];
    expectedFactIds: string[];
  };
};

export function sha256Hex(bytes: Buffer): string {
  return createHash("sha256").update(bytes).digest("hex");
}

export function describeContent(content: string): Pick<SyntheticManifestFileRecord, "byteLength" | "charCount" | "estimatedContentTokens" | "sha256"> {
  const bytes = Buffer.from(content, "utf8");
  return {
    byteLength: bytes.length,
    charCount: countTextChars(content),
    estimatedContentTokens: countEstimatedTokens(content),
    sha256: sha256Hex(bytes),
  };
}

export function describeRenderedFile(file: RenderedFile): SyntheticManifestFileRecord {
  const metrics = describeContent(file.content);
  return {
    path: file.path,
    role: file.role,
    ...(file.language ? { language: file.language } : {}),
    ...metrics,
  };
}

/** SHA-256 over canonical JSON of the path-ordered {path, role, byteLength, sha256} records. */
export function computeRepositoryContentIdentity(records: readonly SyntheticManifestFileRecord[]): string {
  const canonical = [...records]
    .sort((left, right) => (left.path < right.path ? -1 : left.path > right.path ? 1 : 0))
    .map((record) => ({ path: record.path, role: record.role, byteLength: record.byteLength, sha256: record.sha256 }));
  return sha256Hex(Buffer.from(JSON.stringify(canonical), "utf8"));
}

/** Aggregate over files in the given order; the token estimate uses the existing estimator on the canonical concatenation. */
export function computeAggregate(records: readonly SyntheticManifestFileRecord[], concatenatedContent: string): SyntheticManifestAggregate {
  return {
    fileCount: records.length,
    sourceFileCount: records.filter((record) => record.role === "source").length,
    testFileCount: records.filter((record) => record.role === "test").length,
    supportFileCount: records.filter((record) => record.role === "support").length,
    totalBytes: records.reduce((total, record) => total + record.byteLength, 0),
    totalChars: records.reduce((total, record) => total + record.charCount, 0),
    estimatedContentTokens: countEstimatedTokens(concatenatedContent),
    tokenCountMethod,
  };
}

function dimensionsOf(source: SyntheticManifestDimensions): SyntheticManifestDimensions {
  return {
    sourceFileCount: source.sourceFileCount,
    moduleDepth: source.moduleDepth,
    internalImportCount: source.internalImportCount,
    symbolCount: source.symbolCount,
    testFileCount: source.testFileCount,
    repeatedPatternCount: source.repeatedPatternCount,
  };
}

/** Pure manifest construction from a frozen plan and its rendered files (already in path order). No host data. */
export function buildSyntheticRepositoryManifest(plan: SyntheticRepositoryPlanV1, files: readonly RenderedFile[]): SyntheticRepositoryManifestV1 {
  const records = files.map(describeRenderedFile);
  const layout = deriveSyntheticRepositoryLayout(plan);
  return {
    schemaId: SYNTHETIC_REPOSITORY_MANIFEST_SCHEMA_ID,
    schemaVersion: SYNTHETIC_REPOSITORY_MANIFEST_SCHEMA_VERSION,
    generationIdentity: plan.generationIdentity,
    caseId: plan.caseId,
    language: plan.language,
    taskLocality: plan.task.locality,
    logicalTargetRoot: layout.logicalTargetRoot,
    requestedDimensions: dimensionsOf(plan.requested),
    realizedDimensions: dimensionsOf(plan.realized),
    repositoryContentIdentity: computeRepositoryContentIdentity(records),
    sourceRoots: layout.sourceRoots,
    testRoots: layout.testRoots,
    rawIncludeGlobs: layout.rawIncludeGlobs,
    files: records,
    aggregate: computeAggregate(records, files.map((file) => file.content).join("")),
    task: {
      taskId: plan.task.taskId,
      expectedFiles: [...plan.answerKey.expectedFiles],
      expectedSymbols: [...plan.answerKey.expectedSymbols],
      expectedFactIds: plan.answerKey.facts.map((fact) => fact.factId),
    },
  };
}

/** Canonical manifest bytes: two-space JSON, LF, one trailing newline. */
export function serializeSyntheticRepositoryManifest(manifest: SyntheticRepositoryManifestV1): string {
  return `${JSON.stringify(manifest, null, 2)}\n`;
}

const HEX64 = /^[0-9a-f]{64}$/;
const FILE_KEYS = ["path", "role", "language", "byteLength", "charCount", "estimatedContentTokens", "sha256"];
const TOP_KEYS = [
  "schemaId",
  "schemaVersion",
  "generationIdentity",
  "caseId",
  "language",
  "taskLocality",
  "logicalTargetRoot",
  "requestedDimensions",
  "realizedDimensions",
  "repositoryContentIdentity",
  "sourceRoots",
  "testRoots",
  "rawIncludeGlobs",
  "files",
  "aggregate",
  "task",
];
const DIMENSION_KEYS = ["sourceFileCount", "moduleDepth", "internalImportCount", "symbolCount", "testFileCount", "repeatedPatternCount"];
const AGGREGATE_KEYS = [
  "fileCount",
  "sourceFileCount",
  "testFileCount",
  "supportFileCount",
  "totalBytes",
  "totalChars",
  "estimatedContentTokens",
  "tokenCountMethod",
];

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isCount(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
}

/** True for a plain relative POSIX logical path with no "." / ".." / empty segment, drive, UNC or backslash form. */
export function isSafeManifestPath(value: unknown): value is string {
  if (typeof value !== "string" || value.length === 0) return false;
  if (value.startsWith("/") || value.includes("\\") || value.includes(":") || value.includes("\0")) return false;
  return value.split("/").every((segment) => segment.length > 0 && segment !== "." && segment !== "..");
}

function checkKeys(label: string, value: Record<string, unknown>, allowed: readonly string[], required: readonly string[], issues: string[]): void {
  for (const key of Object.keys(value).sort()) if (!allowed.includes(key)) issues.push(`${label}: unknown field ${JSON.stringify(key)}.`);
  for (const key of required) if (!(key in value)) issues.push(`${label}: missing field ${key}.`);
}

function checkDimensions(label: string, value: unknown, issues: string[]): void {
  if (!isRecord(value)) {
    issues.push(`${label}: must be an object.`);
    return;
  }
  checkKeys(label, value, DIMENSION_KEYS, DIMENSION_KEYS, issues);
  for (const key of DIMENSION_KEYS) if (key in value && !isCount(value[key])) issues.push(`${label}.${key}: must be a nonnegative integer.`);
}

export type SyntheticManifestValidation =
  | { ok: true; issues: []; manifest: SyntheticRepositoryManifestV1 }
  | { ok: false; issues: string[]; manifest?: undefined };

/**
 * Pure structural validation of an untrusted manifest value. Closed schema (unknown fields rejected),
 * supported major version only, safe unique path-ordered file records, and aggregates that agree with the
 * file records. Content-derived checks (hashes, tokens, identity of bytes) belong to the verifier.
 */
export function validateSyntheticRepositoryManifest(input: unknown): SyntheticManifestValidation {
  const issues: string[] = [];
  if (!isRecord(input)) return { ok: false, issues: ["manifest: must be an object."] };
  checkKeys("manifest", input, TOP_KEYS, TOP_KEYS, issues);
  if (input.schemaId !== SYNTHETIC_REPOSITORY_MANIFEST_SCHEMA_ID) issues.push("manifest.schemaId: unsupported manifest schema.");
  if (typeof input.schemaVersion !== "string" || !/^1\.\d+\.\d+$/.test(input.schemaVersion)) {
    issues.push(`manifest.schemaVersion: unsupported schema major (received ${JSON.stringify(input.schemaVersion)}).`);
  } else if (input.schemaVersion !== SYNTHETIC_REPOSITORY_MANIFEST_SCHEMA_VERSION) {
    issues.push(`manifest.schemaVersion: only ${SYNTHETIC_REPOSITORY_MANIFEST_SCHEMA_VERSION} is understood (received ${input.schemaVersion}).`);
  }
  for (const key of ["generationIdentity", "repositoryContentIdentity"]) {
    if (typeof input[key] !== "string" || !HEX64.test(input[key] as string)) issues.push(`manifest.${key}: must be lowercase 64-hex SHA-256.`);
  }
  if (typeof input.caseId !== "string" || input.caseId.length === 0) issues.push("manifest.caseId: must be a nonempty string.");
  if (input.language !== "typescript" && input.language !== "python") issues.push("manifest.language: must be typescript or python.");
  if (!isSafeManifestPath(input.logicalTargetRoot)) issues.push("manifest.logicalTargetRoot: must be a safe relative logical path.");
  checkDimensions("manifest.requestedDimensions", input.requestedDimensions, issues);
  checkDimensions("manifest.realizedDimensions", input.realizedDimensions, issues);
  for (const key of ["sourceRoots", "testRoots", "rawIncludeGlobs"]) {
    const list = input[key];
    if (!Array.isArray(list) || list.some((entry) => typeof entry !== "string" || entry.includes("\\") || entry.startsWith("/") || entry.includes(".."))) {
      issues.push(`manifest.${key}: must be an array of safe relative strings.`);
    }
  }

  const files = input.files;
  if (!Array.isArray(files) || files.length === 0) {
    issues.push("manifest.files: must be a nonempty array.");
  } else {
    const seen = new Set<string>();
    let previous: string | undefined;
    files.forEach((record, index) => {
      const label = `manifest.files[${index}]`;
      if (!isRecord(record)) {
        issues.push(`${label}: must be an object.`);
        return;
      }
      checkKeys(label, record, FILE_KEYS, FILE_KEYS.filter((key) => key !== "language"), issues);
      if (!isSafeManifestPath(record.path)) {
        issues.push(`${label}.path: must be a safe relative logical path.`);
      } else {
        if (seen.has(record.path)) issues.push(`${label}.path: duplicate path ${record.path}.`);
        seen.add(record.path);
        if (previous !== undefined && record.path < previous) issues.push(`${label}.path: files are not in ascending path order.`);
        previous = record.path;
      }
      if (record.role !== "source" && record.role !== "test" && record.role !== "support") issues.push(`${label}.role: must be source, test or support.`);
      if ("language" in record && record.language !== "typescript" && record.language !== "python") issues.push(`${label}.language: must be typescript or python.`);
      for (const key of ["byteLength", "charCount", "estimatedContentTokens"]) if (!isCount(record[key])) issues.push(`${label}.${key}: must be a nonnegative integer.`);
      if (typeof record.sha256 !== "string" || !HEX64.test(record.sha256)) issues.push(`${label}.sha256: must be lowercase 64-hex SHA-256.`);
    });
  }

  const aggregate = input.aggregate;
  if (!isRecord(aggregate)) {
    issues.push("manifest.aggregate: must be an object.");
  } else {
    checkKeys("manifest.aggregate", aggregate, AGGREGATE_KEYS, AGGREGATE_KEYS, issues);
    if (aggregate.tokenCountMethod !== tokenCountMethod) issues.push(`manifest.aggregate.tokenCountMethod: must be ${tokenCountMethod}.`);
  }
  const task = input.task;
  if (!isRecord(task)) {
    issues.push("manifest.task: must be an object.");
  } else {
    checkKeys("manifest.task", task, ["taskId", "expectedFiles", "expectedSymbols", "expectedFactIds"], ["taskId", "expectedFiles", "expectedSymbols", "expectedFactIds"], issues);
    for (const key of ["expectedFiles", "expectedSymbols", "expectedFactIds"]) {
      if (!Array.isArray(task[key]) || (task[key] as unknown[]).some((entry) => typeof entry !== "string")) issues.push(`manifest.task.${key}: must be an array of strings.`);
    }
    if (Array.isArray(task.expectedFiles)) {
      for (const expected of task.expectedFiles) if (!isSafeManifestPath(expected)) issues.push(`manifest.task.expectedFiles: unsafe path ${JSON.stringify(expected)}.`);
    }
  }

  if (issues.length > 0) return { ok: false, issues };
  const manifest = input as unknown as SyntheticRepositoryManifestV1;
  const records = manifest.files;
  const consistency: string[] = [];
  const expectedAggregate = {
    fileCount: records.length,
    sourceFileCount: records.filter((record) => record.role === "source").length,
    testFileCount: records.filter((record) => record.role === "test").length,
    supportFileCount: records.filter((record) => record.role === "support").length,
    totalBytes: records.reduce((total, record) => total + record.byteLength, 0),
    totalChars: records.reduce((total, record) => total + record.charCount, 0),
  };
  for (const key of Object.keys(expectedAggregate) as Array<keyof typeof expectedAggregate>) {
    if (manifest.aggregate[key] !== expectedAggregate[key]) consistency.push(`manifest.aggregate.${key}: ${manifest.aggregate[key]} does not match the file records (${expectedAggregate[key]}).`);
  }
  if (manifest.realizedDimensions.sourceFileCount !== expectedAggregate.sourceFileCount) consistency.push("manifest.realizedDimensions.sourceFileCount does not match source file records.");
  if (manifest.realizedDimensions.testFileCount !== expectedAggregate.testFileCount) consistency.push("manifest.realizedDimensions.testFileCount does not match test file records.");
  if (manifest.repositoryContentIdentity !== computeRepositoryContentIdentity(records)) consistency.push("manifest.repositoryContentIdentity does not match the file records.");
  const paths = new Set(records.map((record) => record.path));
  for (const expected of manifest.task.expectedFiles) if (!paths.has(expected)) consistency.push(`manifest.task.expectedFiles: ${expected} is not a listed file.`);
  if (consistency.length > 0) return { ok: false, issues: consistency };
  return { ok: true, issues: [], manifest };
}
