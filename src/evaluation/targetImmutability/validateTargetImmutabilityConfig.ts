import type {
  V043TargetImmutabilityConfigIssue,
  V043TargetImmutabilityConfigV1,
  V043TargetImmutabilityConfigValidationResult
} from "./types.js";

const ALLOWED_KEYS = ["targetRootPath", "relativeFilePaths"];
const MAX_RELATIVE_FILES = 100;

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isAbsolutePathLike(value: string): boolean {
  if (value.startsWith("/") || value.startsWith("\\")) return true;
  if (/^[A-Za-z]:[\\/]/.test(value)) return true;
  return false;
}

function hasTraversalSegment(value: string): boolean {
  return value.split(/[\\/]/).includes("..");
}

export function validateTargetImmutabilityConfig(value: unknown): V043TargetImmutabilityConfigValidationResult {
  if (!isPlainObject(value)) {
    return {
      ok: false,
      issues: [{ code: "NON_OBJECT_CONFIG", fieldPath: "", message: "Target immutability config must be an object." }]
    };
  }

  const root = value;
  const issues: V043TargetImmutabilityConfigIssue[] = [];

  for (const key of Object.keys(root)) {
    if (!ALLOWED_KEYS.includes(key)) {
      issues.push({ code: "UNKNOWN_CONFIG_FIELD", fieldPath: key, message: `"${key}" is not a recognized field.` });
    }
  }

  if (root.targetRootPath === undefined) {
    issues.push({ code: "MISSING_REQUIRED_FIELD", fieldPath: "targetRootPath", message: "targetRootPath is required." });
  }
  if (root.relativeFilePaths === undefined) {
    issues.push({ code: "MISSING_REQUIRED_FIELD", fieldPath: "relativeFilePaths", message: "relativeFilePaths is required." });
  }

  const targetRootPathIsString = root.targetRootPath !== undefined && typeof root.targetRootPath === "string";
  if (root.targetRootPath !== undefined && !targetRootPathIsString) {
    issues.push({ code: "INVALID_FIELD_TYPE", fieldPath: "targetRootPath", message: "targetRootPath must be a string." });
  }
  const relativeFilePathsIsArray = root.relativeFilePaths !== undefined && Array.isArray(root.relativeFilePaths);
  if (root.relativeFilePaths !== undefined && !relativeFilePathsIsArray) {
    issues.push({ code: "INVALID_FIELD_TYPE", fieldPath: "relativeFilePaths", message: "relativeFilePaths must be an array." });
  }

  if (targetRootPathIsString && (root.targetRootPath as string).trim().length === 0) {
    issues.push({ code: "EMPTY_TARGET_ROOT_PATH", fieldPath: "targetRootPath", message: "targetRootPath must be a nonempty string." });
  }

  let pathsArray: unknown[] = [];
  if (relativeFilePathsIsArray) {
    pathsArray = root.relativeFilePaths as unknown[];
    if (pathsArray.length === 0) {
      issues.push({
        code: "EMPTY_RELATIVE_FILE_SET",
        fieldPath: "relativeFilePaths",
        message: "relativeFilePaths must contain at least one entry."
      });
    } else if (pathsArray.length > MAX_RELATIVE_FILES) {
      issues.push({
        code: "TOO_MANY_RELATIVE_FILES",
        fieldPath: "relativeFilePaths",
        message: `relativeFilePaths must contain at most ${MAX_RELATIVE_FILES} entries.`
      });
    }
  }

  const validStringPaths: Array<string | null> = [];
  if (relativeFilePathsIsArray) {
    pathsArray.forEach((entry, index) => {
      if (typeof entry !== "string") {
        issues.push({
          code: "INVALID_FIELD_TYPE",
          fieldPath: `relativeFilePaths[${index}]`,
          message: `relativeFilePaths[${index}] must be a string.`
        });
        validStringPaths.push(null);
      } else if (entry.trim().length === 0) {
        issues.push({
          code: "EMPTY_RELATIVE_FILE_PATH",
          fieldPath: `relativeFilePaths[${index}]`,
          message: `relativeFilePaths[${index}] must be a nonempty string.`
        });
        validStringPaths.push(null);
      } else {
        validStringPaths.push(entry);
      }
    });
  }

  if (relativeFilePathsIsArray) {
    validStringPaths.forEach((entry, index) => {
      if (entry !== null && isAbsolutePathLike(entry)) {
        issues.push({
          code: "ABSOLUTE_RELATIVE_FILE_PATH",
          fieldPath: `relativeFilePaths[${index}]`,
          message: `relativeFilePaths[${index}] must be a relative path.`
        });
      }
    });
  }

  if (relativeFilePathsIsArray) {
    validStringPaths.forEach((entry, index) => {
      if (entry !== null && hasTraversalSegment(entry)) {
        issues.push({
          code: "RELATIVE_FILE_PATH_TRAVERSAL",
          fieldPath: `relativeFilePaths[${index}]`,
          message: `relativeFilePaths[${index}] must not contain a ".." path segment.`
        });
      }
    });
  }

  if (relativeFilePathsIsArray) {
    const seen = new Set<string>();
    validStringPaths.forEach((entry, index) => {
      if (entry === null) return;
      if (seen.has(entry)) {
        issues.push({
          code: "DUPLICATE_RELATIVE_FILE_PATH",
          fieldPath: `relativeFilePaths[${index}]`,
          message: `relativeFilePaths[${index}] duplicates an earlier entry.`
        });
      }
      seen.add(entry);
    });
  }

  if (issues.length > 0) {
    return { ok: false, issues };
  }

  return { ok: true, config: value as unknown as V043TargetImmutabilityConfigV1 };
}
