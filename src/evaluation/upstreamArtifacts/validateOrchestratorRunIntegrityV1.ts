import type { JsonObject, JsonValue } from "./jsonTypes.js";
import type { UpstreamArtifactReadResult } from "./artifactReadTypes.js";
import { parseSupportedMajorOneSchemaVersion } from "./schemaVersion.js";
import {
  ArtifactValidationError,
  arrayFieldPath,
  joinFieldPath,
  optionalField,
  optionalString,
  requiredArray,
  requiredBoolean,
  requiredField,
  requiredLiteral,
  requiredNullableLiteral,
  requiredNullableString,
  requiredObject,
  requiredString,
  requiredStringArray,
  type FieldContext
} from "./runtimeValidation.js";
import { validateOrchestratorContextReadinessResultV1, type OrchestratorContextReadinessResultV1 } from "./orchestratorContextReadinessResultV1.js";
import type {
  ArtifactLifecycleState,
  CorrectableStage,
  CorrectionRouteResultV1,
  JudgeVerdict,
  JudgeVerdictParseStatus,
  ManualArtifactLifecycleState,
  OrchestratorArtifactLifecycleEntryV1,
  OrchestratorArtifactStateRecordV1,
  OrchestratorFinalReportEligibilityV1,
  OrchestratorJudgeIntegrityV1,
  OrchestratorRunIntegrityEvidenceV1,
  OrchestratorRunIntegrityGateV1,
  RouteStatus,
  RunIntegrityExpectedJudgeVerdict,
  RunIntegrityReadinessClassification
} from "./orchestratorRunIntegrityV1.js";
import {
  ARTIFACT_LIFECYCLE_STATES,
  CONTEXT_SENSITIVE_STAGE_NAMES,
  CORRECTABLE_STAGES,
  JUDGE_VERDICT_PARSE_STATUSES,
  JUDGE_VERDICTS,
  MANUAL_ARTIFACT_LIFECYCLE_STATES,
  ROUTE_STATUSES,
  RUN_INTEGRITY_READINESS_CLASSIFICATIONS
} from "./orchestratorRunIntegrityV1.js";

const ARTIFACT_KIND = "orchestrator-run-integrity-evidence-v1" as const;

const EXPECTED_JUDGE_VERDICTS = ["PASS", "NEED_CONTEXT"] as const;
const APPLICABLE_CONTEXT_KINDS = ["implementation", "test"] as const;

/** Published Orchestrator 1.7.0 status/check --json projection, not the Lab fixture envelope. */
export type NativeOrchestratorInspectionV1 = {
  schemaVersion: "1.0.0";
  run: { runId: string; mode: string; currentStage: string; status: string };
  ecosystem: { required: boolean; classification: "not-required" | "ready" | "warning" | "blocked"; requirements: Array<{ requirementId: string; capabilityId: string; criticality: "critical" | "noncritical"; state: "satisfied" | "unmet-critical" | "unmet-noncritical"; matchingEvidenceIds: string[]; issueCodes: string[] }>; blockers: string[]; warnings: string[] };
  integrity: { ready: boolean; expectedJudgeVerdict: "PASS" | "NEED_CONTEXT"; blockingCodes: string[] };
  judge: { accepted: boolean; finalReportEligible: boolean };
  checks?: { selection: "default" | "single-artifact" | "artifacts" | "all" | "prompts" | "trace" | "design-map"; outcome: "passed" | "warning" | "failed" | "not-run"; issueCounts: { fail: number | null; warn: number | null }; strict: boolean; exitCode: 0 | 1 };
};

export function validateNativeOrchestratorInspectionV1(value: JsonObject, sourcePath: string): UpstreamArtifactReadResult<NativeOrchestratorInspectionV1> {
  const ctx: FieldContext = { artifactKind: ARTIFACT_KIND, sourcePath };
  try {
    const obj = (v: JsonValue, field: string) => requiredObject(ctx, v, field);
    const str = (v: JsonObject, key: string) => requiredString(ctx, requiredField(ctx, v, key, key), key);
    const bool = (v: JsonObject, key: string) => requiredBoolean(ctx, requiredField(ctx, v, key, key), key);
    const arr = (v: JsonObject, key: string) => requiredStringArray(ctx, requiredField(ctx, v, key, key), key);
    requiredLiteral(ctx, value.schemaVersion, "schemaVersion", ["1.0.0"]);
    const run = obj(value.run, "run"); ["runId", "mode", "currentStage", "status"].forEach(k => str(run, k));
    const eco = obj(value.ecosystem, "ecosystem"); bool(eco, "required"); requiredLiteral(ctx, eco.classification, "ecosystem.classification", ["not-required", "ready", "warning", "blocked"]); arr(eco, "blockers"); arr(eco, "warnings");
    requiredArray(ctx, eco.requirements, "ecosystem.requirements").forEach((entry, index) => { const r = obj(entry, `ecosystem.requirements[${index}]`); str(r, "requirementId"); str(r, "capabilityId"); requiredLiteral(ctx, r.criticality, "criticality", ["critical", "noncritical"]); requiredLiteral(ctx, r.state, "state", ["satisfied", "unmet-critical", "unmet-noncritical"]); arr(r, "matchingEvidenceIds"); arr(r, "issueCodes"); });
    const integrity = obj(value.integrity, "integrity"); bool(integrity, "ready"); requiredLiteral(ctx, integrity.expectedJudgeVerdict, "integrity.expectedJudgeVerdict", ["PASS", "NEED_CONTEXT"]); arr(integrity, "blockingCodes");
    const judge = obj(value.judge, "judge"); bool(judge, "accepted"); bool(judge, "finalReportEligible");
    if (value.checks !== undefined) {
      const checks = obj(value.checks, "checks"); requiredLiteral(ctx, checks.selection, "checks.selection", ["default", "single-artifact", "artifacts", "all", "prompts", "trace", "design-map"]); requiredLiteral(ctx, checks.outcome, "checks.outcome", ["passed", "warning", "failed", "not-run"]); bool(checks, "strict");
      const counts = obj(checks.issueCounts, "checks.issueCounts");
      for (const key of ["fail", "warn"]) { const count = requiredField(ctx, counts, key, key); if (count !== null && (typeof count !== "number" || !Number.isSafeInteger(count) || count < 0)) throw new ArtifactValidationError({ ok: false, artifactKind: ARTIFACT_KIND, sourcePath, code: "INVALID_FIELD_TYPE", message: "Native issue counts must be nonnegative integers or null.", fieldPath: `checks.issueCounts.${key}` }); }
      if (checks.exitCode !== 0 && checks.exitCode !== 1) throw new ArtifactValidationError({ ok: false, artifactKind: ARTIFACT_KIND, sourcePath, code: "INVALID_LITERAL_VALUE", message: "Native checks exitCode must be 0 or 1.", fieldPath: "checks.exitCode" });
    }
    return { ok: true, artifactKind: ARTIFACT_KIND, sourcePath, schemaVersion: "1.0.0", schemaMajor: 1, artifact: value as unknown as NativeOrchestratorInspectionV1, rawArtifact: value };
  } catch (error) { if (error instanceof ArtifactValidationError) return error.failure; throw error; }
}

function validateContextReadinessNested(ctx: FieldContext, value: JsonValue, fieldPath: string): OrchestratorContextReadinessResultV1 {
  const result = validateOrchestratorContextReadinessResultV1(value, `${ctx.sourcePath}#${fieldPath}`);
  if (!result.ok) {
    throw new ArtifactValidationError({
      ok: false,
      artifactKind: ctx.artifactKind,
      sourcePath: ctx.sourcePath,
      code: result.code,
      message: `Nested readiness field "${fieldPath}" is invalid: ${result.message}`,
      fieldPath,
      expected: result.expected,
      actual: result.actual
    });
  }
  return result.artifact;
}

function validateCorrectionRouteResult(ctx: FieldContext, value: JsonValue, fieldPath: string): CorrectionRouteResultV1 {
  const obj = requiredObject(ctx, value, fieldPath);
  return {
    verdict: requiredNullableLiteral(
      ctx,
      requiredField(ctx, obj, "verdict", joinFieldPath(fieldPath, "verdict")),
      joinFieldPath(fieldPath, "verdict"),
      JUDGE_VERDICTS
    ),
    recommendedStage: requiredNullableString(
      ctx,
      requiredField(ctx, obj, "recommendedStage", joinFieldPath(fieldPath, "recommendedStage")),
      joinFieldPath(fieldPath, "recommendedStage")
    ),
    routedStage: requiredNullableLiteral(
      ctx,
      requiredField(ctx, obj, "routedStage", joinFieldPath(fieldPath, "routedStage")),
      joinFieldPath(fieldPath, "routedStage"),
      CORRECTABLE_STAGES
    ),
    routeStatus: requiredLiteral(
      ctx,
      requiredField(ctx, obj, "routeStatus", joinFieldPath(fieldPath, "routeStatus")),
      joinFieldPath(fieldPath, "routeStatus"),
      ROUTE_STATUSES
    ),
    warnings: requiredStringArray(ctx, requiredField(ctx, obj, "warnings", joinFieldPath(fieldPath, "warnings")), joinFieldPath(fieldPath, "warnings")),
    errors: requiredStringArray(ctx, requiredField(ctx, obj, "errors", joinFieldPath(fieldPath, "errors")), joinFieldPath(fieldPath, "errors")),
    isBlocked: requiredBoolean(ctx, requiredField(ctx, obj, "isBlocked", joinFieldPath(fieldPath, "isBlocked")), joinFieldPath(fieldPath, "isBlocked")),
    strictFail: requiredBoolean(
      ctx,
      requiredField(ctx, obj, "strictFail", joinFieldPath(fieldPath, "strictFail")),
      joinFieldPath(fieldPath, "strictFail")
    )
  };
}

function validateGate(ctx: FieldContext, value: JsonValue, fieldPath: string): OrchestratorRunIntegrityGateV1 {
  const obj = requiredObject(ctx, value, fieldPath);
  const result: OrchestratorRunIntegrityGateV1 = {
    schemaVersion: requiredLiteral(
      ctx,
      requiredField(ctx, obj, "schemaVersion", joinFieldPath(fieldPath, "schemaVersion")),
      joinFieldPath(fieldPath, "schemaVersion"),
      ["1.0.0"] as const
    ),
    mode: requiredString(ctx, requiredField(ctx, obj, "mode", joinFieldPath(fieldPath, "mode")), joinFieldPath(fieldPath, "mode")),
    contextRequired: requiredBoolean(
      ctx,
      requiredField(ctx, obj, "contextRequired", joinFieldPath(fieldPath, "contextRequired")),
      joinFieldPath(fieldPath, "contextRequired")
    ),
    applicableContextKinds: requiredArray(
      ctx,
      requiredField(ctx, obj, "applicableContextKinds", joinFieldPath(fieldPath, "applicableContextKinds")),
      joinFieldPath(fieldPath, "applicableContextKinds")
    ).map((item, i) =>
      requiredLiteral(ctx, item, arrayFieldPath(joinFieldPath(fieldPath, "applicableContextKinds"), i), APPLICABLE_CONTEXT_KINDS)
    ),
    contextReady: requiredBoolean(
      ctx,
      requiredField(ctx, obj, "contextReady", joinFieldPath(fieldPath, "contextReady")),
      joinFieldPath(fieldPath, "contextReady")
    ),
    readinessClassification: requiredLiteral(
      ctx,
      requiredField(ctx, obj, "readinessClassification", joinFieldPath(fieldPath, "readinessClassification")),
      joinFieldPath(fieldPath, "readinessClassification"),
      RUN_INTEGRITY_READINESS_CLASSIFICATIONS
    ) as RunIntegrityReadinessClassification,
    blockedStageNames: requiredArray(
      ctx,
      requiredField(ctx, obj, "blockedStageNames", joinFieldPath(fieldPath, "blockedStageNames")),
      joinFieldPath(fieldPath, "blockedStageNames")
    ).map((item, i) => requiredLiteral(ctx, item, arrayFieldPath(joinFieldPath(fieldPath, "blockedStageNames"), i), CONTEXT_SENSITIVE_STAGE_NAMES)),
    blockingCodes: requiredStringArray(
      ctx,
      requiredField(ctx, obj, "blockingCodes", joinFieldPath(fieldPath, "blockingCodes")),
      joinFieldPath(fieldPath, "blockingCodes")
    ),
    recommendedCorrectionStage: requiredNullableString(
      ctx,
      requiredField(ctx, obj, "recommendedCorrectionStage", joinFieldPath(fieldPath, "recommendedCorrectionStage")),
      joinFieldPath(fieldPath, "recommendedCorrectionStage")
    ),
    expectedJudgeVerdict: requiredLiteral(
      ctx,
      requiredField(ctx, obj, "expectedJudgeVerdict", joinFieldPath(fieldPath, "expectedJudgeVerdict")),
      joinFieldPath(fieldPath, "expectedJudgeVerdict"),
      EXPECTED_JUDGE_VERDICTS
    ) as RunIntegrityExpectedJudgeVerdict,
    warnings: requiredStringArray(ctx, requiredField(ctx, obj, "warnings", joinFieldPath(fieldPath, "warnings")), joinFieldPath(fieldPath, "warnings"))
  };
  if (optionalField(obj, "implementationContext") !== undefined) {
    result.implementationContext = validateContextReadinessNested(ctx, obj.implementationContext, joinFieldPath(fieldPath, "implementationContext"));
  }
  if (optionalField(obj, "testContext") !== undefined) {
    result.testContext = validateContextReadinessNested(ctx, obj.testContext, joinFieldPath(fieldPath, "testContext"));
  }
  if (optionalField(obj, "primaryBlocker") !== undefined) {
    // primaryBlocker reuses ContextReadinessBlockerSummary's exact shape (owned by
    // orchestratorContextReadinessResultV1.ts's blockerSummary field); walked structurally
    // here rather than re-validated through a second nested-artifact call, since it is not
    // itself a standalone readiness artifact.
    const blockerObj = requiredObject(ctx, obj.primaryBlocker, joinFieldPath(fieldPath, "primaryBlocker"));
    result.primaryBlocker = blockerObj as unknown as OrchestratorRunIntegrityGateV1["primaryBlocker"];
  }
  return result;
}

function validateJudgeIntegrity(ctx: FieldContext, value: JsonValue, fieldPath: string): OrchestratorJudgeIntegrityV1 {
  const obj = requiredObject(ctx, value, fieldPath);
  const result: OrchestratorJudgeIntegrityV1 = {
    schemaVersion: requiredLiteral(
      ctx,
      requiredField(ctx, obj, "schemaVersion", joinFieldPath(fieldPath, "schemaVersion")),
      joinFieldPath(fieldPath, "schemaVersion"),
      ["1.0.0"] as const
    ),
    judgeArtifactPresent: requiredBoolean(
      ctx,
      requiredField(ctx, obj, "judgeArtifactPresent", joinFieldPath(fieldPath, "judgeArtifactPresent")),
      joinFieldPath(fieldPath, "judgeArtifactPresent")
    ),
    judgeVerdictParseStatus: requiredLiteral(
      ctx,
      requiredField(ctx, obj, "judgeVerdictParseStatus", joinFieldPath(fieldPath, "judgeVerdictParseStatus")),
      joinFieldPath(fieldPath, "judgeVerdictParseStatus"),
      JUDGE_VERDICT_PARSE_STATUSES
    ) as JudgeVerdictParseStatus,
    authoredJudgeVerdict: requiredNullableLiteral(
      ctx,
      requiredField(ctx, obj, "authoredJudgeVerdict", joinFieldPath(fieldPath, "authoredJudgeVerdict")),
      joinFieldPath(fieldPath, "authoredJudgeVerdict"),
      JUDGE_VERDICTS
    ) as JudgeVerdict | null,
    expectedJudgeVerdict: requiredLiteral(
      ctx,
      requiredField(ctx, obj, "expectedJudgeVerdict", joinFieldPath(fieldPath, "expectedJudgeVerdict")),
      joinFieldPath(fieldPath, "expectedJudgeVerdict"),
      EXPECTED_JUDGE_VERDICTS
    ) as RunIntegrityExpectedJudgeVerdict,
    judgeVerdictMatchesExpected: requiredBoolean(
      ctx,
      requiredField(ctx, obj, "judgeVerdictMatchesExpected", joinFieldPath(fieldPath, "judgeVerdictMatchesExpected")),
      joinFieldPath(fieldPath, "judgeVerdictMatchesExpected")
    ),
    judgeVerdictAccepted: requiredBoolean(
      ctx,
      requiredField(ctx, obj, "judgeVerdictAccepted", joinFieldPath(fieldPath, "judgeVerdictAccepted")),
      joinFieldPath(fieldPath, "judgeVerdictAccepted")
    ),
    correctionRequired: requiredBoolean(
      ctx,
      requiredField(ctx, obj, "correctionRequired", joinFieldPath(fieldPath, "correctionRequired")),
      joinFieldPath(fieldPath, "correctionRequired")
    ),
    correctionBlocked: requiredBoolean(
      ctx,
      requiredField(ctx, obj, "correctionBlocked", joinFieldPath(fieldPath, "correctionBlocked")),
      joinFieldPath(fieldPath, "correctionBlocked")
    ),
    acceptedCorrectionStage: requiredNullableString(
      ctx,
      requiredField(ctx, obj, "acceptedCorrectionStage", joinFieldPath(fieldPath, "acceptedCorrectionStage")),
      joinFieldPath(fieldPath, "acceptedCorrectionStage")
    ),
    finalReportEligible: requiredBoolean(
      ctx,
      requiredField(ctx, obj, "finalReportEligible", joinFieldPath(fieldPath, "finalReportEligible")),
      joinFieldPath(fieldPath, "finalReportEligible")
    ),
    blockingCodes: requiredStringArray(
      ctx,
      requiredField(ctx, obj, "blockingCodes", joinFieldPath(fieldPath, "blockingCodes")),
      joinFieldPath(fieldPath, "blockingCodes")
    ),
    acceptedCorrectionRoute: (() => {
      const routeValue = requiredField(ctx, obj, "acceptedCorrectionRoute", joinFieldPath(fieldPath, "acceptedCorrectionRoute"));
      return routeValue === null ? null : validateCorrectionRouteResult(ctx, routeValue, joinFieldPath(fieldPath, "acceptedCorrectionRoute"));
    })()
  };
  if (optionalField(obj, "primaryReason") !== undefined) {
    result.primaryReason = optionalString(ctx, obj.primaryReason, joinFieldPath(fieldPath, "primaryReason"));
  }
  return result;
}

function validateFinalReportEligibility(ctx: FieldContext, value: JsonValue, fieldPath: string): OrchestratorFinalReportEligibilityV1 {
  const obj = requiredObject(ctx, value, fieldPath);
  const result: OrchestratorFinalReportEligibilityV1 = {
    eligible: requiredBoolean(ctx, requiredField(ctx, obj, "eligible", joinFieldPath(fieldPath, "eligible")), joinFieldPath(fieldPath, "eligible")),
    contextReady: requiredBoolean(
      ctx,
      requiredField(ctx, obj, "contextReady", joinFieldPath(fieldPath, "contextReady")),
      joinFieldPath(fieldPath, "contextReady")
    ),
    priorArtifactsValid: requiredBoolean(
      ctx,
      requiredField(ctx, obj, "priorArtifactsValid", joinFieldPath(fieldPath, "priorArtifactsValid")),
      joinFieldPath(fieldPath, "priorArtifactsValid")
    ),
    judgeIntegrity: validateJudgeIntegrity(
      ctx,
      requiredField(ctx, obj, "judgeIntegrity", joinFieldPath(fieldPath, "judgeIntegrity")),
      joinFieldPath(fieldPath, "judgeIntegrity")
    ),
    blockingCodes: requiredStringArray(
      ctx,
      requiredField(ctx, obj, "blockingCodes", joinFieldPath(fieldPath, "blockingCodes")),
      joinFieldPath(fieldPath, "blockingCodes")
    )
  };
  if (optionalField(obj, "primaryReason") !== undefined) {
    result.primaryReason = optionalString(ctx, obj.primaryReason, joinFieldPath(fieldPath, "primaryReason"));
  }
  return result;
}

function validateArtifactStateRecord(ctx: FieldContext, value: JsonValue, fieldPath: string): OrchestratorArtifactStateRecordV1 {
  const obj = requiredObject(ctx, value, fieldPath);
  const result: OrchestratorArtifactStateRecordV1 = {
    state: requiredLiteral(
      ctx,
      requiredField(ctx, obj, "state", joinFieldPath(fieldPath, "state")),
      joinFieldPath(fieldPath, "state"),
      MANUAL_ARTIFACT_LIFECYCLE_STATES
    ) as ManualArtifactLifecycleState,
    updatedAt: requiredString(ctx, requiredField(ctx, obj, "updatedAt", joinFieldPath(fieldPath, "updatedAt")), joinFieldPath(fieldPath, "updatedAt"))
  };
  if (optionalField(obj, "reason") !== undefined) result.reason = optionalString(ctx, obj.reason, joinFieldPath(fieldPath, "reason"));
  if (optionalField(obj, "source") !== undefined) result.source = optionalString(ctx, obj.source, joinFieldPath(fieldPath, "source"));
  return result;
}

function validateLifecycleEntry(ctx: FieldContext, value: JsonValue, fieldPath: string): OrchestratorArtifactLifecycleEntryV1 {
  const obj = requiredObject(ctx, value, fieldPath);
  const manualRecordValue = requiredField(ctx, obj, "manualRecord", joinFieldPath(fieldPath, "manualRecord"));
  const result: OrchestratorArtifactLifecycleEntryV1 = {
    artifactFile: requiredString(
      ctx,
      requiredField(ctx, obj, "artifactFile", joinFieldPath(fieldPath, "artifactFile")),
      joinFieldPath(fieldPath, "artifactFile")
    ),
    stageName: requiredString(ctx, requiredField(ctx, obj, "stageName", joinFieldPath(fieldPath, "stageName")), joinFieldPath(fieldPath, "stageName")),
    fileExists: requiredBoolean(
      ctx,
      requiredField(ctx, obj, "fileExists", joinFieldPath(fieldPath, "fileExists")),
      joinFieldPath(fieldPath, "fileExists")
    ),
    manualRecord: manualRecordValue === null ? null : validateArtifactStateRecord(ctx, manualRecordValue, joinFieldPath(fieldPath, "manualRecord")),
    resolvedState: requiredLiteral(
      ctx,
      requiredField(ctx, obj, "resolvedState", joinFieldPath(fieldPath, "resolvedState")),
      joinFieldPath(fieldPath, "resolvedState"),
      ARTIFACT_LIFECYCLE_STATES
    ) as ArtifactLifecycleState
  };
  if (optionalField(obj, "blockingReason") !== undefined) {
    result.blockingReason = optionalString(ctx, obj.blockingReason, joinFieldPath(fieldPath, "blockingReason"));
  }
  return result;
}

export function validateOrchestratorRunIntegrityEvidenceV1(
  value: JsonObject,
  sourcePath: string
): UpstreamArtifactReadResult<OrchestratorRunIntegrityEvidenceV1> {
  const ctx: FieldContext = { artifactKind: ARTIFACT_KIND, sourcePath };
  try {
    const schemaVersionResult = parseSupportedMajorOneSchemaVersion(
      requiredField(ctx, value, "schemaVersion", "schemaVersion"),
      ARTIFACT_KIND,
      sourcePath
    );
    if ("ok" in schemaVersionResult) return schemaVersionResult;

    const evidence: OrchestratorRunIntegrityEvidenceV1 = {
      schemaVersion: requiredString(ctx, value.schemaVersion, "schemaVersion") as "1.0.0",
      runFolder: requiredString(ctx, requiredField(ctx, value, "runFolder", "runFolder"), "runFolder"),
      gate: validateGate(ctx, requiredField(ctx, value, "gate", "gate"), "gate"),
      lifecycle: requiredArray(ctx, requiredField(ctx, value, "lifecycle", "lifecycle"), "lifecycle").map((item, i) =>
        validateLifecycleEntry(ctx, item, arrayFieldPath("lifecycle", i))
      )
    };
    if (optionalField(value, "judgeIntegrity") !== undefined) {
      evidence.judgeIntegrity = validateJudgeIntegrity(ctx, value.judgeIntegrity, "judgeIntegrity");
    }
    if (optionalField(value, "finalReportEligibility") !== undefined) {
      evidence.finalReportEligibility = validateFinalReportEligibility(ctx, value.finalReportEligibility, "finalReportEligibility");
    }
    if (optionalField(value, "finalArtifactPresent") !== undefined) {
      evidence.finalArtifactPresent = requiredBoolean(ctx, value.finalArtifactPresent, "finalArtifactPresent");
    }
    if (optionalField(value, "finalArtifactVerdict") !== undefined) {
      evidence.finalArtifactVerdict = requiredNullableLiteral(ctx, value.finalArtifactVerdict, "finalArtifactVerdict", JUDGE_VERDICTS) as
        | JudgeVerdict
        | null;
    }

    // Per the exact-mirror contract, the returned artifact is always the original parsed
    // reference, not a rebuilt object. The construction above exists only to walk and
    // type-check every field.
    void evidence;

    return {
      ok: true,
      artifactKind: ARTIFACT_KIND,
      sourcePath,
      schemaVersion: value.schemaVersion as string,
      schemaMajor: 1,
      artifact: value as unknown as OrchestratorRunIntegrityEvidenceV1,
      rawArtifact: value
    };
  } catch (error) {
    if (error instanceof ArtifactValidationError) return error.failure;
    throw error;
  }
}
