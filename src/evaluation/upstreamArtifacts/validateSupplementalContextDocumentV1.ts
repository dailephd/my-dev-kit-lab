import type { JsonObject } from "./jsonTypes.js";
import type {
  UpstreamArtifactKind,
  UpstreamArtifactReadFailure,
  UpstreamArtifactReadResult
} from "./artifactReadTypes.js";
import { makeFailure } from "./runtimeValidation.js";
import { parseSupplementalContextText } from "./supplementalContextTextParser.js";
import {
  REQUIRED_METADATA_BY_DOCUMENT_KIND,
  REQUIRED_SECTIONS_BY_DOCUMENT_KIND,
  ROLE_BY_DOCUMENT_KIND,
  SUPPLEMENTAL_CONTEXT_PACKET_SCHEMA_SUPPORTED_MAJOR,
  SUPPLEMENTAL_CONTEXT_RETRIEVAL_REPORT_SCHEMA_SUPPORTED_MAJOR,
  VALID_ADEQUACY_VALUES,
  VALID_DECLARED_STATUSES,
  VALID_FRESHNESS_VALUES,
  VALID_REPOSITORY_SCOPES,
  VALID_TRUNCATION_VALUES,
  isRetrievalReportKind,
  isTestKind,
  type DeclaredAdequacy,
  type DeclaredFreshness,
  type DeclaredTruncation,
  type RepositoryScope,
  type SupplementalContextDeclaredStatus,
  type SupplementalContextDocumentKind,
  type SupplementalContextDocumentV1
} from "./supplementalContextTypes.js";

const SCHEMA_VERSION_PATTERN = /^[0-9]+\.[0-9]+\.[0-9]+$/;

function supportedMajorForKind(kind: SupplementalContextDocumentKind): number {
  return isRetrievalReportKind(kind)
    ? SUPPLEMENTAL_CONTEXT_RETRIEVAL_REPORT_SCHEMA_SUPPORTED_MAJOR
    : SUPPLEMENTAL_CONTEXT_PACKET_SCHEMA_SUPPORTED_MAJOR;
}

function literalOrFail<T extends string>(
  artifactKind: UpstreamArtifactKind,
  sourcePath: string,
  fieldPath: string,
  value: string,
  allowed: readonly T[],
  errorCode: UpstreamArtifactReadFailure["code"] = "INVALID_LITERAL_VALUE"
): T | UpstreamArtifactReadFailure {
  if ((allowed as readonly string[]).includes(value)) return value as T;
  return {
    ok: false,
    artifactKind,
    sourcePath,
    code: errorCode,
    message: `Field "${fieldPath}" in artifact "${artifactKind}" at "${sourcePath}" has invalid value "${value}". Expected one of: ${allowed.join(", ")}.`,
    fieldPath,
    expected: allowed.join(" | "),
    actual: value
  };
}

function isFailure<T>(value: T | UpstreamArtifactReadFailure): value is UpstreamArtifactReadFailure {
  return typeof value === "object" && value !== null && (value as { ok?: unknown }).ok === false;
}

export function validateSupplementalContextDocumentV1(
  artifactKind: UpstreamArtifactKind,
  expectedKind: SupplementalContextDocumentKind,
  text: string,
  sourcePath: string
): UpstreamArtifactReadResult<SupplementalContextDocumentV1> {
  const parsed = parseSupplementalContextText(text);

  if (parsed.metadataOrder.length === 0 && parsed.sectionOrder.length === 0) {
    return makeFailure(
      artifactKind,
      sourcePath,
      "MALFORMED_TEXT_ARTIFACT",
      `Artifact "${artifactKind}" at "${sourcePath}" contains no recognizable "Key: value" metadata or "## Heading" sections.`
    );
  }

  // Kind/role identity is checked before general required-metadata/section completeness so
  // that feeding one document kind's file to another kind's reader is reported as a
  // structural identity mismatch (DOCUMENT_KIND_MISMATCH / DOCUMENT_ROLE_MISMATCH) rather
  // than as an incidental "missing metadata key" from the wrong kind's required-field list.
  const declaredKind = parsed.metadata["Document kind"];
  if (declaredKind !== expectedKind) {
    return makeFailure(
      artifactKind,
      sourcePath,
      "DOCUMENT_KIND_MISMATCH",
      `Artifact "${artifactKind}" at "${sourcePath}" declares document kind "${declaredKind}" but this reader expects "${expectedKind}".`,
      "Document kind",
      expectedKind,
      declaredKind
    );
  }

  const expectedRole = ROLE_BY_DOCUMENT_KIND[expectedKind];
  const declaredRole = parsed.metadata["Role"];
  if (declaredRole !== expectedRole) {
    return makeFailure(
      artifactKind,
      sourcePath,
      "DOCUMENT_ROLE_MISMATCH",
      `Artifact "${artifactKind}" at "${sourcePath}" declares role "${declaredRole}" but this reader expects "${expectedRole}".`,
      "Role",
      expectedRole,
      declaredRole
    );
  }

  const requiredMetadata = REQUIRED_METADATA_BY_DOCUMENT_KIND[expectedKind];
  for (const key of requiredMetadata) {
    if (!(key in parsed.metadata)) {
      return makeFailure(
        artifactKind,
        sourcePath,
        "MISSING_REQUIRED_METADATA",
        `Artifact "${artifactKind}" at "${sourcePath}" is missing required metadata key "${key}".`,
        key,
        "present"
      );
    }
  }

  const requiredSections = REQUIRED_SECTIONS_BY_DOCUMENT_KIND[expectedKind];
  for (const heading of requiredSections) {
    if (!(heading in parsed.sections)) {
      return makeFailure(
        artifactKind,
        sourcePath,
        "MISSING_REQUIRED_SECTION",
        `Artifact "${artifactKind}" at "${sourcePath}" is missing required section heading "## ${heading}".`,
        heading,
        "present"
      );
    }
  }

  const schemaVersion = parsed.metadata["Schema version"];
  if (!SCHEMA_VERSION_PATTERN.test(schemaVersion)) {
    return makeFailure(
      artifactKind,
      sourcePath,
      "INVALID_SCHEMA_VERSION",
      `Artifact "${artifactKind}" at "${sourcePath}" has an invalid "Schema version": expected strict "x.y.z" semantic version.`,
      "Schema version",
      "^[0-9]+\\.[0-9]+\\.[0-9]+$",
      schemaVersion
    );
  }
  const major = Number(schemaVersion.split(".")[0]);
  const supportedMajor = supportedMajorForKind(expectedKind);
  if (major !== supportedMajor) {
    return makeFailure(
      artifactKind,
      sourcePath,
      "UNSUPPORTED_SCHEMA_MAJOR",
      `Artifact "${artifactKind}" at "${sourcePath}" has unsupported schema major "${major}" in "Schema version": supported major is ${supportedMajor}.`,
      "Schema version",
      String(supportedMajor),
      schemaVersion
    );
  }

  const status = literalOrFail<SupplementalContextDeclaredStatus>(
    artifactKind,
    sourcePath,
    "Status",
    parsed.metadata["Status"],
    VALID_DECLARED_STATUSES,
    "UNKNOWN_STATUS_VALUE"
  );
  if (isFailure(status)) return status;

  const repositoryScope = literalOrFail<RepositoryScope>(
    artifactKind,
    sourcePath,
    "Repository scope",
    parsed.metadata["Repository scope"],
    VALID_REPOSITORY_SCOPES
  );
  if (isFailure(repositoryScope)) return repositoryScope;

  const freshness = literalOrFail<DeclaredFreshness>(
    artifactKind,
    sourcePath,
    "Freshness",
    parsed.metadata["Freshness"],
    VALID_FRESHNESS_VALUES
  );
  if (isFailure(freshness)) return freshness;

  const adequacy = literalOrFail<DeclaredAdequacy>(
    artifactKind,
    sourcePath,
    "Adequacy",
    parsed.metadata["Adequacy"],
    VALID_ADEQUACY_VALUES
  );
  if (isFailure(adequacy)) return adequacy;

  const requiredEvidenceTruncated = literalOrFail<DeclaredTruncation>(
    artifactKind,
    sourcePath,
    "Required evidence truncated",
    parsed.metadata["Required evidence truncated"],
    VALID_TRUNCATION_VALUES
  );
  if (isFailure(requiredEvidenceTruncated)) return requiredEvidenceTruncated;

  const indexIdentity = parsed.metadata["Index identity"];
  if (!indexIdentity || indexIdentity.length === 0) {
    return makeFailure(
      artifactKind,
      sourcePath,
      "MISSING_CANONICAL_IDENTITY",
      `Artifact "${artifactKind}" at "${sourcePath}" is missing a non-empty canonical "Index identity".`,
      "Index identity",
      "present"
    );
  }

  const document: SupplementalContextDocumentV1 = {
    documentKind: expectedKind,
    role: expectedRole,
    schemaVersion,
    schemaMajor: 1,
    status,
    repositoryScope,
    freshness,
    adequacy,
    requiredEvidenceTruncated,
    contextCapsuleSchemaVersion: parsed.metadata["Context capsule schema version"],
    retrievalAuditSchemaVersion: parsed.metadata["Retrieval audit schema version"],
    toolName: parsed.metadata["Tool name"],
    toolVersion: parsed.metadata["Tool version"],
    indexIdentity,
    rawMetadata: parsed.metadata,
    sections: parsed.sections,
    sectionOrder: parsed.sectionOrder,
    metadataOrder: parsed.metadataOrder,
    warnings: []
  };

  if (isRetrievalReportKind(expectedKind)) {
    document.requestSchemaVersion = parsed.metadata["Request schema version"];
    const fullFileFallbackUsed = literalOrFail<DeclaredTruncation>(
      artifactKind,
      sourcePath,
      "Full-file fallback used",
      parsed.metadata["Full-file fallback used"],
      VALID_TRUNCATION_VALUES
    );
    if (isFailure(fullFileFallbackUsed)) return fullFileFallbackUsed;
    document.fullFileFallbackUsed = fullFileFallbackUsed;

    const determinismChecked = literalOrFail<DeclaredTruncation>(
      artifactKind,
      sourcePath,
      "Determinism checked",
      parsed.metadata["Determinism checked"],
      VALID_TRUNCATION_VALUES
    );
    if (isFailure(determinismChecked)) return determinismChecked;
    document.determinismChecked = determinismChecked;
  }

  if (isTestKind(expectedKind)) {
    const responsibilityMappingsTruncated = literalOrFail<DeclaredTruncation>(
      artifactKind,
      sourcePath,
      "Responsibility mappings truncated",
      parsed.metadata["Responsibility mappings truncated"],
      VALID_TRUNCATION_VALUES
    );
    if (isFailure(responsibilityMappingsTruncated)) return responsibilityMappingsTruncated;
    document.responsibilityMappingsTruncated = responsibilityMappingsTruncated;

    // Preserved verbatim, never validated against the orchestrator's internal
    // CriticalResponsibilityMappingState enum -- see supplementalContextTypes.ts.
    const criticalStatus = parsed.metadata["Critical responsibility mapping status"];
    if (!criticalStatus || criticalStatus.length === 0) {
      return makeFailure(
        artifactKind,
        sourcePath,
        "MISSING_REQUIRED_METADATA",
        `Artifact "${artifactKind}" at "${sourcePath}" is missing a non-empty "Critical responsibility mapping status".`,
        "Critical responsibility mapping status",
        "present"
      );
    }
    document.criticalResponsibilityMappingStatus = criticalStatus;
  }

  if (parsed.duplicateMetadataKeys.length > 0) {
    document.warnings.push(
      `Duplicate metadata keys were ignored (first occurrence kept): ${parsed.duplicateMetadataKeys.join(", ")}.`
    );
  }
  if (parsed.duplicateSectionHeadings.length > 0) {
    document.warnings.push(
      `Duplicate section headings were ignored (first occurrence kept): ${parsed.duplicateSectionHeadings.join(", ")}.`
    );
  }
  if (parsed.emptyMetadataKeys.length > 0) {
    document.warnings.push(`Metadata keys had empty values: ${parsed.emptyMetadataKeys.join(", ")}.`);
  }

  return {
    ok: true,
    artifactKind,
    sourcePath,
    schemaVersion,
    schemaMajor: 1,
    artifact: document,
    rawArtifact: { metadata: parsed.metadata, sections: parsed.sections } as unknown as JsonObject
  };
}
