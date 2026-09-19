import { TUTORIAL_ID_PATTERN } from "./types.js";

/**
 * Small internal validation helpers shared by the scenario and target-contract
 * validators. Deliberately not a schema-validation framework and not a new
 * dependency: the contracts are small, closed, and better served by explicit
 * checks that can produce precise, location-bearing error messages.
 */

export type ErrorCollector = {
  add(location: string, message: string): void;
  readonly errors: string[];
  readonly length: number;
};

export function createErrorCollector(source: string): ErrorCollector {
  const errors: string[] = [];
  return {
    add(location: string, message: string): void {
      errors.push(`${source} validation failed at ${location}: ${message}`);
    },
    get errors() {
      return errors;
    },
    get length() {
      return errors.length;
    }
  };
}

export function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

export function isStableId(value: unknown): value is string {
  return typeof value === "string" && TUTORIAL_ID_PATTERN.test(value);
}

/** Finite positive integer. Rejects NaN, Infinity, zero, negatives and floats. */
export function isPositiveInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value > 0;
}

/** Finite non-negative integer. Rejects NaN, Infinity, negatives and floats. */
export function isNonNegativeInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value >= 0;
}

export function isJsonScalar(value: unknown): value is string | number | boolean | null {
  return (
    value === null ||
    typeof value === "string" ||
    typeof value === "boolean" ||
    (typeof value === "number" && Number.isFinite(value))
  );
}

export function describeValue(value: unknown): string {
  if (value === undefined) return "undefined";
  if (value === null) return "null";
  if (typeof value === "string") return JSON.stringify(value);
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  if (Array.isArray(value)) return "an array";
  if (typeof value === "object") return "an object";
  return typeof value;
}

/**
 * Enforces the exact supported schema version. Prompt 2 supports 1.0.0 only and
 * never reinterprets or auto-upgrades another version, including another minor.
 */
export function validateSchemaVersion(
  errors: ErrorCollector,
  value: unknown,
  supported: string
): void {
  if (value === undefined) {
    errors.add("schemaVersion", `missing required schemaVersion; expected "${supported}".`);
    return;
  }
  if (typeof value !== "string") {
    errors.add("schemaVersion", `expected the string "${supported}", received ${describeValue(value)}.`);
    return;
  }
  if (value !== supported) {
    errors.add(
      "schemaVersion",
      `unsupported schemaVersion ${JSON.stringify(value)}; this build supports "${supported}" only.`
    );
  }
}

export function validateStableId(
  errors: ErrorCollector,
  location: string,
  value: unknown
): value is string {
  if (!isNonEmptyString(value)) {
    errors.add(location, `expected a non-empty id string, received ${describeValue(value)}.`);
    return false;
  }
  if (!isStableId(value)) {
    errors.add(
      location,
      `id ${JSON.stringify(value)} must match ${String(TUTORIAL_ID_PATTERN)} (lowercase letters, digits, dot, underscore, hyphen; must start with a letter or digit).`
    );
    return false;
  }
  return true;
}

export function validateStringRecord(
  errors: ErrorCollector,
  location: string,
  value: unknown
): Record<string, string> | undefined {
  if (value === undefined) {
    return undefined;
  }
  if (!isPlainObject(value)) {
    errors.add(location, `expected an object of string values, received ${describeValue(value)}.`);
    return undefined;
  }
  let valid = true;
  for (const [key, entry] of Object.entries(value)) {
    if (key.length === 0) {
      errors.add(location, "environment variable names must not be empty.");
      valid = false;
      continue;
    }
    if (typeof entry !== "string") {
      errors.add(`${location}.${key}`, `expected a string value, received ${describeValue(entry)}.`);
      valid = false;
    }
  }
  return valid ? (value as Record<string, string>) : undefined;
}

export function validateStringArray(
  errors: ErrorCollector,
  location: string,
  value: unknown
): string[] | undefined {
  if (value === undefined) {
    return undefined;
  }
  if (!Array.isArray(value)) {
    errors.add(location, `expected an array of strings, received ${describeValue(value)}.`);
    return undefined;
  }
  let valid = true;
  value.forEach((entry, index) => {
    if (typeof entry !== "string") {
      errors.add(`${location}[${index}]`, `expected a string, received ${describeValue(entry)}.`);
      valid = false;
    }
  });
  return valid ? (value as string[]) : undefined;
}

/**
 * Optional timeout fields must be finite positive integers when supplied. Zero,
 * negative values, NaN and Infinity are all rejected rather than silently
 * coerced to a default.
 */
export function validateOptionalTimeout(
  errors: ErrorCollector,
  location: string,
  value: unknown
): void {
  if (value === undefined) {
    return;
  }
  if (!isPositiveInteger(value)) {
    errors.add(
      location,
      `expected a finite positive integer number of milliseconds, received ${describeValue(value)}.`
    );
  }
}

export function rejectUnknownKeys(
  errors: ErrorCollector,
  location: string,
  value: Record<string, unknown>,
  allowed: readonly string[]
): void {
  const allowedSet = new Set(allowed);
  for (const key of Object.keys(value)) {
    if (!allowedSet.has(key)) {
      errors.add(`${location}.${key}`, `unknown field ${JSON.stringify(key)} is not part of this contract.`);
    }
  }
}
