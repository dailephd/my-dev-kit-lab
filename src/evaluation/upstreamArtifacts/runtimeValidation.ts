import type { JsonObject, JsonValue } from "./jsonTypes.js";
import type {
  UpstreamArtifactKind,
  UpstreamArtifactReadErrorCode,
  UpstreamArtifactReadFailure
} from "./artifactReadTypes.js";

export function joinFieldPath(parent: string, child: string): string {
  return parent.length === 0 ? child : `${parent}.${child}`;
}

export function arrayFieldPath(parent: string, index: number): string {
  return `${parent}[${index}]`;
}

export function makeFailure(
  artifactKind: UpstreamArtifactKind,
  sourcePath: string,
  code: UpstreamArtifactReadErrorCode,
  message: string,
  fieldPath?: string,
  expected?: string,
  actual?: JsonValue
): UpstreamArtifactReadFailure {
  return { ok: false, artifactKind, sourcePath, code, message, fieldPath, expected, actual };
}

export class ArtifactValidationError extends Error {
  readonly failure: UpstreamArtifactReadFailure;
  constructor(failure: UpstreamArtifactReadFailure) {
    super(failure.message);
    this.failure = failure;
  }
}

function fail(
  artifactKind: UpstreamArtifactKind,
  sourcePath: string,
  code: UpstreamArtifactReadErrorCode,
  message: string,
  fieldPath?: string,
  expected?: string,
  actual?: JsonValue
): never {
  throw new ArtifactValidationError(makeFailure(artifactKind, sourcePath, code, message, fieldPath, expected, actual));
}

export interface FieldContext {
  artifactKind: UpstreamArtifactKind;
  sourcePath: string;
}

export function requiredField(
  ctx: FieldContext,
  obj: JsonObject,
  key: string,
  fieldPath: string
): JsonValue {
  if (!(key in obj)) {
    fail(
      ctx.artifactKind,
      ctx.sourcePath,
      "MISSING_REQUIRED_FIELD",
      `Artifact "${ctx.artifactKind}" at "${ctx.sourcePath}" is missing required field "${fieldPath}".`,
      fieldPath,
      "present"
    );
  }
  return obj[key];
}

export function optionalField(obj: JsonObject, key: string): JsonValue | undefined {
  return key in obj ? obj[key] : undefined;
}

export function requiredObject(ctx: FieldContext, value: JsonValue, fieldPath: string): JsonObject {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    fail(
      ctx.artifactKind,
      ctx.sourcePath,
      "INVALID_FIELD_TYPE",
      `Field "${fieldPath}" in artifact "${ctx.artifactKind}" at "${ctx.sourcePath}" must be an object.`,
      fieldPath,
      "object",
      value
    );
  }
  return value;
}

export function requiredString(ctx: FieldContext, value: JsonValue, fieldPath: string): string {
  if (typeof value !== "string") {
    fail(
      ctx.artifactKind,
      ctx.sourcePath,
      "INVALID_FIELD_TYPE",
      `Field "${fieldPath}" in artifact "${ctx.artifactKind}" at "${ctx.sourcePath}" must be a string.`,
      fieldPath,
      "string",
      value
    );
  }
  return value;
}

export function optionalString(ctx: FieldContext, value: JsonValue | undefined, fieldPath: string): string | undefined {
  if (value === undefined) return undefined;
  return requiredString(ctx, value, fieldPath);
}

export function requiredNullableString(ctx: FieldContext, value: JsonValue, fieldPath: string): string | null {
  if (value === null) return null;
  return requiredString(ctx, value, fieldPath);
}

export function optionalNullableString(
  ctx: FieldContext,
  value: JsonValue | undefined,
  fieldPath: string
): string | null | undefined {
  if (value === undefined) return undefined;
  return requiredNullableString(ctx, value, fieldPath);
}

export function requiredBoolean(ctx: FieldContext, value: JsonValue, fieldPath: string): boolean {
  if (typeof value !== "boolean") {
    fail(
      ctx.artifactKind,
      ctx.sourcePath,
      "INVALID_FIELD_TYPE",
      `Field "${fieldPath}" in artifact "${ctx.artifactKind}" at "${ctx.sourcePath}" must be a boolean.`,
      fieldPath,
      "boolean",
      value
    );
  }
  return value;
}

export function optionalBoolean(ctx: FieldContext, value: JsonValue | undefined, fieldPath: string): boolean | undefined {
  if (value === undefined) return undefined;
  return requiredBoolean(ctx, value, fieldPath);
}

export function requiredNumber(ctx: FieldContext, value: JsonValue, fieldPath: string): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    fail(
      ctx.artifactKind,
      ctx.sourcePath,
      "INVALID_FIELD_TYPE",
      `Field "${fieldPath}" in artifact "${ctx.artifactKind}" at "${ctx.sourcePath}" must be a finite number.`,
      fieldPath,
      "number",
      value
    );
  }
  return value;
}

export function optionalNumber(ctx: FieldContext, value: JsonValue | undefined, fieldPath: string): number | undefined {
  if (value === undefined) return undefined;
  return requiredNumber(ctx, value, fieldPath);
}

export function requiredNullableNumber(ctx: FieldContext, value: JsonValue, fieldPath: string): number | null {
  if (value === null) return null;
  return requiredNumber(ctx, value, fieldPath);
}

export function requiredNonnegativeInteger(ctx: FieldContext, value: JsonValue, fieldPath: string): number {
  const n = requiredNumber(ctx, value, fieldPath);
  if (!Number.isInteger(n) || n < 0) {
    fail(
      ctx.artifactKind,
      ctx.sourcePath,
      "INVALID_FIELD_TYPE",
      `Field "${fieldPath}" in artifact "${ctx.artifactKind}" at "${ctx.sourcePath}" must be a nonnegative integer.`,
      fieldPath,
      "nonnegative integer",
      value
    );
  }
  return n;
}

export function requiredLiteral<T extends string>(
  ctx: FieldContext,
  value: JsonValue,
  fieldPath: string,
  allowed: readonly T[]
): T {
  const str = requiredString(ctx, value, fieldPath);
  if (!(allowed as readonly string[]).includes(str)) {
    fail(
      ctx.artifactKind,
      ctx.sourcePath,
      "INVALID_LITERAL_VALUE",
      `Field "${fieldPath}" in artifact "${ctx.artifactKind}" at "${ctx.sourcePath}" has invalid value "${str}". Expected one of: ${allowed.join(", ")}.`,
      fieldPath,
      allowed.join(" | "),
      str
    );
  }
  return str as T;
}

export function optionalLiteral<T extends string>(
  ctx: FieldContext,
  value: JsonValue | undefined,
  fieldPath: string,
  allowed: readonly T[]
): T | undefined {
  if (value === undefined) return undefined;
  return requiredLiteral(ctx, value, fieldPath, allowed);
}

export function requiredNullableLiteral<T extends string>(
  ctx: FieldContext,
  value: JsonValue,
  fieldPath: string,
  allowed: readonly T[]
): T | null {
  if (value === null) return null;
  return requiredLiteral(ctx, value, fieldPath, allowed);
}

export function requiredArray(ctx: FieldContext, value: JsonValue, fieldPath: string): JsonValue[] {
  if (!Array.isArray(value)) {
    fail(
      ctx.artifactKind,
      ctx.sourcePath,
      "INVALID_FIELD_TYPE",
      `Field "${fieldPath}" in artifact "${ctx.artifactKind}" at "${ctx.sourcePath}" must be an array.`,
      fieldPath,
      "array",
      value
    );
  }
  return value;
}

export function requiredStringArray(ctx: FieldContext, value: JsonValue, fieldPath: string): string[] {
  const arr = requiredArray(ctx, value, fieldPath);
  return arr.map((item, index) => requiredString(ctx, item, arrayFieldPath(fieldPath, index)));
}

export function requiredRecord(ctx: FieldContext, value: JsonValue, fieldPath: string): JsonObject {
  return requiredObject(ctx, value, fieldPath);
}

export type JsonScalarLike = string | number | boolean | null;

export function requiredScalarLike(ctx: FieldContext, value: JsonValue, fieldPath: string): JsonScalarLike {
  if (value === null || typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
    return value;
  }
  fail(
    ctx.artifactKind,
    ctx.sourcePath,
    "INVALID_FIELD_TYPE",
    `Field "${fieldPath}" in artifact "${ctx.artifactKind}" at "${ctx.sourcePath}" must be a string, number, boolean, or null.`,
    fieldPath,
    "string | number | boolean | null",
    value
  );
}

export function requiredScalarOrStringArrayLike(
  ctx: FieldContext,
  value: JsonValue,
  fieldPath: string
): JsonScalarLike | string[] {
  if (Array.isArray(value)) {
    return value.map((item, index) => requiredString(ctx, item, arrayFieldPath(fieldPath, index)));
  }
  return requiredScalarLike(ctx, value, fieldPath);
}
