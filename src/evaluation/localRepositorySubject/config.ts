import { validateAnswerKey, validateTaskLocality } from "../benchmarkMetadata.js";
import {
  LOCAL_REPOSITORY_SUBJECT_CASE_FIELDS,
  LOCAL_REPOSITORY_SUBJECT_CONFIG_FIELDS,
  LOCAL_REPOSITORY_SUBJECT_CONFIG_SCHEMA_VERSION,
  LOCAL_REPOSITORY_SUBJECT_LIMITS,
  LocalRepositorySubjectConfigError,
  compareCodeUnits,
} from "./types.js";
import type { LocalRepositorySubjectCaseV1, LocalRepositorySubjectConfigV1 } from "./types.js";

const SUBJECT_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;
const REQUIRED_CASE_FIELDS = ["id", "title", "sourceRoots", "query", "expectedFiles", "expectedSymbols", "rawIncludeGlobs"] as const;
const OPTIONAL_STRING_FIELDS = ["promptComplexityHint", "projectComplexityRelevance", "notes"] as const;
// eslint-disable-next-line no-control-regex
const CONTROL_CHARACTER_PATTERN = /[\u0000-\u001f\u007f]/;

export type LocalRepositorySubjectConfigValidationResult =
  | { ok: true; errors: []; config: LocalRepositorySubjectConfigV1 }
  | { ok: false; errors: string[]; config?: undefined };

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

/**
 * Canonicalizes a platform-portable repository-relative logical path (or glob) to forward-slash form.
 * Rejects absolute, drive-qualified, UNC, backslash, traversal, and empty-segment forms. Returns null on rejection.
 */
export function canonicalizeRepositoryRelativePath(
  value: unknown,
  label: string,
  errors: string[],
  options: { allowDot: boolean }
): string | null {
  if (typeof value !== "string") {
    errors.push(`${label}: must be a string (received ${describeValue(value)}).`);
    return null;
  }
  if (value.length === 0 || value.trim().length === 0) {
    errors.push(`${label}: must not be empty.`);
    return null;
  }
  if (CONTROL_CHARACTER_PATTERN.test(value)) {
    errors.push(`${label}: must not contain control characters.`);
    return null;
  }
  if (value.includes("\\")) {
    errors.push(`${label}: must use "/" separators, not backslashes (received ${describeValue(value)}).`);
    return null;
  }
  if (value.startsWith("/")) {
    errors.push(`${label}: must be repository-relative, not absolute or UNC (received ${describeValue(value)}).`);
    return null;
  }
  if (/^[A-Za-z]:/.test(value)) {
    errors.push(`${label}: must not be drive-qualified (received ${describeValue(value)}).`);
    return null;
  }
  const segments = value.split("/");
  const kept: string[] = [];
  for (let index = 0; index < segments.length; index += 1) {
    const segment = segments[index];
    if (segment === "..") {
      errors.push(`${label}: must not contain parent traversal (received ${describeValue(value)}).`);
      return null;
    }
    if (segment === "") {
      if (index === segments.length - 1 && index > 0) continue; // single trailing slash
      errors.push(`${label}: must not contain empty path segments (received ${describeValue(value)}).`);
      return null;
    }
    if (segment === ".") continue;
    kept.push(segment);
  }
  if (kept.length === 0) {
    if (options.allowDot) return ".";
    errors.push(`${label}: must name a path below the repository root (received ${describeValue(value)}).`);
    return null;
  }
  return kept.join("/");
}

function validateSubjectId(value: unknown, errors: string[]): value is string {
  if (typeof value !== "string") {
    errors.push(`config.subjectId: must be a string (received ${describeValue(value)}).`);
    return false;
  }
  const max = LOCAL_REPOSITORY_SUBJECT_LIMITS.subjectIdMaxLength;
  if (value.length < 1 || value.length > max) {
    errors.push(`config.subjectId: length must be between 1 and ${max}.`);
    return false;
  }
  if (!SUBJECT_ID_PATTERN.test(value)) {
    errors.push(
      `config.subjectId: must begin with an ASCII letter or digit and contain only ASCII letters, digits, ".", "_" and "-" (received ${describeValue(value)}).`
    );
    return false;
  }
  return true;
}

function validateStringArray(
  value: unknown,
  label: string,
  errors: string[],
  options: { nonEmptyArray: boolean }
): string[] | null {
  if (!Array.isArray(value)) {
    errors.push(`${label}: must be an array (received ${describeValue(value)}).`);
    return null;
  }
  if (options.nonEmptyArray && value.length === 0) {
    errors.push(`${label}: must not be empty.`);
    return null;
  }
  let ok = true;
  const strings: string[] = [];
  value.forEach((entry, index) => {
    if (typeof entry !== "string" || entry.trim().length === 0) {
      errors.push(`${label}[${index}]: must be a non-empty string (received ${describeValue(entry)}).`);
      ok = false;
    } else {
      strings.push(entry);
    }
  });
  return ok ? strings : null;
}

function validatePathArray(
  value: unknown,
  label: string,
  errors: string[],
  options: { allowDot: boolean }
): string[] | null {
  if (!Array.isArray(value)) {
    errors.push(`${label}: must be an array (received ${describeValue(value)}).`);
    return null;
  }
  if (value.length === 0) {
    errors.push(`${label}: must not be empty.`);
    return null;
  }
  let ok = true;
  const canonical: string[] = [];
  value.forEach((entry, index) => {
    const path = canonicalizeRepositoryRelativePath(entry, `${label}[${index}]`, errors, options);
    if (path === null) {
      ok = false;
    } else if (!canonical.includes(path)) {
      canonical.push(path);
    }
  });
  return ok ? canonical : null;
}

function validateCase(value: unknown, index: number, seenIds: Set<string>, errors: string[]): LocalRepositorySubjectCaseV1 | null {
  const label = `config.cases[${index}]`;
  if (!isPlainObject(value)) {
    errors.push(`${label}: must be an object (received ${describeValue(value)}).`);
    return null;
  }
  const before = errors.length;
  const allowed = new Set<string>(LOCAL_REPOSITORY_SUBJECT_CASE_FIELDS);
  for (const key of Object.keys(value).sort(compareCodeUnits)) {
    if (!allowed.has(key)) errors.push(`${label}: unknown field ${JSON.stringify(key)}.`);
  }
  for (const field of REQUIRED_CASE_FIELDS) {
    if (!hasOwn(value, field)) errors.push(`${label}: missing required field ${field}.`);
  }

  let id: string | null = null;
  if (hasOwn(value, "id")) {
    const rawId = value.id;
    if (typeof rawId !== "string" || rawId.length < 1 || rawId.length > LOCAL_REPOSITORY_SUBJECT_LIMITS.subjectIdMaxLength) {
      errors.push(`${label}.id: must be a string of length 1 to ${LOCAL_REPOSITORY_SUBJECT_LIMITS.subjectIdMaxLength} (received ${describeValue(rawId)}).`);
    } else if (!SUBJECT_ID_PATTERN.test(rawId)) {
      errors.push(
        `${label}.id: must begin with an ASCII letter or digit and contain only ASCII letters, digits, ".", "_" and "-" (received ${describeValue(rawId)}).`
      );
    } else if (seenIds.has(rawId)) {
      errors.push(`${label}.id: duplicate case id ${JSON.stringify(rawId)}.`);
    } else {
      seenIds.add(rawId);
      id = rawId;
    }
  }

  for (const field of ["title", "query"] as const) {
    if (hasOwn(value, field) && (typeof value[field] !== "string" || (value[field] as string).trim().length === 0)) {
      errors.push(`${label}.${field}: must be a non-empty string (received ${describeValue(value[field])}).`);
    }
  }

  const sourceRoots = hasOwn(value, "sourceRoots")
    ? validatePathArray(value.sourceRoots, `${label}.sourceRoots`, errors, { allowDot: true })
    : null;
  const expectedFiles = hasOwn(value, "expectedFiles")
    ? validatePathArray(value.expectedFiles, `${label}.expectedFiles`, errors, { allowDot: false })
    : null;
  const expectedSymbols = hasOwn(value, "expectedSymbols")
    ? validateStringArray(value.expectedSymbols, `${label}.expectedSymbols`, errors, { nonEmptyArray: false })
    : null;
  const rawIncludeGlobs = hasOwn(value, "rawIncludeGlobs")
    ? validatePathArray(value.rawIncludeGlobs, `${label}.rawIncludeGlobs`, errors, { allowDot: false })
    : null;

  if (hasOwn(value, "taskLocality")) errors.push(...validateTaskLocality(value.taskLocality, `${label}`));
  if (hasOwn(value, "answerKey")) errors.push(...validateAnswerKey(value.answerKey, `${label}`));
  if (hasOwn(value, "expectedFacts")) {
    const facts = value.expectedFacts;
    if (!Array.isArray(facts)) {
      errors.push(`${label}.expectedFacts: must be an array (received ${describeValue(facts)}).`);
    } else {
      facts.forEach((fact, factIndex) => {
        if (!isPlainObject(fact)) errors.push(`${label}.expectedFacts[${factIndex}]: must be an object.`);
      });
    }
  }
  for (const field of OPTIONAL_STRING_FIELDS) {
    if (hasOwn(value, field) && typeof value[field] !== "string") {
      errors.push(`${label}.${field}: must be a string (received ${describeValue(value[field])}).`);
    }
  }

  if (errors.length > before || id === null || sourceRoots === null || expectedFiles === null || expectedSymbols === null || rawIncludeGlobs === null) {
    return null;
  }

  const result: LocalRepositorySubjectCaseV1 = {
    id,
    title: value.title as string,
    sourceRoots,
    query: value.query as string,
    expectedFiles,
    expectedSymbols: [...expectedSymbols],
    rawIncludeGlobs,
  };
  if (hasOwn(value, "answerKey")) result.answerKey = structuredClone(value.answerKey) as LocalRepositorySubjectCaseV1["answerKey"];
  if (hasOwn(value, "expectedFacts")) result.expectedFacts = structuredClone(value.expectedFacts) as LocalRepositorySubjectCaseV1["expectedFacts"];
  if (hasOwn(value, "taskLocality")) result.taskLocality = value.taskLocality as LocalRepositorySubjectCaseV1["taskLocality"];
  for (const field of OPTIONAL_STRING_FIELDS) {
    if (hasOwn(value, field)) result[field] = value[field] as string;
  }
  return result;
}

/** Pure, strict validation of a LocalRepositorySubjectConfigV1 input. No filesystem or Git access. */
export function validateLocalRepositorySubjectConfig(input: unknown): LocalRepositorySubjectConfigValidationResult {
  const errors: string[] = [];
  if (!isPlainObject(input)) {
    return { ok: false, errors: [`config: must be an object (received ${describeValue(input)}).`] };
  }
  const allowed = new Set<string>(LOCAL_REPOSITORY_SUBJECT_CONFIG_FIELDS);
  for (const key of Object.keys(input).sort(compareCodeUnits)) {
    if (!allowed.has(key)) errors.push(`config: unknown field ${JSON.stringify(key)}.`);
  }
  if (!hasOwn(input, "schemaVersion")) {
    errors.push("config: missing required field schemaVersion.");
  } else if (input.schemaVersion !== LOCAL_REPOSITORY_SUBJECT_CONFIG_SCHEMA_VERSION) {
    errors.push(
      `config.schemaVersion: must be ${JSON.stringify(LOCAL_REPOSITORY_SUBJECT_CONFIG_SCHEMA_VERSION)} (received ${describeValue(input.schemaVersion)}).`
    );
  }
  let subjectId: string | null = null;
  if (!hasOwn(input, "subjectId")) {
    errors.push("config: missing required field subjectId.");
  } else if (validateSubjectId(input.subjectId, errors)) {
    subjectId = input.subjectId;
  }
  const cases: LocalRepositorySubjectCaseV1[] = [];
  if (!hasOwn(input, "cases")) {
    errors.push("config: missing required field cases.");
  } else if (!Array.isArray(input.cases)) {
    errors.push(`config.cases: must be an array (received ${describeValue(input.cases)}).`);
  } else if (input.cases.length === 0) {
    errors.push("config.cases: must not be empty.");
  } else {
    const seenIds = new Set<string>();
    input.cases.forEach((entry, index) => {
      const parsed = validateCase(entry, index, seenIds, errors);
      if (parsed) cases.push(parsed);
    });
  }
  if (errors.length > 0 || subjectId === null) {
    return { ok: false, errors };
  }
  return {
    ok: true,
    errors: [],
    config: { schemaVersion: LOCAL_REPOSITORY_SUBJECT_CONFIG_SCHEMA_VERSION, subjectId, cases },
  };
}

/** Throwing variant used by the loader. */
export function parseLocalRepositorySubjectConfig(input: unknown): LocalRepositorySubjectConfigV1 {
  const result = validateLocalRepositorySubjectConfig(input);
  if (!result.ok) throw new LocalRepositorySubjectConfigError(result.errors);
  return result.config;
}
