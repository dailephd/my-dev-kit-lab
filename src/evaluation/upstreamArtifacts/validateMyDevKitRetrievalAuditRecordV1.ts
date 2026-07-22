import type { JsonObject, JsonValue } from "./jsonTypes.js";
import type { UpstreamArtifactReadResult } from "./artifactReadTypes.js";
import { parseSupportedMajorOneSchemaVersion } from "./schemaVersion.js";
import {
  ArtifactValidationError,
  arrayFieldPath,
  joinFieldPath,
  optionalField,
  requiredArray,
  requiredField,
  requiredLiteral,
  requiredObject,
  requiredRecord,
  requiredScalarLike,
  requiredString,
  requiredStringArray,
  type FieldContext
} from "./runtimeValidation.js";
import type { AuditStep, AuditStepStatus, FullFileReadRecommendation, RetrievalAuditRecord, RetrievalAuditRecordIndex } from "./myDevKitContextArtifactsV1.js";
import {
  validateBudgetSummary,
  validateContextAdequacyStatement,
  validateContextCapsuleRequest,
  validateFreshnessSummary,
  validateFullFileFallbackSummary,
  validateProvenanceRecord,
  validateResponsibilityMappingSummary,
  validateRoleAdequacyStatement,
  validateRoleContextSummary,
  validateTruncationSummary
} from "./validateMyDevKitContextCapsuleV1.js";

const ARTIFACT_KIND = "my-dev-kit-retrieval-audit-record-v1" as const;

const AUDIT_STEP_STATUSES = ["ok", "skipped", "failed"] as const;

function validateContextCapsuleTool(ctx: FieldContext, value: JsonValue, fieldPath: string) {
  const obj = requiredObject(ctx, value, fieldPath);
  return {
    name: requiredString(ctx, requiredField(ctx, obj, "name", joinFieldPath(fieldPath, "name")), joinFieldPath(fieldPath, "name")),
    version: requiredString(ctx, requiredField(ctx, obj, "version", joinFieldPath(fieldPath, "version")), joinFieldPath(fieldPath, "version"))
  };
}

function validateRetrievalAuditRecordIndex(ctx: FieldContext, value: JsonValue, fieldPath: string): RetrievalAuditRecordIndex {
  const obj = requiredObject(ctx, value, fieldPath);
  return {
    indexPath: requiredString(
      ctx,
      requiredField(ctx, obj, "indexPath", joinFieldPath(fieldPath, "indexPath")),
      joinFieldPath(fieldPath, "indexPath")
    ),
    manifestPath: requiredString(
      ctx,
      requiredField(ctx, obj, "manifestPath", joinFieldPath(fieldPath, "manifestPath")),
      joinFieldPath(fieldPath, "manifestPath")
    )
  };
}

function validateAuditStepRecord(
  ctx: FieldContext,
  value: JsonValue,
  fieldPath: string
): Record<string, string | number | boolean | null> {
  const obj = requiredRecord(ctx, value, fieldPath);
  const result: Record<string, string | number | boolean | null> = {};
  for (const [key, val] of Object.entries(obj)) {
    result[key] = requiredScalarLike(ctx, val, joinFieldPath(fieldPath, key));
  }
  return result;
}

function validateAuditStep(ctx: FieldContext, value: JsonValue, fieldPath: string): AuditStep {
  const obj = requiredObject(ctx, value, fieldPath);
  return {
    id: requiredString(ctx, requiredField(ctx, obj, "id", joinFieldPath(fieldPath, "id")), joinFieldPath(fieldPath, "id")),
    kind: requiredString(ctx, requiredField(ctx, obj, "kind", joinFieldPath(fieldPath, "kind")), joinFieldPath(fieldPath, "kind")) as AuditStep["kind"],
    description: requiredString(
      ctx,
      requiredField(ctx, obj, "description", joinFieldPath(fieldPath, "description")),
      joinFieldPath(fieldPath, "description")
    ),
    inputs: validateAuditStepRecord(ctx, requiredField(ctx, obj, "inputs", joinFieldPath(fieldPath, "inputs")), joinFieldPath(fieldPath, "inputs")),
    outputs: validateAuditStepRecord(ctx, requiredField(ctx, obj, "outputs", joinFieldPath(fieldPath, "outputs")), joinFieldPath(fieldPath, "outputs")),
    status: requiredLiteral(
      ctx,
      requiredField(ctx, obj, "status", joinFieldPath(fieldPath, "status")),
      joinFieldPath(fieldPath, "status"),
      AUDIT_STEP_STATUSES
    ) as AuditStepStatus,
    warnings: requiredStringArray(ctx, requiredField(ctx, obj, "warnings", joinFieldPath(fieldPath, "warnings")), joinFieldPath(fieldPath, "warnings"))
  };
}

function validateFullFileReadRecommendation(ctx: FieldContext, value: JsonValue, fieldPath: string): FullFileReadRecommendation {
  const obj = requiredObject(ctx, value, fieldPath);
  const continuationValue = requiredField(
    ctx,
    obj,
    "continuationOrExpansionAttempted",
    joinFieldPath(fieldPath, "continuationOrExpansionAttempted")
  );
  let continuationOrExpansionAttempted: boolean | "unavailable";
  if (continuationValue === "unavailable") {
    continuationOrExpansionAttempted = "unavailable";
  } else if (typeof continuationValue === "boolean") {
    continuationOrExpansionAttempted = continuationValue;
  } else {
    return requiredLiteral(
      ctx,
      continuationValue,
      joinFieldPath(fieldPath, "continuationOrExpansionAttempted"),
      ["unavailable"] as const
    ) as never;
  }
  return {
    filePath: requiredString(ctx, requiredField(ctx, obj, "filePath", joinFieldPath(fieldPath, "filePath")), joinFieldPath(fieldPath, "filePath")),
    reason: requiredString(ctx, requiredField(ctx, obj, "reason", joinFieldPath(fieldPath, "reason")), joinFieldPath(fieldPath, "reason")),
    missingContext: requiredString(
      ctx,
      requiredField(ctx, obj, "missingContext", joinFieldPath(fieldPath, "missingContext")),
      joinFieldPath(fieldPath, "missingContext")
    ),
    continuationOrExpansionAttempted
  };
}

export function validateMyDevKitRetrievalAuditRecordV1(
  value: JsonObject,
  sourcePath: string
): UpstreamArtifactReadResult<RetrievalAuditRecord> {
  const ctx: FieldContext = { artifactKind: ARTIFACT_KIND, sourcePath };
  try {
    const schemaVersionResult = parseSupportedMajorOneSchemaVersion(
      requiredField(ctx, value, "schemaVersion", "schemaVersion"),
      ARTIFACT_KIND,
      sourcePath
    );
    if ("ok" in schemaVersionResult) return schemaVersionResult;

    const record: RetrievalAuditRecord = {
      schemaVersion: requiredString(ctx, value.schemaVersion, "schemaVersion") as "1.0.0",
      generatedAt: requiredString(ctx, requiredField(ctx, value, "generatedAt", "generatedAt"), "generatedAt"),
      tool: validateContextCapsuleTool(ctx, requiredField(ctx, value, "tool", "tool"), "tool"),
      request: validateContextCapsuleRequest(ctx, requiredField(ctx, value, "request", "request"), "request"),
      index: validateRetrievalAuditRecordIndex(ctx, requiredField(ctx, value, "index", "index"), "index"),
      steps: requiredArray(ctx, requiredField(ctx, value, "steps", "steps"), "steps").map((item, i) =>
        validateAuditStep(ctx, item, arrayFieldPath("steps", i))
      ),
      fallbacks: requiredStringArray(ctx, requiredField(ctx, value, "fallbacks", "fallbacks"), "fallbacks"),
      fullFileReadRecommendations: requiredArray(
        ctx,
        requiredField(ctx, value, "fullFileReadRecommendations", "fullFileReadRecommendations"),
        "fullFileReadRecommendations"
      ).map((item, i) => validateFullFileReadRecommendation(ctx, item, arrayFieldPath("fullFileReadRecommendations", i))),
      warnings: requiredStringArray(ctx, requiredField(ctx, value, "warnings", "warnings"), "warnings"),
      contextAdequacy: validateContextAdequacyStatement(ctx, requiredField(ctx, value, "contextAdequacy", "contextAdequacy"), "contextAdequacy"),
      roleContext: validateRoleContextSummary(ctx, requiredField(ctx, value, "roleContext", "roleContext"), "roleContext"),
      responsibilityMappings: validateResponsibilityMappingSummary(
        ctx,
        requiredField(ctx, value, "responsibilityMappings", "responsibilityMappings"),
        "responsibilityMappings"
      ),
      roleAdequacy: validateRoleAdequacyStatement(ctx, requiredField(ctx, value, "roleAdequacy", "roleAdequacy"), "roleAdequacy"),
      freshness: validateFreshnessSummary(ctx, requiredField(ctx, value, "freshness", "freshness"), "freshness"),
      budget: validateBudgetSummary(ctx, requiredField(ctx, value, "budget", "budget"), "budget"),
      truncation: validateTruncationSummary(ctx, requiredField(ctx, value, "truncation", "truncation"), "truncation"),
      fullFileFallback: validateFullFileFallbackSummary(
        ctx,
        requiredField(ctx, value, "fullFileFallback", "fullFileFallback"),
        "fullFileFallback"
      ),
      provenance: requiredArray(ctx, requiredField(ctx, value, "provenance", "provenance"), "provenance").map((item, i) =>
        validateProvenanceRecord(ctx, item, arrayFieldPath("provenance", i))
      )
    };

    // The record above exists only to walk and type-check every field. Per the exact
    // upstream-mirror contract, the returned artifact is always the original parsed
    // reference, not a rebuilt object.
    void record;

    return {
      ok: true,
      artifactKind: ARTIFACT_KIND,
      sourcePath,
      schemaVersion: value.schemaVersion as string,
      schemaMajor: 1,
      artifact: value as unknown as RetrievalAuditRecord,
      rawArtifact: value
    };
  } catch (error) {
    if (error instanceof ArtifactValidationError) return error.failure;
    throw error;
  }
}
