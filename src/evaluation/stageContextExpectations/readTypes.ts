import type { JsonObject, JsonValue } from "../upstreamArtifacts/index.js";
import type { StageContextExpectationFixtureV1 } from "./types.js";

export type StageContextExpectationReadErrorCode =
  | "FILE_NOT_FOUND"
  | "UNREADABLE_FILE"
  | "MALFORMED_JSON"
  | "NON_OBJECT_ROOT"
  | "INVALID_SCHEMA_VERSION"
  | "UNSUPPORTED_SCHEMA_MAJOR"
  | "MISSING_REQUIRED_FIELD"
  | "INVALID_FIELD_TYPE"
  | "INVALID_LITERAL_VALUE"
  | "INVALID_CASE_ID"
  | "INVALID_EXPECTATION_ID"
  | "EXPECTATION_ID_PREFIX_MISMATCH"
  | "DUPLICATE_EXPECTATION_ID"
  | "DUPLICATE_EXPECTATION_TARGET"
  | "CONFLICTING_EXPECTATION_INCLUSION"
  | "INVALID_CATEGORY_SOURCE_PAIR"
  | "INVALID_SOURCE_RANGE"
  | "EMPTY_EXPECTATION_SET"
  | "DUPLICATE_EXPECTED_VALUE";

export interface StageContextExpectationReadFailure {
  ok: false;
  sourcePath: string;
  code: StageContextExpectationReadErrorCode;
  message: string;
  fieldPath?: string;
  expected?: string;
  actual?: JsonValue;
}

export interface StageContextExpectationReadSuccess {
  ok: true;
  sourcePath: string;
  schemaVersion: string;
  schemaMajor: 1;
  fixture: StageContextExpectationFixtureV1;
  rawFixture: JsonObject;
}

export type StageContextExpectationReadResult = StageContextExpectationReadSuccess | StageContextExpectationReadFailure;
