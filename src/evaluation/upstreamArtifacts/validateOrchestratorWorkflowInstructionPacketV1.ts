import type { JsonObject, JsonValue } from "./jsonTypes.js";
import type { UpstreamArtifactReadResult } from "./artifactReadTypes.js";
import { parseSupportedMajorOneSchemaVersion } from "./schemaVersion.js";
import {
  ArtifactValidationError,
  arrayFieldPath,
  joinFieldPath,
  requiredArray,
  requiredBoolean,
  requiredField,
  requiredLiteral,
  requiredNullableNumber,
  requiredNumber,
  requiredObject,
  requiredRecord,
  requiredString,
  requiredStringArray,
  type FieldContext
} from "./runtimeValidation.js";
import type {
  BudgetFinding,
  CommandSideEffect,
  InstructionBudgetAccounting,
  InstructionBudgetLimits,
  PacketAdequacy,
  PacketPrimaryEntry,
  PacketTruncation,
  ReportContractCatalogEntry,
  ResolutionProvenanceEntry,
  ResolvedCommandEntry,
  ResolvedRuleEntry,
  TruncationRecord,
  WorkflowInstructionPacket
} from "./orchestratorWorkflowInstructionPacketV1.js";

const ARTIFACT_KIND = "orchestrator-workflow-instruction-packet-v1" as const;

const COMMAND_SIDE_EFFECTS = ["read-only", "writes-workspace", "modifies-project", "external-state"] as const;
const PACKET_INCLUSIONS = ["required", "optional"] as const;
const PACKET_ADEQUACY_STATUSES = ["adequate", "inadequate"] as const;
const BUDGET_LIMIT_NAMES = ["maxCommands", "maxRules", "maxRuleDepth", "maxEntryCharacters", "maxTotalCharacters"] as const;

function validatePrimaryEntry(ctx: FieldContext, value: JsonValue, fieldPath: string): PacketPrimaryEntry {
  const obj = requiredObject(ctx, value, fieldPath);
  const req = (key: string): JsonValue => requiredField(ctx, obj, key, joinFieldPath(fieldPath, key));
  const reqStr = (key: string): string => requiredString(ctx, req(key), joinFieldPath(fieldPath, key));
  const reqStrArr = (key: string): string[] => requiredStringArray(ctx, req(key), joinFieldPath(fieldPath, key));
  return {
    id: reqStr("id"),
    kind: requiredLiteral(ctx, req("kind"), joinFieldPath(fieldPath, "kind"), ["stage"] as const),
    title: reqStr("title"),
    description: reqStr("description"),
    workflowRef: reqStr("workflowRef"),
    stageName: reqStr("stageName"),
    commandRefs: reqStrArr("commandRefs"),
    ruleRefs: reqStrArr("ruleRefs"),
    optionalCommandRefs: reqStrArr("optionalCommandRefs"),
    optionalRuleRefs: reqStrArr("optionalRuleRefs"),
    reportContractRef: reqStr("reportContractRef"),
    taskInstructions: reqStr("taskInstructions"),
    validationRequirements: reqStrArr("validationRequirements"),
    stopConditions: reqStrArr("stopConditions")
  };
}

function validateResolvedCommandEntry(ctx: FieldContext, value: JsonValue, fieldPath: string): ResolvedCommandEntry {
  const obj = requiredObject(ctx, value, fieldPath);
  const req = (key: string): JsonValue => requiredField(ctx, obj, key, joinFieldPath(fieldPath, key));
  const reqStr = (key: string): string => requiredString(ctx, req(key), joinFieldPath(fieldPath, key));
  return {
    id: reqStr("id") as ResolvedCommandEntry["id"],
    kind: requiredLiteral(ctx, req("kind"), joinFieldPath(fieldPath, "kind"), ["command"] as const),
    title: reqStr("title"),
    description: reqStr("description"),
    owner: reqStr("owner"),
    command: reqStr("command"),
    purpose: reqStr("purpose"),
    sideEffect: requiredLiteral(
      ctx,
      req("sideEffect"),
      joinFieldPath(fieldPath, "sideEffect"),
      COMMAND_SIDE_EFFECTS
    ) as CommandSideEffect,
    included: requiredLiteral(ctx, req("included"), joinFieldPath(fieldPath, "included"), PACKET_INCLUSIONS)
  };
}

function validateResolvedRuleEntry(ctx: FieldContext, value: JsonValue, fieldPath: string): ResolvedRuleEntry {
  const obj = requiredObject(ctx, value, fieldPath);
  const req = (key: string): JsonValue => requiredField(ctx, obj, key, joinFieldPath(fieldPath, key));
  const reqStr = (key: string): string => requiredString(ctx, req(key), joinFieldPath(fieldPath, key));
  return {
    id: reqStr("id") as ResolvedRuleEntry["id"],
    kind: requiredLiteral(ctx, req("kind"), joinFieldPath(fieldPath, "kind"), ["rule"] as const),
    title: reqStr("title"),
    description: reqStr("description"),
    category: reqStr("category"),
    instruction: reqStr("instruction"),
    ruleRefs: requiredStringArray(ctx, req("ruleRefs"), joinFieldPath(fieldPath, "ruleRefs")) as ResolvedRuleEntry["ruleRefs"],
    included: requiredLiteral(ctx, req("included"), joinFieldPath(fieldPath, "included"), PACKET_INCLUSIONS),
    depth: requiredNumber(ctx, req("depth"), joinFieldPath(fieldPath, "depth"))
  };
}

function validateReportContract(ctx: FieldContext, value: JsonValue, fieldPath: string): ReportContractCatalogEntry {
  const obj = requiredObject(ctx, value, fieldPath);
  const req = (key: string): JsonValue => requiredField(ctx, obj, key, joinFieldPath(fieldPath, key));
  const reqStr = (key: string): string => requiredString(ctx, req(key), joinFieldPath(fieldPath, key));
  return {
    id: reqStr("id") as ReportContractCatalogEntry["id"],
    kind: requiredLiteral(ctx, req("kind"), joinFieldPath(fieldPath, "kind"), ["report-contract"] as const),
    title: reqStr("title"),
    description: reqStr("description"),
    artifactKind: reqStr("artifactKind"),
    purpose: reqStr("purpose"),
    requiredOutputCategory: reqStr("requiredOutputCategory")
  };
}

function validateResolutionProvenanceEntry(ctx: FieldContext, value: JsonValue, fieldPath: string): ResolutionProvenanceEntry {
  const obj = requiredObject(ctx, value, fieldPath);
  const req = (key: string): JsonValue => requiredField(ctx, obj, key, joinFieldPath(fieldPath, key));
  const reqStr = (key: string): string => requiredString(ctx, req(key), joinFieldPath(fieldPath, key));
  return {
    rootWorkflowId: reqStr("rootWorkflowId") as ResolutionProvenanceEntry["rootWorkflowId"],
    rootStageId: reqStr("rootStageId") as ResolutionProvenanceEntry["rootStageId"],
    sourceEntryId: reqStr("sourceEntryId"),
    referenceField: reqStr("referenceField"),
    referencedEntryId: reqStr("referencedEntryId"),
    inclusionReason: reqStr("inclusionReason"),
    depth: requiredNumber(ctx, req("depth"), joinFieldPath(fieldPath, "depth"))
  };
}

function validateBudgetFinding(ctx: FieldContext, value: JsonValue, fieldPath: string): BudgetFinding {
  const obj = requiredObject(ctx, value, fieldPath);
  const req = (key: string): JsonValue => requiredField(ctx, obj, key, joinFieldPath(fieldPath, key));
  return {
    limitName: requiredLiteral(
      ctx,
      req("limitName"),
      joinFieldPath(fieldPath, "limitName"),
      BUDGET_LIMIT_NAMES
    ) as keyof InstructionBudgetLimits,
    declaredLimit: requiredNullableNumber(ctx, req("declaredLimit"), joinFieldPath(fieldPath, "declaredLimit")),
    used: requiredNumber(ctx, req("used"), joinFieldPath(fieldPath, "used")),
    available: requiredNullableNumber(ctx, req("available"), joinFieldPath(fieldPath, "available")),
    overLimit: requiredBoolean(ctx, req("overLimit"), joinFieldPath(fieldPath, "overLimit")),
    amountExceeded: requiredNumber(ctx, req("amountExceeded"), joinFieldPath(fieldPath, "amountExceeded")),
    affectedEntryIds: requiredStringArray(ctx, req("affectedEntryIds"), joinFieldPath(fieldPath, "affectedEntryIds"))
  };
}

function validateInstructionBudgetAccounting(ctx: FieldContext, value: JsonValue, fieldPath: string): InstructionBudgetAccounting {
  const obj = requiredObject(ctx, value, fieldPath);
  const req = (key: string): JsonValue => requiredField(ctx, obj, key, joinFieldPath(fieldPath, key));
  const perEntryObj = requiredRecord(ctx, req("perEntryCharacters"), joinFieldPath(fieldPath, "perEntryCharacters"));
  const perEntryCharacters: Record<string, number> = {};
  for (const [key, val] of Object.entries(perEntryObj)) {
    perEntryCharacters[key] = requiredNumber(ctx, val, joinFieldPath(joinFieldPath(fieldPath, "perEntryCharacters"), key));
  }
  return {
    findings: requiredArray(ctx, req("findings"), joinFieldPath(fieldPath, "findings")).map((item, i) =>
      validateBudgetFinding(ctx, item, arrayFieldPath(joinFieldPath(fieldPath, "findings"), i))
    ),
    overLimit: requiredBoolean(ctx, req("overLimit"), joinFieldPath(fieldPath, "overLimit")),
    adequate: requiredBoolean(ctx, req("adequate"), joinFieldPath(fieldPath, "adequate")),
    totalCharacters: requiredNumber(ctx, req("totalCharacters"), joinFieldPath(fieldPath, "totalCharacters")),
    perEntryCharacters
  };
}

function validateTruncationRecord(ctx: FieldContext, value: JsonValue, fieldPath: string): TruncationRecord {
  const obj = requiredObject(ctx, value, fieldPath);
  const req = (key: string): JsonValue => requiredField(ctx, obj, key, joinFieldPath(fieldPath, key));
  return {
    rootOptionalEntryId: requiredString(ctx, req("rootOptionalEntryId"), joinFieldPath(fieldPath, "rootOptionalEntryId")),
    affectedEntryIds: requiredStringArray(ctx, req("affectedEntryIds"), joinFieldPath(fieldPath, "affectedEntryIds")),
    limitingField: requiredLiteral(
      ctx,
      req("limitingField"),
      joinFieldPath(fieldPath, "limitingField"),
      BUDGET_LIMIT_NAMES
    ) as keyof InstructionBudgetLimits,
    declaredLimit: requiredNullableNumber(ctx, req("declaredLimit"), joinFieldPath(fieldPath, "declaredLimit")),
    usedBefore: requiredNumber(ctx, req("usedBefore"), joinFieldPath(fieldPath, "usedBefore")),
    attemptedAfter: requiredNumber(ctx, req("attemptedAfter"), joinFieldPath(fieldPath, "attemptedAfter")),
    reason: requiredString(ctx, req("reason"), joinFieldPath(fieldPath, "reason"))
  };
}

function validatePacketTruncation(ctx: FieldContext, value: JsonValue, fieldPath: string): PacketTruncation {
  const obj = requiredObject(ctx, value, fieldPath);
  const req = (key: string): JsonValue => requiredField(ctx, obj, key, joinFieldPath(fieldPath, key));
  return {
    truncated: requiredBoolean(ctx, req("truncated"), joinFieldPath(fieldPath, "truncated")),
    records: requiredArray(ctx, req("records"), joinFieldPath(fieldPath, "records")).map((item, i) =>
      validateTruncationRecord(ctx, item, arrayFieldPath(joinFieldPath(fieldPath, "records"), i))
    ),
    droppedOptionalCommandIds: requiredStringArray(
      ctx,
      req("droppedOptionalCommandIds"),
      joinFieldPath(fieldPath, "droppedOptionalCommandIds")
    ),
    droppedOptionalRuleIds: requiredStringArray(ctx, req("droppedOptionalRuleIds"), joinFieldPath(fieldPath, "droppedOptionalRuleIds")),
    droppedOptionalDependencyIds: requiredStringArray(
      ctx,
      req("droppedOptionalDependencyIds"),
      joinFieldPath(fieldPath, "droppedOptionalDependencyIds")
    ),
    warnings: requiredStringArray(ctx, req("warnings"), joinFieldPath(fieldPath, "warnings"))
  };
}

function validatePacketAdequacy(ctx: FieldContext, value: JsonValue, fieldPath: string): PacketAdequacy {
  const obj = requiredObject(ctx, value, fieldPath);
  const req = (key: string): JsonValue => requiredField(ctx, obj, key, joinFieldPath(fieldPath, key));
  return {
    status: requiredLiteral(ctx, req("status"), joinFieldPath(fieldPath, "status"), PACKET_ADEQUACY_STATUSES),
    reasons: requiredStringArray(ctx, req("reasons"), joinFieldPath(fieldPath, "reasons")),
    requiredContentComplete: requiredBoolean(ctx, req("requiredContentComplete"), joinFieldPath(fieldPath, "requiredContentComplete")),
    requiredBudgetSatisfied: requiredBoolean(ctx, req("requiredBudgetSatisfied"), joinFieldPath(fieldPath, "requiredBudgetSatisfied")),
    optionalContentDropped: requiredBoolean(ctx, req("optionalContentDropped"), joinFieldPath(fieldPath, "optionalContentDropped")),
    affectedEntryIds: requiredStringArray(ctx, req("affectedEntryIds"), joinFieldPath(fieldPath, "affectedEntryIds"))
  };
}

function findDuplicates(ids: string[]): string[] {
  const seen = new Set<string>();
  const dupes = new Set<string>();
  for (const id of ids) {
    if (seen.has(id)) dupes.add(id);
    seen.add(id);
  }
  return [...dupes];
}

export function validateOrchestratorWorkflowInstructionPacketV1(
  value: JsonObject,
  sourcePath: string
): UpstreamArtifactReadResult<WorkflowInstructionPacket> {
  const ctx: FieldContext = { artifactKind: ARTIFACT_KIND, sourcePath };
  try {
    const schemaVersionResult = parseSupportedMajorOneSchemaVersion(
      requiredField(ctx, value, "schemaVersion", "schemaVersion"),
      ARTIFACT_KIND,
      sourcePath
    );
    if ("ok" in schemaVersionResult) return schemaVersionResult;

    const resolvedCommands = requiredArray(ctx, requiredField(ctx, value, "resolvedCommands", "resolvedCommands"), "resolvedCommands").map(
      (item, i) => validateResolvedCommandEntry(ctx, item, arrayFieldPath("resolvedCommands", i))
    );
    const dupCommandIds = findDuplicates(resolvedCommands.map((c) => c.id));
    if (dupCommandIds.length > 0) {
      return {
        ok: false,
        artifactKind: ARTIFACT_KIND,
        sourcePath,
        code: "DUPLICATE_RESOLVED_COMMAND_ID",
        message: `Artifact "${ARTIFACT_KIND}" at "${sourcePath}" has duplicate resolvedCommands[].id value(s): ${dupCommandIds.join(", ")}.`,
        fieldPath: "resolvedCommands",
        actual: dupCommandIds
      };
    }

    const resolvedRules = requiredArray(ctx, requiredField(ctx, value, "resolvedRules", "resolvedRules"), "resolvedRules").map((item, i) =>
      validateResolvedRuleEntry(ctx, item, arrayFieldPath("resolvedRules", i))
    );
    const dupRuleIds = findDuplicates(resolvedRules.map((r) => r.id));
    if (dupRuleIds.length > 0) {
      return {
        ok: false,
        artifactKind: ARTIFACT_KIND,
        sourcePath,
        code: "DUPLICATE_RESOLVED_RULE_ID",
        message: `Artifact "${ARTIFACT_KIND}" at "${sourcePath}" has duplicate resolvedRules[].id value(s): ${dupRuleIds.join(", ")}.`,
        fieldPath: "resolvedRules",
        actual: dupRuleIds
      };
    }

    const packet: WorkflowInstructionPacket = {
      schemaVersion: requiredString(ctx, value.schemaVersion, "schemaVersion"),
      catalogSchemaVersion: requiredString(
        ctx,
        requiredField(ctx, value, "catalogSchemaVersion", "catalogSchemaVersion"),
        "catalogSchemaVersion"
      ),
      catalogVersion: requiredString(ctx, requiredField(ctx, value, "catalogVersion", "catalogVersion"), "catalogVersion"),
      workflowId: requiredString(ctx, requiredField(ctx, value, "workflowId", "workflowId"), "workflowId"),
      stageId: requiredString(ctx, requiredField(ctx, value, "stageId", "stageId"), "stageId"),
      primaryEntry: validatePrimaryEntry(ctx, requiredField(ctx, value, "primaryEntry", "primaryEntry"), "primaryEntry"),
      resolvedCommands,
      resolvedRules,
      reportContract: validateReportContract(ctx, requiredField(ctx, value, "reportContract", "reportContract"), "reportContract"),
      validationRequirements: requiredStringArray(
        ctx,
        requiredField(ctx, value, "validationRequirements", "validationRequirements"),
        "validationRequirements"
      ),
      stopConditions: requiredStringArray(ctx, requiredField(ctx, value, "stopConditions", "stopConditions"), "stopConditions"),
      resolutionProvenance: requiredArray(
        ctx,
        requiredField(ctx, value, "resolutionProvenance", "resolutionProvenance"),
        "resolutionProvenance"
      ).map((item, i) => validateResolutionProvenanceEntry(ctx, item, arrayFieldPath("resolutionProvenance", i))),
      budget: validateInstructionBudgetAccounting(ctx, requiredField(ctx, value, "budget", "budget"), "budget"),
      truncation: validatePacketTruncation(ctx, requiredField(ctx, value, "truncation", "truncation"), "truncation"),
      adequacy: validatePacketAdequacy(ctx, requiredField(ctx, value, "adequacy", "adequacy"), "adequacy"),
      unresolvedReferences: requiredStringArray(
        ctx,
        requiredField(ctx, value, "unresolvedReferences", "unresolvedReferences"),
        "unresolvedReferences"
      ),
      warnings: requiredStringArray(ctx, requiredField(ctx, value, "warnings", "warnings"), "warnings")
    };

    // The record above exists only to walk and type-check every field. The returned
    // artifact is always the original parsed reference, never a rebuilt object.
    void packet;

    return {
      ok: true,
      artifactKind: ARTIFACT_KIND,
      sourcePath,
      schemaVersion: value.schemaVersion as string,
      schemaMajor: 1,
      artifact: value as unknown as WorkflowInstructionPacket,
      rawArtifact: value
    };
  } catch (error) {
    if (error instanceof ArtifactValidationError) return error.failure;
    throw error;
  }
}
