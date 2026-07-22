export interface EnumCase {
  fieldPath: string;
  invalidValue: string;
}

type PathSegment = string | number;

function parsePath(path: string): PathSegment[] {
  const segments: PathSegment[] = [];
  for (const rawSegment of path.split(".")) {
    const match = /^([^[]+)((?:\[\d+])*)$/.exec(rawSegment);
    if (!match) {
      segments.push(rawSegment);
      continue;
    }
    segments.push(match[1]);
    const indices = match[2].match(/\d+/g) ?? [];
    for (const index of indices) segments.push(Number(index));
  }
  return segments;
}

function deepClone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

export function deleteFieldAtPath<T>(fixture: T, path: string): T {
  const clone = deepClone(fixture) as Record<string, unknown>;
  const segments = parsePath(path);
  let cursor: unknown = clone;
  for (let i = 0; i < segments.length - 1; i++) {
    cursor = (cursor as Record<PathSegment, unknown>)[segments[i]];
  }
  const last = segments[segments.length - 1];
  if (Array.isArray(cursor)) {
    (cursor as unknown[]).splice(last as number, 1);
  } else {
    delete (cursor as Record<PathSegment, unknown>)[last];
  }
  return clone as T;
}

export function setFieldAtPath<T>(fixture: T, path: string, value: unknown): T {
  const clone = deepClone(fixture) as Record<string, unknown>;
  const segments = parsePath(path);
  let cursor: unknown = clone;
  for (let i = 0; i < segments.length - 1; i++) {
    cursor = (cursor as Record<PathSegment, unknown>)[segments[i]];
  }
  (cursor as Record<PathSegment, unknown>)[segments[segments.length - 1]] = value;
  return clone as T;
}

export const CONTEXT_CAPSULE_REQUIRED_FIELD_PATHS: string[] = [
  "schemaVersion",
  "generatedAt",
  "tool",
  "tool.name",
  "tool.version",
  "request",
  "request.originalQuery",
  "request.mode",
  "request.requestedOutputPath",
  "request.role",
  "request.requestFilePath",
  "index",
  "index.indexPath",
  "index.manifestPath",
  "index.artifactRefs",
  "limits",
  "limits.maxCandidateFiles",
  "requiredContext",
  "requiredContext[0].id",
  "requiredContext[0].kind",
  "requiredContext[0].evidenceRefs",
  "requiredContext[0].warnings",
  "optionalSupportContext",
  "droppedContext",
  "warnings",
  "contextAdequacy",
  "contextAdequacy.status",
  "contextAdequacy.gaps",
  "queryPlan",
  "queryPlan.terms",
  "queryPlan.terms.raw",
  "candidateFiles",
  "candidateFiles[0].path",
  "candidateFiles[0].score",
  "candidateFiles[0].retained",
  "candidateNodes",
  "candidateNodes[0].nodeId",
  "candidateNodes[0].kind",
  "focus",
  "focus.focusNodeId",
  "focus.selectionMode",
  "focus.confidence",
  "selectedGraph",
  "selectedGraph.nodes",
  "selectedGraph.omittedNodeCount",
  "retention",
  "retention.capSettings",
  "selectedSource",
  "selectedSource.slices",
  "selectedSource.slices[0].sourceRetrievalMethod",
  "selectedSourceBundles",
  "semanticSummary",
  "semanticSummary.summariesByNode",
  "classificationSummary",
  "classificationSummary.classificationArtifactPath",
  "artifactReferenceSummary",
  "pruning",
  "pruning.policyVersion",
  "conflicts",
  "conflicts.status",
  "modeEffects",
  "sourceControl",
  "deferredRequestFields",
  "roleContext",
  "roleContext.role",
  "roleContext.changedSurface",
  "roleContext.changedSurface.files",
  "evidenceGroups",
  "evidenceGroups[0].kind",
  "evidenceGroups[0].limit",
  "selectedOwners",
  "selectedContracts",
  "selectedTests",
  "testInfrastructure",
  "testInfrastructure.testCommands[0].commandText",
  "unresolvedItems",
  "groupTruncation",
  "responsibilityMappings",
  "responsibilityMappings.mappings[0].mappingStatus",
  "roleAdequacy",
  "roleAdequacy.status",
  "freshness",
  "freshness.state",
  "freshness.comparedIdentities",
  "budget",
  "budget.limits",
  "truncation",
  "truncation.records",
  "fullFileFallback",
  "fullFileFallback.used",
  "provenance",
  "provenance[0].category"
];

export const CONTEXT_CAPSULE_OPTIONAL_FIELD_PATHS: string[] = [
  "index.manifestSchemaVersion",
  "index.projectRoot",
  "requiredContext[0].classificationRefs",
  "requiredContext[0].classificationRoles",
  "candidateFiles[0].baseScore",
  "candidateFiles[0].modeAdjustment",
  "candidateFiles[0].semanticRoles",
  "candidateFiles[0].droppedReason",
  "candidateNodes[0].filePath",
  "candidateNodes[0].androidMetadata",
  "selectedSource.slices[0].nodeId",
  "selectedSource.slices[0].continuationAvailable",
  "selectedSourceBundles.bundles[0].focusNodeId",
  "testInfrastructure.testCommands[1].unresolvedReason"
];

export const CONTEXT_CAPSULE_NULLABLE_FIELD_PATHS: string[] = [
  "request.role",
  "request.requestFilePath",
  "limits.maxCandidateFiles",
  "focus.focusNodeId",
  "focus.focusFilePath",
  "classificationSummary.classificationArtifactPath",
  "freshness.comparedIdentities[1].value",
  "budget.limits[0].declaredValue",
  "budget.characters",
  "responsibilityMappings.mappings[0].invariant",
  "provenance[0].sourcePath"
];

export const CONTEXT_CAPSULE_ENUM_CASES: EnumCase[] = [
  { fieldPath: "request.mode", invalidValue: "not-a-real-mode" },
  { fieldPath: "request.role", invalidValue: "not-a-real-role" },
  { fieldPath: "requiredContext[0].kind", invalidValue: "not-a-real-entry-kind" },
  { fieldPath: "contextAdequacy.status", invalidValue: "not-a-real-status" },
  { fieldPath: "focus.selectionMode", invalidValue: "not-a-real-selection-mode" },
  { fieldPath: "focus.confidence", invalidValue: "not-a-real-confidence" },
  { fieldPath: "candidateFiles[0].changedStatus", invalidValue: "not-a-real-changed-status" },
  { fieldPath: "selectedSource.slices[0].sourceRetrievalMethod", invalidValue: "not-a-real-method" },
  { fieldPath: "conflicts.status", invalidValue: "not-a-real-conflict-status" },
  { fieldPath: "freshness.state", invalidValue: "not-a-real-freshness-state" },
  { fieldPath: "evidenceGroups[0].kind", invalidValue: "not-a-real-evidence-group-kind" },
  { fieldPath: "responsibilityMappings.mappings[0].mappingStatus", invalidValue: "not-a-real-mapping-status" },
  { fieldPath: "responsibilityMappings.mappings[0].criticality", invalidValue: "not-a-real-criticality" }
];

export const RETRIEVAL_AUDIT_RECORD_REQUIRED_FIELD_PATHS: string[] = [
  "schemaVersion",
  "generatedAt",
  "tool",
  "tool.name",
  "request",
  "request.mode",
  "index",
  "index.indexPath",
  "index.manifestPath",
  "steps",
  "steps[0].id",
  "steps[0].kind",
  "steps[0].inputs",
  "steps[0].outputs",
  "steps[0].status",
  "fallbacks",
  "fullFileReadRecommendations",
  "fullFileReadRecommendations[0].filePath",
  "fullFileReadRecommendations[0].continuationOrExpansionAttempted",
  "warnings",
  "contextAdequacy",
  "contextAdequacy.status",
  "roleContext",
  "roleContext.role",
  "responsibilityMappings",
  "roleAdequacy",
  "freshness",
  "freshness.state",
  "budget",
  "truncation",
  "fullFileFallback",
  "provenance",
  "provenance[0].category"
];

export const RETRIEVAL_AUDIT_RECORD_NULLABLE_FIELD_PATHS: string[] = [
  "request.role",
  "request.requestFilePath",
  "freshness.comparedIdentities[1].value",
  "budget.characters",
  "provenance[0].sourcePath"
];

export const RETRIEVAL_AUDIT_RECORD_ENUM_CASES: EnumCase[] = [
  { fieldPath: "request.mode", invalidValue: "not-a-real-mode" },
  { fieldPath: "steps[0].status", invalidValue: "not-a-real-status" },
  { fieldPath: "contextAdequacy.status", invalidValue: "not-a-real-status" },
  { fieldPath: "freshness.state", invalidValue: "not-a-real-freshness-state" }
];

export const WORKFLOW_INSTRUCTION_PACKET_REQUIRED_FIELD_PATHS: string[] = [
  "schemaVersion",
  "catalogSchemaVersion",
  "catalogVersion",
  "workflowId",
  "stageId",
  "primaryEntry",
  "primaryEntry.id",
  "primaryEntry.kind",
  "primaryEntry.commandRefs",
  "resolvedCommands",
  "resolvedCommands[0].id",
  "resolvedCommands[0].kind",
  "resolvedCommands[0].sideEffect",
  "resolvedCommands[0].included",
  "resolvedRules",
  "resolvedRules[0].id",
  "resolvedRules[0].kind",
  "resolvedRules[0].included",
  "resolvedRules[0].depth",
  "reportContract",
  "reportContract.id",
  "reportContract.kind",
  "validationRequirements",
  "stopConditions",
  "resolutionProvenance",
  "resolutionProvenance[0].depth",
  "budget",
  "budget.findings",
  "budget.perEntryCharacters",
  "truncation",
  "truncation.records",
  "adequacy",
  "adequacy.status",
  "unresolvedReferences",
  "warnings"
];

export const WORKFLOW_INSTRUCTION_PACKET_NULLABLE_FIELD_PATHS: string[] = [
  "budget.findings[0].declaredLimit",
  "budget.findings[1].available",
  "truncation.records[0].declaredLimit"
];

export const WORKFLOW_INSTRUCTION_PACKET_ENUM_CASES: EnumCase[] = [
  { fieldPath: "primaryEntry.kind", invalidValue: "not-a-real-kind" },
  { fieldPath: "reportContract.kind", invalidValue: "not-a-real-kind" },
  { fieldPath: "resolvedCommands[0].kind", invalidValue: "not-a-real-kind" },
  { fieldPath: "resolvedCommands[0].sideEffect", invalidValue: "not-a-real-side-effect" },
  { fieldPath: "resolvedCommands[0].included", invalidValue: "not-a-real-inclusion" },
  { fieldPath: "resolvedRules[0].kind", invalidValue: "not-a-real-kind" },
  { fieldPath: "resolvedRules[0].included", invalidValue: "not-a-real-inclusion" },
  { fieldPath: "adequacy.status", invalidValue: "not-a-real-adequacy-status" },
  { fieldPath: "budget.findings[0].limitName", invalidValue: "not-a-real-limit-name" },
  { fieldPath: "truncation.records[0].limitingField", invalidValue: "not-a-real-limit-name" }
];
