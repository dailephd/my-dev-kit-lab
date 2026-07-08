import path from "node:path";
import {
  AUDIT_FAIL_ON_THRESHOLDS,
  AUDIT_INCLUDE_AREAS,
  AUDIT_OUTPUT_FORMATS,
  AUDIT_TYPES,
  DEFAULT_AUDIT_FAIL_ON_THRESHOLD,
  DEFAULT_AUDIT_INCLUDE_AREAS,
  DEFAULT_AUDIT_OUTPUT_FORMATS,
  DEFAULT_AUDIT_TYPES,
  PLANNED_AUDIT_TYPES,
  type AuditFailOnThreshold,
  type AuditIncludeArea,
  type AuditOutputFormat,
  type AuditType,
} from "./auditTypes.js";

// ---------------------------------------------------------------------------
// v0.3.0 Batch 1 — npm run audit command/config surface.
//
// Mirrors the structure of src/securityValidation/validate/cliOptions.ts
// (same flag-parsing shape, same "raw args -> normalized config" split) so
// the two CLI surfaces stay easy to read side by side, without sharing code
// — audit and security-validation are kept as independent frameworks.
// ---------------------------------------------------------------------------

export type RawAuditArgs = {
  target?: string;
  types?: string;
  include?: string;
  format?: string;
  failOn?: string;
  out?: string;
};

const FLAGS_WITH_VALUE: Record<string, keyof RawAuditArgs> = {
  "--target": "target",
  "--types": "types",
  "--include": "include",
  "--format": "format",
  "--fail-on": "failOn",
  "--out": "out",
};

export function parseAuditArgs(argv: string[]): RawAuditArgs {
  const result: RawAuditArgs = {};
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    const key = FLAGS_WITH_VALUE[arg];
    if (!key) continue;
    if (i + 1 >= argv.length) {
      throw new Error(`Missing value for ${arg}. Expected a value after ${arg}.`);
    }
    result[key] = argv[++i];
  }
  return result;
}

// ---------------------------------------------------------------------------
// Normalized config
// ---------------------------------------------------------------------------

export type AuditConfig = {
  targetPathArg?: string;
  // Cheap, pre-resolution hint derived only from whether --target was
  // supplied (not from path resolution/validation, which happens later in
  // resolveAuditTarget()).
  targetMode: "self" | "external";
  types: AuditType[];
  typesWereDefault: boolean;
  include: AuditIncludeArea[];
  includeWereDefault: boolean;
  formats: AuditOutputFormat[];
  formatsWereDefault: boolean;
  failOn: AuditFailOnThreshold;
  failOnWasDefault: boolean;
  out: string;
  outWasDefault: boolean;
  // Scoped-run metadata: true only when no flags at all were supplied.
  isDefaultRun: boolean;
};

export function normalizeAuditConfig(raw: RawAuditArgs, toolRoot: string): AuditConfig {
  const types = parseTypesOption(raw.types);
  const include = parseIncludeOption(raw.include);
  const formats = parseFormatOption(raw.format);
  const failOn = parseFailOnOption(raw.failOn);
  const out = raw.out !== undefined ? resolveOutDir(raw.out) : defaultOutDir(toolRoot, types.value);

  return {
    targetPathArg: raw.target,
    targetMode: raw.target === undefined ? "self" : "external",
    types: types.value,
    typesWereDefault: types.wasDefault,
    include: include.value,
    includeWereDefault: include.wasDefault,
    formats: formats.value,
    formatsWereDefault: formats.wasDefault,
    failOn: failOn.value,
    failOnWasDefault: failOn.wasDefault,
    out,
    outWasDefault: raw.out === undefined,
    isDefaultRun:
      raw.target === undefined &&
      raw.types === undefined &&
      raw.include === undefined &&
      raw.format === undefined &&
      raw.failOn === undefined &&
      raw.out === undefined,
  };
}

function splitAndNormalizeList(raw: string, flagName: string): string[] {
  const parts = raw.split(",").map((p) => p.trim());
  if (parts.some((p) => p.length === 0)) {
    throw new Error(`Invalid ${flagName} value: empty entries are not allowed. Got "${raw}".`);
  }
  return parts;
}

function parseTypesOption(raw?: string): { value: AuditType[]; wasDefault: boolean } {
  if (raw === undefined) {
    return { value: [...DEFAULT_AUDIT_TYPES], wasDefault: true };
  }
  const parts = splitAndNormalizeList(raw, "--types");

  const unknown = parts.filter((p) => !(AUDIT_TYPES as readonly string[]).includes(p));
  if (unknown.length > 0) {
    throw new Error(`Invalid --types value(s): ${unknown.join(", ")}. Valid values are: ${AUDIT_TYPES.join(", ")}.`);
  }

  const planned = parts.filter((p) => (PLANNED_AUDIT_TYPES as readonly string[]).includes(p));
  if (planned.length > 0) {
    throw new Error(
      `--types value(s) planned but not implemented: ${planned.join(", ")}. Only "code-rot" is implemented in this version.`
    );
  }

  const unique = new Set(parts as AuditType[]);
  const ordered = AUDIT_TYPES.filter((id) => unique.has(id));
  return { value: ordered, wasDefault: false };
}

function parseIncludeOption(raw?: string): { value: AuditIncludeArea[]; wasDefault: boolean } {
  if (raw === undefined) {
    return { value: [...DEFAULT_AUDIT_INCLUDE_AREAS], wasDefault: true };
  }
  const parts = splitAndNormalizeList(raw, "--include");
  const invalid = parts.filter((p) => !(AUDIT_INCLUDE_AREAS as readonly string[]).includes(p));
  if (invalid.length > 0) {
    throw new Error(
      `Invalid --include value(s): ${invalid.join(", ")}. Valid values are: ${AUDIT_INCLUDE_AREAS.join(", ")}.`
    );
  }
  const unique = new Set(parts as AuditIncludeArea[]);
  const ordered = AUDIT_INCLUDE_AREAS.filter((id) => unique.has(id));
  return { value: ordered, wasDefault: false };
}

function parseFormatOption(raw?: string): { value: AuditOutputFormat[]; wasDefault: boolean } {
  if (raw === undefined) {
    return { value: [...DEFAULT_AUDIT_OUTPUT_FORMATS], wasDefault: true };
  }
  const parts = splitAndNormalizeList(raw, "--format");
  const invalid = parts.filter((p) => !(AUDIT_OUTPUT_FORMATS as readonly string[]).includes(p));
  if (invalid.length > 0) {
    throw new Error(
      `Invalid --format value(s): ${invalid.join(", ")}. Valid values are: ${AUDIT_OUTPUT_FORMATS.join(", ")}.`
    );
  }
  const unique = new Set(parts as AuditOutputFormat[]);
  const ordered = AUDIT_OUTPUT_FORMATS.filter((id) => unique.has(id));
  return { value: ordered, wasDefault: false };
}

function parseFailOnOption(raw?: string): { value: AuditFailOnThreshold; wasDefault: boolean } {
  if (raw === undefined) {
    return { value: DEFAULT_AUDIT_FAIL_ON_THRESHOLD, wasDefault: true };
  }
  const value = raw.trim();
  if (!(AUDIT_FAIL_ON_THRESHOLDS as readonly string[]).includes(value)) {
    throw new Error(`Invalid --fail-on value: "${raw}". Valid values are: ${AUDIT_FAIL_ON_THRESHOLDS.join(", ")}.`);
  }
  return { value: value as AuditFailOnThreshold, wasDefault: false };
}

function resolveOutDir(raw: string): string {
  const trimmed = raw.trim();
  if (trimmed.length === 0) {
    throw new Error("Invalid --out value: path must not be empty.");
  }
  return path.resolve(trimmed);
}

function defaultOutDir(toolRoot: string, types: readonly AuditType[]): string {
  // Batch 1 only ever has "code-rot" as a valid resolved type, but this stays
  // written generically so later batches (quality/security/project) don't
  // need to touch this function, only extend the audit-type vocabulary.
  const primaryType = types[0] ?? "code-rot";
  return path.join(path.resolve(toolRoot), "reports", "audits", primaryType);
}
