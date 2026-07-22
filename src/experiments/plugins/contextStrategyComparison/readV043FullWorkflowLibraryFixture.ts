import { readFile } from "node:fs/promises";
import path from "node:path";
import type {
  FullWorkflowLibraryFixtureV1,
  FullWorkflowLibraryReadErrorCode,
  FullWorkflowLibraryReadFailure,
  FullWorkflowLibraryReadResult
} from "./v043FullWorkflowLibraryFixture.js";

const SCHEMA_VERSION_PATTERN = /^[0-9]+\.[0-9]+\.[0-9]+$/;
const FIXTURE_ID_PATTERN = /^FULL-WORKFLOW-LIBRARY-[A-Z0-9]+(?:-[A-Z0-9]+)*-[0-9]{3}$/;

const REQUIRED_NONEMPTY_ID_ARRAY_FIELDS: Array<keyof FullWorkflowLibraryFixtureV1> = [
  "workflowIds",
  "stageIds",
  "commandIds",
  "ruleIds",
  "reportContractIds"
];

const ALL_ID_ARRAY_FIELDS: Array<keyof FullWorkflowLibraryFixtureV1> = [
  ...REQUIRED_NONEMPTY_ID_ARRAY_FIELDS,
  "provenanceEvidenceIds"
];

function failure(
  sourcePath: string,
  code: FullWorkflowLibraryReadErrorCode,
  message: string,
  extra?: { fieldPath?: string; expected?: string; actual?: unknown }
): FullWorkflowLibraryReadFailure {
  return { ok: false, sourcePath, code, message, ...extra };
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((entry) => typeof entry === "string");
}

function hasDuplicates(values: string[]): boolean {
  return new Set(values).size !== values.length;
}

function validateFullWorkflowLibraryFixture(value: unknown, sourcePath: string): FullWorkflowLibraryReadResult {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    return failure(sourcePath, "NON_OBJECT_ROOT", "Full-workflow-library fixture must parse to a JSON object at the root.", {
      expected: "object",
      actual: value
    });
  }

  const root = value as Record<string, unknown>;

  if (root.schemaVersion === undefined) {
    return failure(sourcePath, "MISSING_REQUIRED_FIELD", "schemaVersion is required.", { fieldPath: "schemaVersion" });
  }
  if (typeof root.schemaVersion !== "string") {
    return failure(sourcePath, "INVALID_FIELD_TYPE", "schemaVersion must be a string.", { fieldPath: "schemaVersion" });
  }
  if (!SCHEMA_VERSION_PATTERN.test(root.schemaVersion)) {
    return failure(sourcePath, "INVALID_SCHEMA_VERSION", `schemaVersion "${root.schemaVersion}" does not match x.y.z.`, {
      fieldPath: "schemaVersion",
      actual: root.schemaVersion
    });
  }
  const schemaVersionValue = root.schemaVersion;
  const schemaMajor = Number(schemaVersionValue.split(".")[0]);
  if (schemaMajor !== 1) {
    return failure(sourcePath, "UNSUPPORTED_SCHEMA_MAJOR", `schemaVersion major "${schemaMajor}" is not supported.`, {
      fieldPath: "schemaVersion",
      actual: schemaVersionValue
    });
  }

  if (root.fixtureId === undefined) {
    return failure(sourcePath, "MISSING_REQUIRED_FIELD", "fixtureId is required.", { fieldPath: "fixtureId" });
  }
  if (typeof root.fixtureId !== "string") {
    return failure(sourcePath, "INVALID_FIELD_TYPE", "fixtureId must be a string.", { fieldPath: "fixtureId" });
  }
  if (!FIXTURE_ID_PATTERN.test(root.fixtureId)) {
    return failure(sourcePath, "INVALID_FIXTURE_ID", `fixtureId "${root.fixtureId}" does not match the required pattern.`, {
      fieldPath: "fixtureId",
      actual: root.fixtureId
    });
  }

  for (const field of ["title", "description"] as const) {
    const fieldValue = root[field];
    if (fieldValue === undefined) {
      return failure(sourcePath, "MISSING_REQUIRED_FIELD", `${field} is required.`, { fieldPath: field });
    }
    if (typeof fieldValue !== "string") {
      return failure(sourcePath, "INVALID_FIELD_TYPE", `${field} must be a string.`, { fieldPath: field });
    }
    if (fieldValue.trim().length === 0) {
      return failure(sourcePath, "INVALID_FIELD_TYPE", `${field} must be a nonempty string.`, { fieldPath: field });
    }
  }

  for (const field of ALL_ID_ARRAY_FIELDS) {
    const fieldValue = root[field];
    if (fieldValue === undefined) {
      return failure(sourcePath, "MISSING_REQUIRED_FIELD", `${field} is required.`, { fieldPath: field });
    }
    if (!isStringArray(fieldValue)) {
      return failure(sourcePath, "INVALID_FIELD_TYPE", `${field} must be an array of strings.`, { fieldPath: field });
    }
    if (fieldValue.some((entry) => entry.length === 0)) {
      return failure(sourcePath, "INVALID_FIELD_TYPE", `${field} entries must be nonempty strings.`, { fieldPath: field });
    }
  }

  for (const field of REQUIRED_NONEMPTY_ID_ARRAY_FIELDS) {
    const fieldValue = root[field] as string[];
    if (fieldValue.length === 0) {
      return failure(sourcePath, "EMPTY_REQUIRED_ID_SET", `${field} must contain at least one entry.`, { fieldPath: field });
    }
  }

  for (const field of ALL_ID_ARRAY_FIELDS) {
    const fieldValue = root[field] as string[];
    if (hasDuplicates(fieldValue)) {
      return failure(sourcePath, "DUPLICATE_ID", `${field} contains duplicate entries.`, { fieldPath: field });
    }
  }

  if (root.rawText === undefined) {
    return failure(sourcePath, "MISSING_REQUIRED_FIELD", "rawText is required.", { fieldPath: "rawText" });
  }
  if (typeof root.rawText !== "string") {
    return failure(sourcePath, "INVALID_FIELD_TYPE", "rawText must be a string.", { fieldPath: "rawText" });
  }
  if (root.rawText.trim().length === 0) {
    return failure(sourcePath, "EMPTY_RAW_TEXT", "rawText must be a nonempty string.", { fieldPath: "rawText" });
  }

  if (root.warnings === undefined) {
    return failure(sourcePath, "MISSING_REQUIRED_FIELD", "warnings is required.", { fieldPath: "warnings" });
  }
  if (!isStringArray(root.warnings)) {
    return failure(sourcePath, "INVALID_FIELD_TYPE", "warnings must be an array of strings.", { fieldPath: "warnings" });
  }

  const fixture = value as unknown as FullWorkflowLibraryFixtureV1;

  return {
    ok: true,
    sourcePath,
    schemaVersion: schemaVersionValue,
    schemaMajor: 1,
    fixture,
    rawFixture: fixture
  };
}

export async function readV043FullWorkflowLibraryFixture(sourcePathInput: string): Promise<FullWorkflowLibraryReadResult> {
  const sourcePath = path.resolve(sourcePathInput);

  let raw: string;
  try {
    raw = await readFile(sourcePath, "utf8");
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code === "ENOENT") {
      return {
        ok: false,
        sourcePath,
        code: "FILE_NOT_FOUND",
        message: `Full-workflow-library fixture was not found at "${sourcePath}".`
      };
    }
    return {
      ok: false,
      sourcePath,
      code: "UNREADABLE_FILE",
      message: `Full-workflow-library fixture at "${sourcePath}" could not be read: ${(error as Error).message}`
    };
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (error) {
    return {
      ok: false,
      sourcePath,
      code: "MALFORMED_JSON",
      message: `Full-workflow-library fixture at "${sourcePath}" is not valid JSON: ${(error as Error).message}`
    };
  }

  return validateFullWorkflowLibraryFixture(parsed, sourcePath);
}
