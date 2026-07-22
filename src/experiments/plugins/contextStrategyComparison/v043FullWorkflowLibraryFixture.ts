export interface FullWorkflowLibraryFixtureV1 {
  schemaVersion: string;
  fixtureId: string;
  title: string;
  description: string;
  workflowIds: string[];
  stageIds: string[];
  commandIds: string[];
  ruleIds: string[];
  reportContractIds: string[];
  provenanceEvidenceIds: string[];
  rawText: string;
  warnings: string[];
}

export type FullWorkflowLibraryReadErrorCode =
  | "FILE_NOT_FOUND"
  | "UNREADABLE_FILE"
  | "MALFORMED_JSON"
  | "NON_OBJECT_ROOT"
  | "INVALID_SCHEMA_VERSION"
  | "UNSUPPORTED_SCHEMA_MAJOR"
  | "MISSING_REQUIRED_FIELD"
  | "INVALID_FIELD_TYPE"
  | "INVALID_FIXTURE_ID"
  | "EMPTY_REQUIRED_ID_SET"
  | "DUPLICATE_ID"
  | "EMPTY_RAW_TEXT";

export interface FullWorkflowLibraryReadFailure {
  ok: false;
  sourcePath: string;
  code: FullWorkflowLibraryReadErrorCode;
  message: string;
  fieldPath?: string;
  expected?: string;
  actual?: unknown;
}

export interface FullWorkflowLibraryReadSuccess {
  ok: true;
  sourcePath: string;
  schemaVersion: string;
  schemaMajor: 1;
  fixture: FullWorkflowLibraryFixtureV1;
  rawFixture: FullWorkflowLibraryFixtureV1;
}

export type FullWorkflowLibraryReadResult = FullWorkflowLibraryReadSuccess | FullWorkflowLibraryReadFailure;
