import type { EcosystemFixtureManifestV1 } from "./manifestTypes.js";

export type ManifestValidationErrorCode =
  | "NON_OBJECT_MANIFEST"
  | "UNSUPPORTED_MANIFEST_SCHEMA_MAJOR"
  | "MISSING_REQUIRED_FIELD"
  | "INVALID_FIELD_TYPE"
  | "DUPLICATE_ARTIFACT_PATH"
  | "PATH_ESCAPES_FIXTURE_ROOT";

export interface ManifestValidationIssue {
  code: ManifestValidationErrorCode;
  fieldPath: string;
  message: string;
}

export type ManifestValidationResult =
  | { ok: true; manifest: EcosystemFixtureManifestV1 }
  | { ok: false; issues: ManifestValidationIssue[] };

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

// Rejects any fixture-relative path that is absolute, empty, or escapes the fixture root
// via ".." segments (section 22 "rejects path traversal"). Windows and POSIX separators are
// both checked since fixture manifests are authored on Windows but tests may run on either.
export function isSafeFixtureRelativePath(candidate: string): boolean {
  if (candidate.length === 0) return false;
  if (candidate.startsWith("/") || candidate.startsWith("\\")) return false;
  if (/^[a-zA-Z]:[\\/]/.test(candidate)) return false;
  const segments = candidate.split(/[\\/]/);
  return segments.every((segment) => segment !== "..") && segments.length > 0;
}

export function validateEcosystemFixtureManifest(value: unknown): ManifestValidationResult {
  const issues: ManifestValidationIssue[] = [];

  if (!isPlainObject(value)) {
    return { ok: false, issues: [{ code: "NON_OBJECT_MANIFEST", fieldPath: "", message: "Manifest must be a plain JSON object." }] };
  }

  const schemaVersion = value["manifestSchemaVersion"];
  if (typeof schemaVersion !== "string" || !/^1\./.test(schemaVersion)) {
    return {
      ok: false,
      issues: [
        {
          code: "UNSUPPORTED_MANIFEST_SCHEMA_MAJOR",
          fieldPath: "manifestSchemaVersion",
          message: `Manifest schema version "${String(schemaVersion)}" is unsupported; expected major version 1.`
        }
      ]
    };
  }

  const requiredStringFields = ["fixtureId", "description", "sourceEvidenceRoot", "generatedAt"] as const;
  for (const field of requiredStringFields) {
    if (typeof value[field] !== "string" || (value[field] as string).length === 0) {
      issues.push({ code: "MISSING_REQUIRED_FIELD", fieldPath: field, message: `Manifest is missing required non-empty string field "${field}".` });
    }
  }

  const artifacts = value["artifacts"];
  if (!Array.isArray(artifacts)) {
    issues.push({ code: "INVALID_FIELD_TYPE", fieldPath: "artifacts", message: 'Manifest field "artifacts" must be an array.' });
  } else {
    const seenPaths = new Set<string>();
    artifacts.forEach((entry, index) => {
      const fieldPath = `artifacts[${index}]`;
      if (!isPlainObject(entry)) {
        issues.push({ code: "INVALID_FIELD_TYPE", fieldPath, message: "Each artifact entry must be an object." });
        return;
      }
      const relPath = entry["fixtureRelativePath"];
      if (typeof relPath !== "string" || relPath.length === 0) {
        issues.push({ code: "MISSING_REQUIRED_FIELD", fieldPath: `${fieldPath}.fixtureRelativePath`, message: "Missing fixtureRelativePath." });
        return;
      }
      if (!isSafeFixtureRelativePath(relPath)) {
        issues.push({
          code: "PATH_ESCAPES_FIXTURE_ROOT",
          fieldPath: `${fieldPath}.fixtureRelativePath`,
          message: `fixtureRelativePath "${relPath}" is absolute or escapes the fixture root.`
        });
        return;
      }
      if (seenPaths.has(relPath)) {
        issues.push({ code: "DUPLICATE_ARTIFACT_PATH", fieldPath: `${fieldPath}.fixtureRelativePath`, message: `Duplicate fixtureRelativePath "${relPath}".` });
        return;
      }
      seenPaths.add(relPath);
      for (const hashField of ["originalSha256", "copiedSha256"] as const) {
        const v = entry[hashField];
        if (typeof v !== "string" || !/^[0-9a-f]{64}$/i.test(v)) {
          issues.push({ code: "INVALID_FIELD_TYPE", fieldPath: `${fieldPath}.${hashField}`, message: `${hashField} must be a 64-hex-character SHA-256 digest.` });
        }
      }
    });
  }

  if (issues.length > 0) return { ok: false, issues };
  return { ok: true, manifest: value as unknown as EcosystemFixtureManifestV1 };
}
