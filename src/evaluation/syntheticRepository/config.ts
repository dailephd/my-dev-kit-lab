import { TASK_LOCALITIES } from "../types.js";
import type { TaskLocality } from "../types.js";
import {
  SYNTHETIC_REPOSITORY_CONFIG_SCHEMA_VERSION,
  SYNTHETIC_REPOSITORY_LANGUAGES,
  SyntheticRepositoryConfigError,
} from "./types.js";
import type { SyntheticRepositoryCaseSpecV1, SyntheticRepositoryConfigV1 } from "./types.js";

export const SYNTHETIC_REPOSITORY_LIMITS = {
  maxCases: 64,
  caseIdMaxLength: 64,
  seedMaxLength: 256,
  sourceFileCount: { min: 1, max: 10000 },
  moduleDepth: { min: 1, max: 64 },
  internalImportCount: { min: 0, max: 100000 },
  symbolCount: { min: 1, max: 100000 },
  testFileCount: { min: 0, max: 10000 },
  repeatedPatternCount: { min: 0, max: 100000 },
  broadChangeMinSourceFiles: 4,
  crossModuleMinSourceFiles: 2,
} as const;

/** Fixed field order of one case; also the canonical serialization order. */
export const SYNTHETIC_REPOSITORY_CASE_FIELDS = [
  "id",
  "language",
  "seed",
  "sourceFileCount",
  "moduleDepth",
  "internalImportCount",
  "symbolCount",
  "testFileCount",
  "taskLocality",
  "repeatedPatternCount",
] as const;

type CountField =
  | "sourceFileCount"
  | "moduleDepth"
  | "internalImportCount"
  | "symbolCount"
  | "testFileCount"
  | "repeatedPatternCount";

const COUNT_FIELDS: readonly CountField[] = [
  "sourceFileCount",
  "moduleDepth",
  "internalImportCount",
  "symbolCount",
  "testFileCount",
  "repeatedPatternCount",
];

const CASE_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;
const WINDOWS_DEVICE_NAME_PATTERN = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])$/i;

export type SyntheticRepositoryConfigValidationResult =
  | { ok: true; errors: []; config: SyntheticRepositoryConfigV1 }
  | { ok: false; errors: string[]; config?: undefined };

export type SyntheticRepositoryCaseValidationResult =
  | { ok: true; errors: []; spec: SyntheticRepositoryCaseSpecV1 }
  | { ok: false; errors: string[]; spec?: undefined };

/** Locale-independent ordering by UTF-16 code unit. */
export function compareCodeUnits(left: string, right: string): number {
  if (left < right) return -1;
  if (left > right) return 1;
  return 0;
}

/**
 * Maximum number of unique directed acyclic import edges among `sourceFileCount` modules whose longest
 * dependency chain has exactly `moduleDepth` modules: the edge count of the balanced complete
 * multipartite arrangement, (N^2 - sum of squared layer sizes) / 2.
 */
export function maxImportEdges(sourceFileCount: number, moduleDepth: number): number {
  const base = Math.floor(sourceFileCount / moduleDepth);
  const larger = sourceFileCount % moduleDepth;
  const sumOfSquares = larger * (base + 1) * (base + 1) + (moduleDepth - larger) * base * base;
  return (sourceFileCount * sourceFileCount - sumOfSquares) / 2;
}

/** Returns the case in canonical field order. Assumes the spec is valid. */
export function orderCaseSpec(spec: SyntheticRepositoryCaseSpecV1): SyntheticRepositoryCaseSpecV1 {
  return {
    id: spec.id,
    language: spec.language,
    seed: spec.seed,
    sourceFileCount: spec.sourceFileCount,
    moduleDepth: spec.moduleDepth,
    internalImportCount: spec.internalImportCount,
    symbolCount: spec.symbolCount,
    testFileCount: spec.testFileCount,
    taskLocality: spec.taskLocality,
    repeatedPatternCount: spec.repeatedPatternCount,
  };
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function hasOwn(value: Record<string, unknown>, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(value, key);
}

function describeValue(value: unknown): string {
  if (typeof value === "string") {
    return JSON.stringify(value.length > 40 ? `${value.slice(0, 40)}...` : value);
  }
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  if (value === null) return "null";
  if (Array.isArray(value)) return "array";
  return typeof value;
}

function hasLoneSurrogate(value: string): boolean {
  for (let index = 0; index < value.length; index += 1) {
    const unit = value.charCodeAt(index);
    if (unit >= 0xd800 && unit <= 0xdbff) {
      const next = value.charCodeAt(index + 1);
      if (next >= 0xdc00 && next <= 0xdfff) {
        index += 1;
        continue;
      }
      return true;
    }
    if (unit >= 0xdc00 && unit <= 0xdfff) return true;
  }
  return false;
}

function validateCaseId(value: unknown, label: string, errors: string[]): value is string {
  if (typeof value !== "string") {
    errors.push(`${label}.id: must be a string (received ${describeValue(value)}).`);
    return false;
  }
  const before = errors.length;
  if (value.length < 1 || value.length > SYNTHETIC_REPOSITORY_LIMITS.caseIdMaxLength) {
    errors.push(`${label}.id: length must be between 1 and ${SYNTHETIC_REPOSITORY_LIMITS.caseIdMaxLength}.`);
  } else if (!CASE_ID_PATTERN.test(value)) {
    errors.push(
      `${label}.id: must begin with an ASCII letter or digit and contain only ASCII letters, digits, ".", "_" and "-" (received ${describeValue(value)}).`
    );
  } else {
    if (value.endsWith(".")) {
      errors.push(`${label}.id: must not end with ".".`);
    }
    if (WINDOWS_DEVICE_NAME_PATTERN.test(value.split(".")[0])) {
      errors.push(`${label}.id: must not use a reserved device name (received ${describeValue(value)}).`);
    }
  }
  return errors.length === before;
}

function validateSeed(value: unknown, label: string, errors: string[]): value is string {
  if (typeof value !== "string") {
    errors.push(`${label}.seed: must be a string (received ${describeValue(value)}).`);
    return false;
  }
  const before = errors.length;
  if (!/\S/.test(value)) {
    errors.push(`${label}.seed: must contain at least one non-whitespace character.`);
  }
  if (value.length > SYNTHETIC_REPOSITORY_LIMITS.seedMaxLength) {
    errors.push(`${label}.seed: must be at most ${SYNTHETIC_REPOSITORY_LIMITS.seedMaxLength} UTF-16 code units.`);
  }
  if (hasLoneSurrogate(value)) {
    errors.push(`${label}.seed: must be well-formed Unicode (lone surrogate found).`);
  }
  return errors.length === before;
}

function validateCount(value: unknown, field: CountField, label: string, errors: string[]): value is number {
  const { min, max } = SYNTHETIC_REPOSITORY_LIMITS[field];
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < min || value > max) {
    errors.push(`${label}.${field}: must be an integer between ${min} and ${max} (received ${describeValue(value)}).`);
    return false;
  }
  return true;
}

function validateCase(value: unknown, label: string, errors: string[]): SyntheticRepositoryCaseSpecV1 | undefined {
  if (!isPlainObject(value)) {
    errors.push(`${label}: must be an object (received ${describeValue(value)}).`);
    return undefined;
  }
  const before = errors.length;
  const allowed = new Set<string>(SYNTHETIC_REPOSITORY_CASE_FIELDS);
  for (const key of Object.keys(value).sort(compareCodeUnits)) {
    if (!allowed.has(key)) errors.push(`${label}: unknown field ${JSON.stringify(key)}.`);
  }
  for (const field of SYNTHETIC_REPOSITORY_CASE_FIELDS) {
    if (!hasOwn(value, field)) errors.push(`${label}: missing required field ${field}.`);
  }

  const idOk = hasOwn(value, "id") && validateCaseId(value.id, label, errors);
  const languageOk =
    hasOwn(value, "language") &&
    (SYNTHETIC_REPOSITORY_LANGUAGES as readonly unknown[]).includes(value.language);
  if (hasOwn(value, "language") && !languageOk) {
    errors.push(
      `${label}.language: must be one of ${SYNTHETIC_REPOSITORY_LANGUAGES.join(", ")} (received ${describeValue(value.language)}).`
    );
  }
  const seedOk = hasOwn(value, "seed") && validateSeed(value.seed, label, errors);
  const countOk = new Map<CountField, boolean>();
  for (const field of COUNT_FIELDS) {
    countOk.set(field, hasOwn(value, field) && validateCount(value[field], field, label, errors));
  }
  const localityOk =
    hasOwn(value, "taskLocality") && (TASK_LOCALITIES as readonly unknown[]).includes(value.taskLocality);
  if (hasOwn(value, "taskLocality") && !localityOk) {
    errors.push(
      `${label}.taskLocality: must be one of ${TASK_LOCALITIES.join(", ")} (received ${describeValue(value.taskLocality)}).`
    );
  }

  const sourceFileCount = value.sourceFileCount as number;
  const moduleDepth = value.moduleDepth as number;
  const internalImportCount = value.internalImportCount as number;
  const symbolCount = value.symbolCount as number;
  const taskLocality = value.taskLocality as TaskLocality;

  const sourceOk = countOk.get("sourceFileCount") === true;
  const depthOk = countOk.get("moduleDepth") === true;
  const importsOk = countOk.get("internalImportCount") === true;
  const symbolsOk = countOk.get("symbolCount") === true;

  if (sourceOk && depthOk) {
    if (moduleDepth > sourceFileCount) {
      errors.push(`${label}.moduleDepth: must not exceed sourceFileCount (${moduleDepth} > ${sourceFileCount}).`);
    } else if (importsOk) {
      if (moduleDepth > 1 && internalImportCount < moduleDepth - 1) {
        errors.push(
          `${label}.internalImportCount: must be at least moduleDepth - 1 (${moduleDepth - 1}) to realize moduleDepth ${moduleDepth}.`
        );
      }
      const capacity = maxImportEdges(sourceFileCount, moduleDepth);
      if (internalImportCount > capacity) {
        errors.push(
          `${label}.internalImportCount: exceeds the ${capacity} unique acyclic edges possible for sourceFileCount ${sourceFileCount} with exact moduleDepth ${moduleDepth}.`
        );
      }
    }
  }
  if (sourceOk && symbolsOk && symbolCount < sourceFileCount) {
    errors.push(`${label}.symbolCount: must be at least sourceFileCount (${symbolCount} < ${sourceFileCount}).`);
  }
  if (sourceOk && localityOk) {
    if (taskLocality === "cross-module") {
      if (sourceFileCount < SYNTHETIC_REPOSITORY_LIMITS.crossModuleMinSourceFiles) {
        errors.push(`${label}.taskLocality: cross-module requires sourceFileCount >= 2.`);
      }
      if (importsOk && internalImportCount < 1) {
        errors.push(`${label}.taskLocality: cross-module requires internalImportCount >= 1.`);
      }
    } else if (taskLocality === "broad-change" && sourceFileCount < SYNTHETIC_REPOSITORY_LIMITS.broadChangeMinSourceFiles) {
      errors.push(`${label}.taskLocality: broad-change requires sourceFileCount >= 4.`);
    }
  }

  if (errors.length !== before || !idOk || !languageOk || !seedOk || !localityOk) return undefined;
  return orderCaseSpec(value as unknown as SyntheticRepositoryCaseSpecV1);
}

/** Validates one case spec and returns it in canonical field order. Never throws, never repairs. */
export function validateSyntheticRepositoryCaseSpec(input: unknown): SyntheticRepositoryCaseValidationResult {
  const errors: string[] = [];
  const spec = validateCase(input, "case", errors);
  if (errors.length > 0 || spec === undefined) return { ok: false, errors };
  return { ok: true, errors: [], spec };
}

/**
 * Strictly validates an unknown value as SyntheticRepositoryConfigV1. On success the returned config is
 * canonical: cases sorted ascending by id (code-unit order), fixed field order, values untouched.
 */
export function validateSyntheticRepositoryConfig(input: unknown): SyntheticRepositoryConfigValidationResult {
  const errors: string[] = [];
  if (!isPlainObject(input)) {
    return { ok: false, errors: [`config: must be an object (received ${describeValue(input)}).`] };
  }
  for (const key of Object.keys(input).sort(compareCodeUnits)) {
    if (key !== "schemaVersion" && key !== "cases") errors.push(`config: unknown field ${JSON.stringify(key)}.`);
  }
  if (!hasOwn(input, "schemaVersion")) {
    errors.push("config: missing required field schemaVersion.");
  } else if (input.schemaVersion !== SYNTHETIC_REPOSITORY_CONFIG_SCHEMA_VERSION) {
    errors.push(
      `config.schemaVersion: must be ${JSON.stringify(SYNTHETIC_REPOSITORY_CONFIG_SCHEMA_VERSION)} (received ${describeValue(input.schemaVersion)}).`
    );
  }
  if (!hasOwn(input, "cases")) {
    errors.push("config: missing required field cases.");
    return { ok: false, errors };
  }
  const cases = input.cases;
  if (!Array.isArray(cases)) {
    errors.push(`config.cases: must be an array (received ${describeValue(cases)}).`);
    return { ok: false, errors };
  }
  if (cases.length < 1 || cases.length > SYNTHETIC_REPOSITORY_LIMITS.maxCases) {
    errors.push(`config.cases: must contain between 1 and ${SYNTHETIC_REPOSITORY_LIMITS.maxCases} cases (received ${cases.length}).`);
    return { ok: false, errors };
  }

  const valid: SyntheticRepositoryCaseSpecV1[] = [];
  const firstIndexById = new Map<string, number>();
  cases.forEach((candidate, index) => {
    const label = `cases[${index}]`;
    const spec = validateCase(candidate, label, errors);
    if (spec) valid.push(spec);
    const id = isPlainObject(candidate) ? candidate.id : undefined;
    if (typeof id === "string") {
      const key = id.toLowerCase();
      const first = firstIndexById.get(key);
      if (first === undefined) {
        firstIndexById.set(key, index);
      } else {
        errors.push(`${label}.id: duplicates cases[${first}].id (ids are compared without regard to letter case).`);
      }
    }
  });
  if (errors.length > 0) return { ok: false, errors };

  const sorted = [...valid].sort((left, right) => compareCodeUnits(left.id, right.id));
  return {
    ok: true,
    errors: [],
    config: { schemaVersion: SYNTHETIC_REPOSITORY_CONFIG_SCHEMA_VERSION, cases: sorted },
  };
}

/** Validates then returns the canonical configuration; throws SyntheticRepositoryConfigError when invalid. */
export function normalizeSyntheticRepositoryConfig(input: unknown): SyntheticRepositoryConfigV1 {
  const result = validateSyntheticRepositoryConfig(input);
  if (!result.ok) throw new SyntheticRepositoryConfigError(result.errors);
  return result.config;
}
