import type { JsonValue } from "./jsonTypes.js";
import type { UpstreamArtifactKind, UpstreamArtifactReadFailure } from "./artifactReadTypes.js";

const SCHEMA_VERSION_PATTERN = /^[0-9]+\.[0-9]+\.[0-9]+$/;

export interface SupportedSchemaVersion {
  version: string;
  major: 1;
  minor: number;
  patch: number;
}

export function parseSupportedMajorOneSchemaVersion(
  value: JsonValue,
  artifactKind: UpstreamArtifactKind,
  sourcePath: string,
  fieldPath = "schemaVersion"
): SupportedSchemaVersion | UpstreamArtifactReadFailure {
  if (typeof value !== "string" || !SCHEMA_VERSION_PATTERN.test(value)) {
    return {
      ok: false,
      artifactKind,
      sourcePath,
      code: "INVALID_SCHEMA_VERSION",
      message: `Artifact "${artifactKind}" at "${sourcePath}" has an invalid "${fieldPath}": expected strict "x.y.z" semantic version.`,
      fieldPath,
      expected: "^[0-9]+\\.[0-9]+\\.[0-9]+$",
      actual: value
    };
  }

  const [majorText, minorText, patchText] = value.split(".");
  const major = Number(majorText);
  const minor = Number(minorText);
  const patch = Number(patchText);

  if (major !== 1) {
    return {
      ok: false,
      artifactKind,
      sourcePath,
      code: "UNSUPPORTED_SCHEMA_MAJOR",
      message: `Artifact "${artifactKind}" at "${sourcePath}" has unsupported schema major "${major}" in "${fieldPath}": supported major is 1.`,
      fieldPath,
      expected: "1",
      actual: value
    };
  }

  return { version: value, major: 1, minor, patch };
}
