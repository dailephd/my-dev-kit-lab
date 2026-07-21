import type { JsonObject, JsonValue } from "./jsonTypes.js";

export type UpstreamArtifactKind =
  | "my-dev-kit-context-capsule-v1"
  | "my-dev-kit-retrieval-audit-record-v1"
  | "orchestrator-workflow-instruction-packet-v1";

export type UpstreamArtifactReadErrorCode =
  | "FILE_NOT_FOUND"
  | "UNREADABLE_FILE"
  | "MALFORMED_JSON"
  | "NON_OBJECT_ROOT"
  | "INVALID_SCHEMA_VERSION"
  | "UNSUPPORTED_SCHEMA_MAJOR"
  | "MISSING_REQUIRED_FIELD"
  | "INVALID_FIELD_TYPE"
  | "INVALID_LITERAL_VALUE"
  | "DUPLICATE_RESOLVED_COMMAND_ID"
  | "DUPLICATE_RESOLVED_RULE_ID";

export interface UpstreamArtifactReadFailure {
  ok: false;
  artifactKind: UpstreamArtifactKind;
  sourcePath: string;
  code: UpstreamArtifactReadErrorCode;
  message: string;
  fieldPath?: string;
  expected?: string;
  actual?: JsonValue;
}

export interface UpstreamArtifactReadSuccess<TArtifact extends JsonObject> {
  ok: true;
  artifactKind: UpstreamArtifactKind;
  sourcePath: string;
  schemaVersion: string;
  schemaMajor: 1;
  artifact: TArtifact;
  rawArtifact: JsonObject;
}

export type UpstreamArtifactReadResult<TArtifact extends JsonObject> =
  | UpstreamArtifactReadSuccess<TArtifact>
  | UpstreamArtifactReadFailure;
