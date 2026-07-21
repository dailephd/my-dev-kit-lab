import type { JsonObject, JsonValue } from "./jsonTypes.js";
import type { UpstreamArtifactReadResult } from "./artifactReadTypes.js";
import { parseSupportedMajorOneSchemaVersion } from "./schemaVersion.js";
import {
  ArtifactValidationError,
  arrayFieldPath,
  joinFieldPath,
  makeFailure,
  optionalBoolean,
  optionalField,
  optionalLiteral,
  optionalNullableString,
  optionalNumber,
  optionalString,
  requiredArray,
  requiredBoolean,
  requiredField,
  requiredLiteral,
  requiredNonnegativeInteger,
  requiredNullableLiteral,
  requiredNullableNumber,
  requiredNullableString,
  requiredNumber,
  requiredObject,
  requiredRecord,
  requiredScalarLike,
  requiredScalarOrStringArrayLike,
  requiredString,
  requiredStringArray,
  type FieldContext
} from "./runtimeValidation.js";
import type {
  ArtifactReferenceSummaryEntry,
  BudgetCharacterUsage,
  BudgetLimitUsage,
  BudgetSummary,
  CandidateFile,
  CandidateNode,
  ChangedFileEntry,
  ChangedSurface,
  ChangedSymbolEntry,
  ClassificationSummary,
  ClassificationSummaryEntry,
  ContextAdequacyStatement,
  ContextAdequacyStatus,
  ContextCapsule,
  ContextCapsuleArtifactRef,
  ContextCapsuleIndex,
  ContextCapsuleLimits,
  ContextCapsuleMode,
  ContextConflict,
  ContextConflictCandidate,
  ContextConflictSummary,
  ContextEntry,
  ContextEntryEvidenceRef,
  ContextFocus,
  ContextFocusIntake,
  ContextRole,
  DroppedContextEntry,
  EvidenceGroup,
  EvidenceItemRef,
  EvidenceItemSourceLocation,
  FocusFileResolution,
  FocusSymbolResolution,
  FreshnessComparedIdentity,
  FreshnessSummary,
  FullFileFallbackRecord,
  FullFileFallbackSummary,
  GroupTruncationEntry,
  ModeEffect,
  ModeEffects,
  PackageScriptEvidenceEntry,
  ProvenanceRecord,
  PruningCapSettings,
  PruningCounts,
  PruningSummary,
  QueryPlan,
  QueryTerms,
  ResponsibilityMapping,
  ResponsibilityMappingSummary,
  RetentionCapSettings,
  RetentionSummary,
  RoleAdequacyStatement,
  RoleContextSummary,
  SelectedGraph,
  SelectedGraphEdge,
  SelectedGraphNode,
  SelectedSource,
  SelectedSourceBundle,
  SelectedSourceBundleBlock,
  SelectedSourceBundleSkippedBlock,
  SelectedSourceBundles,
  SelectedSourceSlice,
  SemanticSummary,
  SemanticSummaryEntry,
  SkippedSourceEntry,
  SourceControl,
  TestCommandEvidenceEntry,
  TestConfigurationEvidenceEntry,
  TestInfrastructureSummary,
  TruncationRecord,
  TruncationSummary,
  UnresolvedEvidenceItem
} from "./myDevKitContextArtifactsV1.js";
import type { ClassificationRole, ClassificationRoleRef, SourceRef } from "./myDevKitClassificationTypesV1.js";
import type { SemanticArtifactRef, SemanticEvidenceRef, SemanticRole, SemanticRoleWarning } from "./myDevKitSemanticTypesV1.js";

const ARTIFACT_KIND = "my-dev-kit-context-capsule-v1" as const;

const CONTEXT_CAPSULE_MODES = ["general", "feature-add", "subsystem"] as const;
const CONTEXT_ROLES = ["architecture", "implementation", "test-implementation"] as const;
const CONTEXT_ENTRY_KINDS = [
  "request-summary",
  "index-summary",
  "artifact-summary",
  "placeholder",
  "focus-summary",
  "selected-graph-summary",
  "selected-source-summary",
  "semantic-summary",
  "classification-summary",
  "conflict-summary"
] as const;
const CONTEXT_ADEQUACY_STATUSES = [
  "context sufficient for implementation",
  "context sufficient with listed assumptions",
  "context insufficient and more retrieval required",
  "context conflict found and user or upstream stage decision required"
] as const;
const CHANGED_SURFACE_STATUSES = ["added", "modified", "removed", "unknown"] as const;
const CHANGED_SURFACE_PROVENANCES = ["caller", "graph-diff", "both"] as const;
const FOCUS_SELECTION_MODES = ["none", "single-best", "best-effort-ambiguous"] as const;
const FOCUS_CONFIDENCES = ["high", "medium", "low", "none"] as const;
const SOURCE_RETRIEVAL_METHODS = [
  "node",
  "symbol",
  "line-range",
  "contains",
  "react-region",
  "local-component-tree",
  "local-dependency-expansion",
  "continuation"
] as const;
const SOURCE_INCLUDED_BY = ["primary-focus", "selected-graph"] as const;
const REQUESTED_EVIDENCE_KINDS = [
  "owner",
  "dependencies",
  "contracts",
  "validators",
  "constants",
  "errors",
  "schemas",
  "callers",
  "callees",
  "closest-tests",
  "test-infrastructure",
  "test-commands",
  "changed-surface",
  "responsibility-mappings"
] as const;
const EVIDENCE_GROUP_KINDS = [
  "owners",
  "extension-points",
  "contracts",
  "graph-neighborhood",
  "architecture-tests",
  "dependencies",
  "callers-and-callees",
  "validators-and-constants",
  "errors",
  "schemas-and-serializers",
  "compatibility-surfaces",
  "closest-tests",
  "changed-surface",
  "production-symbols",
  "validators-and-boundaries",
  "errors-and-side-effects",
  "related-tests",
  "fixtures",
  "factories",
  "mocks",
  "setup-and-configuration",
  "test-commands",
  "unresolved-evidence"
] as const;
const EVIDENCE_ITEM_KINDS = [
  "file",
  "symbol",
  "test-file",
  "fixture",
  "factory",
  "mock",
  "setup-file",
  "config-file",
  "package-script",
  "command"
] as const;
const TEST_COMMAND_SCOPES = ["file", "directory", "suite", "full-project"] as const;
const RESPONSIBILITY_CRITICALITIES = ["critical", "noncritical"] as const;
const RESPONSIBILITY_MAPPING_STATUSES = ["mapped", "partially-mapped", "unmapped", "not-applicable"] as const;
const FRESHNESS_STATES = ["fresh", "stale", "unknown"] as const;
const PROVENANCE_CATEGORIES = [
  "request",
  "cli",
  "request-file",
  "focus-file",
  "focus-symbol",
  "caller-changed-file",
  "caller-changed-symbol",
  "graph-diff",
  "active-index",
  "before-index",
  "after-index",
  "code-graph",
  "symbol-index",
  "source-scan",
  "test-directory-walk",
  "import-scan",
  "package-json",
  "test-configuration",
  "upstream-artifact-ref"
] as const;
const EDIT_GUIDANCES = [
  "safe-primary-edit-target",
  "inspect-before-edit",
  "avoid-primary-edit-target",
  "read-only-reference",
  "generated-do-not-edit",
  "test-only",
  "docs-only",
  "uncertain"
] as const;
const READINESSES = ["ready", "needs-more-context", "risky-assumption"] as const;
const RISK_LABELS = [
  "wrong-layer-risk",
  "unreachable-ui-risk",
  "requires-test-validation",
  "requires-browser-validation",
  "generated-file-risk",
  "public-contract-risk",
  "migration-risk"
] as const;
const UNCERTAINTY_TIERS = ["certain", "likely", "possible", "unknown"] as const;

function validateContextRole(ctx: FieldContext, value: JsonValue, fieldPath: string): ContextRole | null {
  return requiredNullableLiteral(ctx, value, fieldPath, CONTEXT_ROLES);
}

function validateSemanticArtifactRef(ctx: FieldContext, value: JsonValue, fieldPath: string): SemanticArtifactRef {
  const obj = requiredObject(ctx, value, fieldPath);
  return {
    artifact: requiredString(ctx, requiredField(ctx, obj, "artifact", joinFieldPath(fieldPath, "artifact")), joinFieldPath(fieldPath, "artifact")),
    ...(optionalField(obj, "artifactKind") !== undefined
      ? { artifactKind: optionalNullableString(ctx, optionalField(obj, "artifactKind"), joinFieldPath(fieldPath, "artifactKind")) as SemanticArtifactRef["artifactKind"] }
      : {}),
    id: requiredString(ctx, requiredField(ctx, obj, "id", joinFieldPath(fieldPath, "id")), joinFieldPath(fieldPath, "id")),
    ...(optionalField(obj, "path") !== undefined
      ? { path: optionalNullableString(ctx, optionalField(obj, "path"), joinFieldPath(fieldPath, "path")) }
      : {})
  };
}

function validateSemanticEvidenceRef(ctx: FieldContext, value: JsonValue, fieldPath: string): SemanticEvidenceRef {
  const obj = requiredObject(ctx, value, fieldPath);
  const result: SemanticEvidenceRef = {
    filePath: requiredString(ctx, requiredField(ctx, obj, "filePath", joinFieldPath(fieldPath, "filePath")), joinFieldPath(fieldPath, "filePath"))
  };
  if (optionalField(obj, "symbolId") !== undefined) result.symbolId = optionalNullableString(ctx, obj.symbolId, joinFieldPath(fieldPath, "symbolId"));
  if (optionalField(obj, "line") !== undefined) result.line = obj.line === null ? null : requiredNumber(ctx, obj.line, joinFieldPath(fieldPath, "line"));
  if (optionalField(obj, "endLine") !== undefined)
    result.endLine = obj.endLine === null ? null : requiredNumber(ctx, obj.endLine, joinFieldPath(fieldPath, "endLine"));
  if (optionalField(obj, "source") !== undefined) result.source = optionalNullableString(ctx, obj.source, joinFieldPath(fieldPath, "source"));
  if (optionalField(obj, "analyzer") !== undefined) result.analyzer = optionalNullableString(ctx, obj.analyzer, joinFieldPath(fieldPath, "analyzer"));
  return result;
}

function validateSemanticRoleWarning(ctx: FieldContext, value: JsonValue, fieldPath: string): SemanticRoleWarning {
  const obj = requiredObject(ctx, value, fieldPath);
  const result: SemanticRoleWarning = {
    kind: requiredString(ctx, requiredField(ctx, obj, "kind", joinFieldPath(fieldPath, "kind")), joinFieldPath(fieldPath, "kind")) as SemanticRoleWarning["kind"],
    message: requiredString(ctx, requiredField(ctx, obj, "message", joinFieldPath(fieldPath, "message")), joinFieldPath(fieldPath, "message"))
  };
  if (optionalField(obj, "artifactRefs") !== undefined) {
    result.artifactRefs = requiredArray(ctx, obj.artifactRefs, joinFieldPath(fieldPath, "artifactRefs")).map((item, i) =>
      validateSemanticArtifactRef(ctx, item, arrayFieldPath(joinFieldPath(fieldPath, "artifactRefs"), i))
    );
  }
  if (optionalField(obj, "evidenceRefs") !== undefined) {
    result.evidenceRefs = requiredArray(ctx, obj.evidenceRefs, joinFieldPath(fieldPath, "evidenceRefs")).map((item, i) =>
      validateSemanticEvidenceRef(ctx, item, arrayFieldPath(joinFieldPath(fieldPath, "evidenceRefs"), i))
    );
  }
  return result;
}

function validateSemanticRole(ctx: FieldContext, value: JsonValue, fieldPath: string): SemanticRole {
  const obj = requiredObject(ctx, value, fieldPath);
  const result: SemanticRole = {
    role: requiredString(ctx, requiredField(ctx, obj, "role", joinFieldPath(fieldPath, "role")), joinFieldPath(fieldPath, "role")) as SemanticRole["role"],
    confidence: requiredString(
      ctx,
      requiredField(ctx, obj, "confidence", joinFieldPath(fieldPath, "confidence")),
      joinFieldPath(fieldPath, "confidence")
    ) as SemanticRole["confidence"],
    source: requiredString(ctx, requiredField(ctx, obj, "source", joinFieldPath(fieldPath, "source")), joinFieldPath(fieldPath, "source")) as SemanticRole["source"]
  };
  if (optionalField(obj, "subtype") !== undefined)
    result.subtype = optionalNullableString(ctx, obj.subtype, joinFieldPath(fieldPath, "subtype")) as SemanticRole["subtype"];
  if (optionalField(obj, "artifactRefs") !== undefined) {
    result.artifactRefs = requiredArray(ctx, obj.artifactRefs, joinFieldPath(fieldPath, "artifactRefs")).map((item, i) =>
      validateSemanticArtifactRef(ctx, item, arrayFieldPath(joinFieldPath(fieldPath, "artifactRefs"), i))
    );
  }
  if (optionalField(obj, "evidenceRefs") !== undefined) {
    result.evidenceRefs = requiredArray(ctx, obj.evidenceRefs, joinFieldPath(fieldPath, "evidenceRefs")).map((item, i) =>
      validateSemanticEvidenceRef(ctx, item, arrayFieldPath(joinFieldPath(fieldPath, "evidenceRefs"), i))
    );
  }
  if (optionalField(obj, "warnings") !== undefined) {
    result.warnings = requiredArray(ctx, obj.warnings, joinFieldPath(fieldPath, "warnings")).map((item, i) =>
      validateSemanticRoleWarning(ctx, item, arrayFieldPath(joinFieldPath(fieldPath, "warnings"), i))
    );
  }
  return result;
}

function validateClassificationRole(ctx: FieldContext, value: JsonValue, fieldPath: string): ClassificationRole {
  const obj = requiredObject(ctx, value, fieldPath);
  const result: ClassificationRole = {
    role: requiredString(ctx, requiredField(ctx, obj, "role", joinFieldPath(fieldPath, "role")), joinFieldPath(fieldPath, "role")) as ClassificationRole["role"],
    confidence: requiredLiteral(
      ctx,
      requiredField(ctx, obj, "confidence", joinFieldPath(fieldPath, "confidence")),
      joinFieldPath(fieldPath, "confidence"),
      UNCERTAINTY_TIERS
    )
  };
  if (optionalField(obj, "subtype") !== undefined) result.subtype = optionalNullableString(ctx, obj.subtype, joinFieldPath(fieldPath, "subtype"));
  return result;
}

function validateClassificationRoleRef(ctx: FieldContext, value: JsonValue, fieldPath: string): ClassificationRoleRef {
  const obj = requiredObject(ctx, value, fieldPath);
  return {
    role: requiredString(ctx, requiredField(ctx, obj, "role", joinFieldPath(fieldPath, "role")), joinFieldPath(fieldPath, "role")) as ClassificationRoleRef["role"],
    editGuidance: requiredLiteral(
      ctx,
      requiredField(ctx, obj, "editGuidance", joinFieldPath(fieldPath, "editGuidance")),
      joinFieldPath(fieldPath, "editGuidance"),
      EDIT_GUIDANCES
    ),
    readiness: requiredLiteral(
      ctx,
      requiredField(ctx, obj, "readiness", joinFieldPath(fieldPath, "readiness")),
      joinFieldPath(fieldPath, "readiness"),
      READINESSES
    ),
    uncertainty: requiredLiteral(
      ctx,
      requiredField(ctx, obj, "uncertainty", joinFieldPath(fieldPath, "uncertainty")),
      joinFieldPath(fieldPath, "uncertainty"),
      UNCERTAINTY_TIERS
    )
  };
}

function validateContextEntryEvidenceRef(ctx: FieldContext, value: JsonValue, fieldPath: string): ContextEntryEvidenceRef {
  const obj = requiredObject(ctx, value, fieldPath);
  return { path: requiredString(ctx, requiredField(ctx, obj, "path", joinFieldPath(fieldPath, "path")), joinFieldPath(fieldPath, "path")) };
}

function validateContextEntry(ctx: FieldContext, value: JsonValue, fieldPath: string): ContextEntry {
  const obj = requiredObject(ctx, value, fieldPath);
  const result: ContextEntry = {
    id: requiredString(ctx, requiredField(ctx, obj, "id", joinFieldPath(fieldPath, "id")), joinFieldPath(fieldPath, "id")),
    kind: requiredLiteral(ctx, requiredField(ctx, obj, "kind", joinFieldPath(fieldPath, "kind")), joinFieldPath(fieldPath, "kind"), CONTEXT_ENTRY_KINDS),
    title: requiredString(ctx, requiredField(ctx, obj, "title", joinFieldPath(fieldPath, "title")), joinFieldPath(fieldPath, "title")),
    reason: requiredString(ctx, requiredField(ctx, obj, "reason", joinFieldPath(fieldPath, "reason")), joinFieldPath(fieldPath, "reason")),
    evidenceRefs: requiredArray(ctx, requiredField(ctx, obj, "evidenceRefs", joinFieldPath(fieldPath, "evidenceRefs")), joinFieldPath(fieldPath, "evidenceRefs")).map(
      (item, i) => validateContextEntryEvidenceRef(ctx, item, arrayFieldPath(joinFieldPath(fieldPath, "evidenceRefs"), i))
    ),
    warnings: requiredStringArray(ctx, requiredField(ctx, obj, "warnings", joinFieldPath(fieldPath, "warnings")), joinFieldPath(fieldPath, "warnings"))
  };
  if (optionalField(obj, "classificationRefs") !== undefined) {
    result.classificationRefs = requiredArray(ctx, obj.classificationRefs, joinFieldPath(fieldPath, "classificationRefs")).map((item, i) =>
      validateSemanticEvidenceRef(ctx, item, arrayFieldPath(joinFieldPath(fieldPath, "classificationRefs"), i))
    ) as SourceRef[];
  }
  if (optionalField(obj, "classificationRoles") !== undefined) {
    result.classificationRoles = requiredArray(ctx, obj.classificationRoles, joinFieldPath(fieldPath, "classificationRoles")).map((item, i) =>
      validateClassificationRole(ctx, item, arrayFieldPath(joinFieldPath(fieldPath, "classificationRoles"), i))
    );
  }
  return result;
}

function validateDroppedContextEntry(ctx: FieldContext, value: JsonValue, fieldPath: string): DroppedContextEntry {
  const obj = requiredObject(ctx, value, fieldPath);
  return {
    id: requiredString(ctx, requiredField(ctx, obj, "id", joinFieldPath(fieldPath, "id")), joinFieldPath(fieldPath, "id")),
    kind: requiredLiteral(ctx, requiredField(ctx, obj, "kind", joinFieldPath(fieldPath, "kind")), joinFieldPath(fieldPath, "kind"), CONTEXT_ENTRY_KINDS),
    title: requiredString(ctx, requiredField(ctx, obj, "title", joinFieldPath(fieldPath, "title")), joinFieldPath(fieldPath, "title")),
    reason: requiredString(ctx, requiredField(ctx, obj, "reason", joinFieldPath(fieldPath, "reason")), joinFieldPath(fieldPath, "reason"))
  };
}

export function validateContextAdequacyStatement(ctx: FieldContext, value: JsonValue, fieldPath: string): ContextAdequacyStatement {
  const obj = requiredObject(ctx, value, fieldPath);
  return {
    status: requiredLiteral(
      ctx,
      requiredField(ctx, obj, "status", joinFieldPath(fieldPath, "status")),
      joinFieldPath(fieldPath, "status"),
      CONTEXT_ADEQUACY_STATUSES
    ) as ContextAdequacyStatus,
    summary: requiredString(ctx, requiredField(ctx, obj, "summary", joinFieldPath(fieldPath, "summary")), joinFieldPath(fieldPath, "summary")),
    assumptions: requiredStringArray(
      ctx,
      requiredField(ctx, obj, "assumptions", joinFieldPath(fieldPath, "assumptions")),
      joinFieldPath(fieldPath, "assumptions")
    ),
    gaps: requiredStringArray(ctx, requiredField(ctx, obj, "gaps", joinFieldPath(fieldPath, "gaps")), joinFieldPath(fieldPath, "gaps"))
  };
}

function validateQueryTerms(ctx: FieldContext, value: JsonValue, fieldPath: string): QueryTerms {
  const obj = requiredObject(ctx, value, fieldPath);
  const req = (key: string): string[] =>
    requiredStringArray(ctx, requiredField(ctx, obj, key, joinFieldPath(fieldPath, key)), joinFieldPath(fieldPath, key));
  return {
    raw: req("raw"),
    quotedPhrases: req("quotedPhrases"),
    pathLike: req("pathLike"),
    symbolLike: req("symbolLike"),
    routeLike: req("routeLike"),
    commandLike: req("commandLike"),
    artifactLike: req("artifactLike"),
    classificationLike: req("classificationLike")
  };
}

function validateQueryPlan(ctx: FieldContext, value: JsonValue, fieldPath: string): QueryPlan {
  const obj = requiredObject(ctx, value, fieldPath);
  return {
    originalQuery: requiredString(
      ctx,
      requiredField(ctx, obj, "originalQuery", joinFieldPath(fieldPath, "originalQuery")),
      joinFieldPath(fieldPath, "originalQuery")
    ),
    normalizedQuery: requiredString(
      ctx,
      requiredField(ctx, obj, "normalizedQuery", joinFieldPath(fieldPath, "normalizedQuery")),
      joinFieldPath(fieldPath, "normalizedQuery")
    ),
    mode: requiredLiteral(
      ctx,
      requiredField(ctx, obj, "mode", joinFieldPath(fieldPath, "mode")),
      joinFieldPath(fieldPath, "mode"),
      CONTEXT_CAPSULE_MODES
    ) as ContextCapsuleMode,
    searchQueries: requiredStringArray(
      ctx,
      requiredField(ctx, obj, "searchQueries", joinFieldPath(fieldPath, "searchQueries")),
      joinFieldPath(fieldPath, "searchQueries")
    ),
    terms: validateQueryTerms(ctx, requiredField(ctx, obj, "terms", joinFieldPath(fieldPath, "terms")), joinFieldPath(fieldPath, "terms"))
  };
}

function validateCandidateFile(ctx: FieldContext, value: JsonValue, fieldPath: string): CandidateFile {
  const obj = requiredObject(ctx, value, fieldPath);
  const result: CandidateFile = {
    path: requiredString(ctx, requiredField(ctx, obj, "path", joinFieldPath(fieldPath, "path")), joinFieldPath(fieldPath, "path")),
    score: requiredNumber(ctx, requiredField(ctx, obj, "score", joinFieldPath(fieldPath, "score")), joinFieldPath(fieldPath, "score")),
    reasons: requiredStringArray(ctx, requiredField(ctx, obj, "reasons", joinFieldPath(fieldPath, "reasons")), joinFieldPath(fieldPath, "reasons")),
    matchedTerms: requiredStringArray(
      ctx,
      requiredField(ctx, obj, "matchedTerms", joinFieldPath(fieldPath, "matchedTerms")),
      joinFieldPath(fieldPath, "matchedTerms")
    ),
    retained: requiredBoolean(ctx, requiredField(ctx, obj, "retained", joinFieldPath(fieldPath, "retained")), joinFieldPath(fieldPath, "retained"))
  };
  if (optionalField(obj, "baseScore") !== undefined) result.baseScore = optionalNumber(ctx, obj.baseScore, joinFieldPath(fieldPath, "baseScore"));
  if (optionalField(obj, "modeAdjustment") !== undefined)
    result.modeAdjustment = optionalNumber(ctx, obj.modeAdjustment, joinFieldPath(fieldPath, "modeAdjustment"));
  if (optionalField(obj, "semanticRoles") !== undefined) {
    result.semanticRoles = requiredArray(ctx, obj.semanticRoles, joinFieldPath(fieldPath, "semanticRoles")).map((item, i) =>
      validateSemanticRole(ctx, item, arrayFieldPath(joinFieldPath(fieldPath, "semanticRoles"), i))
    );
  }
  if (optionalField(obj, "artifactRefs") !== undefined) {
    result.artifactRefs = requiredArray(ctx, obj.artifactRefs, joinFieldPath(fieldPath, "artifactRefs")).map((item, i) =>
      validateSemanticArtifactRef(ctx, item, arrayFieldPath(joinFieldPath(fieldPath, "artifactRefs"), i))
    );
  }
  if (optionalField(obj, "classificationRoles") !== undefined) {
    result.classificationRoles = requiredArray(ctx, obj.classificationRoles, joinFieldPath(fieldPath, "classificationRoles")).map((item, i) =>
      validateClassificationRoleRef(ctx, item, arrayFieldPath(joinFieldPath(fieldPath, "classificationRoles"), i))
    );
  }
  if (optionalField(obj, "classificationRefs") !== undefined) {
    result.classificationRefs = requiredArray(ctx, obj.classificationRefs, joinFieldPath(fieldPath, "classificationRefs")).map((item, i) =>
      validateSemanticArtifactRef(ctx, item, arrayFieldPath(joinFieldPath(fieldPath, "classificationRefs"), i))
    );
  }
  if (optionalField(obj, "droppedReason") !== undefined) result.droppedReason = optionalString(ctx, obj.droppedReason, joinFieldPath(fieldPath, "droppedReason"));
  if (optionalField(obj, "roleScoreAdjustment") !== undefined)
    result.roleScoreAdjustment = optionalNumber(ctx, obj.roleScoreAdjustment, joinFieldPath(fieldPath, "roleScoreAdjustment"));
  if (optionalField(obj, "contextRole") !== undefined)
    result.contextRole = optionalLiteral(ctx, obj.contextRole, joinFieldPath(fieldPath, "contextRole"), CONTEXT_ROLES);
  if (optionalField(obj, "focusMatch") !== undefined) result.focusMatch = optionalBoolean(ctx, obj.focusMatch, joinFieldPath(fieldPath, "focusMatch"));
  if (optionalField(obj, "changedSurfaceMatch") !== undefined)
    result.changedSurfaceMatch = optionalBoolean(ctx, obj.changedSurfaceMatch, joinFieldPath(fieldPath, "changedSurfaceMatch"));
  if (optionalField(obj, "changedStatus") !== undefined)
    result.changedStatus = optionalLiteral(ctx, obj.changedStatus, joinFieldPath(fieldPath, "changedStatus"), CHANGED_SURFACE_STATUSES);
  return result;
}

function validateCandidateNode(ctx: FieldContext, value: JsonValue, fieldPath: string): CandidateNode {
  const obj = requiredObject(ctx, value, fieldPath);
  const result: CandidateNode = {
    nodeId: requiredString(ctx, requiredField(ctx, obj, "nodeId", joinFieldPath(fieldPath, "nodeId")), joinFieldPath(fieldPath, "nodeId")),
    kind: requiredString(ctx, requiredField(ctx, obj, "kind", joinFieldPath(fieldPath, "kind")), joinFieldPath(fieldPath, "kind")) as CandidateNode["kind"],
    label: requiredString(ctx, requiredField(ctx, obj, "label", joinFieldPath(fieldPath, "label")), joinFieldPath(fieldPath, "label")),
    score: requiredNumber(ctx, requiredField(ctx, obj, "score", joinFieldPath(fieldPath, "score")), joinFieldPath(fieldPath, "score")),
    reasons: requiredStringArray(ctx, requiredField(ctx, obj, "reasons", joinFieldPath(fieldPath, "reasons")), joinFieldPath(fieldPath, "reasons")),
    matchedTerms: requiredStringArray(
      ctx,
      requiredField(ctx, obj, "matchedTerms", joinFieldPath(fieldPath, "matchedTerms")),
      joinFieldPath(fieldPath, "matchedTerms")
    ),
    retained: requiredBoolean(ctx, requiredField(ctx, obj, "retained", joinFieldPath(fieldPath, "retained")), joinFieldPath(fieldPath, "retained"))
  };
  if (optionalField(obj, "filePath") !== undefined) result.filePath = optionalString(ctx, obj.filePath, joinFieldPath(fieldPath, "filePath"));
  if (optionalField(obj, "baseScore") !== undefined) result.baseScore = optionalNumber(ctx, obj.baseScore, joinFieldPath(fieldPath, "baseScore"));
  if (optionalField(obj, "modeAdjustment") !== undefined)
    result.modeAdjustment = optionalNumber(ctx, obj.modeAdjustment, joinFieldPath(fieldPath, "modeAdjustment"));
  if (optionalField(obj, "semanticRoles") !== undefined) {
    result.semanticRoles = requiredArray(ctx, obj.semanticRoles, joinFieldPath(fieldPath, "semanticRoles")).map((item, i) =>
      validateSemanticRole(ctx, item, arrayFieldPath(joinFieldPath(fieldPath, "semanticRoles"), i))
    );
  }
  if (optionalField(obj, "artifactRefs") !== undefined) {
    result.artifactRefs = requiredArray(ctx, obj.artifactRefs, joinFieldPath(fieldPath, "artifactRefs")).map((item, i) =>
      validateSemanticArtifactRef(ctx, item, arrayFieldPath(joinFieldPath(fieldPath, "artifactRefs"), i))
    );
  }
  if (optionalField(obj, "classificationRoles") !== undefined) {
    result.classificationRoles = requiredArray(ctx, obj.classificationRoles, joinFieldPath(fieldPath, "classificationRoles")).map((item, i) =>
      validateClassificationRoleRef(ctx, item, arrayFieldPath(joinFieldPath(fieldPath, "classificationRoles"), i))
    );
  }
  if (optionalField(obj, "classificationRefs") !== undefined) {
    result.classificationRefs = requiredArray(ctx, obj.classificationRefs, joinFieldPath(fieldPath, "classificationRefs")).map((item, i) =>
      validateSemanticArtifactRef(ctx, item, arrayFieldPath(joinFieldPath(fieldPath, "classificationRefs"), i))
    );
  }
  if (optionalField(obj, "androidArtifactId") !== undefined)
    result.androidArtifactId = optionalString(ctx, obj.androidArtifactId, joinFieldPath(fieldPath, "androidArtifactId"));
  if (optionalField(obj, "androidMetadata") !== undefined) {
    const recordObj = requiredRecord(ctx, obj.androidMetadata, joinFieldPath(fieldPath, "androidMetadata"));
    const record: Record<string, string | number | boolean | null> = {};
    for (const [key, val] of Object.entries(recordObj)) {
      record[key] = requiredScalarLike(ctx, val, joinFieldPath(joinFieldPath(fieldPath, "androidMetadata"), key));
    }
    result.androidMetadata = record;
  }
  if (optionalField(obj, "droppedReason") !== undefined) result.droppedReason = optionalString(ctx, obj.droppedReason, joinFieldPath(fieldPath, "droppedReason"));
  if (optionalField(obj, "roleScoreAdjustment") !== undefined)
    result.roleScoreAdjustment = optionalNumber(ctx, obj.roleScoreAdjustment, joinFieldPath(fieldPath, "roleScoreAdjustment"));
  if (optionalField(obj, "contextRole") !== undefined)
    result.contextRole = optionalLiteral(ctx, obj.contextRole, joinFieldPath(fieldPath, "contextRole"), CONTEXT_ROLES);
  if (optionalField(obj, "focusMatch") !== undefined) result.focusMatch = optionalBoolean(ctx, obj.focusMatch, joinFieldPath(fieldPath, "focusMatch"));
  if (optionalField(obj, "changedSurfaceMatch") !== undefined)
    result.changedSurfaceMatch = optionalBoolean(ctx, obj.changedSurfaceMatch, joinFieldPath(fieldPath, "changedSurfaceMatch"));
  if (optionalField(obj, "changedStatus") !== undefined)
    result.changedStatus = optionalLiteral(ctx, obj.changedStatus, joinFieldPath(fieldPath, "changedStatus"), CHANGED_SURFACE_STATUSES);
  if (optionalField(obj, "synthesized") !== undefined) result.synthesized = optionalBoolean(ctx, obj.synthesized, joinFieldPath(fieldPath, "synthesized"));
  return result;
}

function validateContextFocus(ctx: FieldContext, value: JsonValue, fieldPath: string): ContextFocus {
  const obj = requiredObject(ctx, value, fieldPath);
  return {
    focusNodeId: requiredNullableString(
      ctx,
      requiredField(ctx, obj, "focusNodeId", joinFieldPath(fieldPath, "focusNodeId")),
      joinFieldPath(fieldPath, "focusNodeId")
    ),
    focusFilePath: requiredNullableString(
      ctx,
      requiredField(ctx, obj, "focusFilePath", joinFieldPath(fieldPath, "focusFilePath")),
      joinFieldPath(fieldPath, "focusFilePath")
    ),
    selectionMode: requiredLiteral(
      ctx,
      requiredField(ctx, obj, "selectionMode", joinFieldPath(fieldPath, "selectionMode")),
      joinFieldPath(fieldPath, "selectionMode"),
      FOCUS_SELECTION_MODES
    ),
    confidence: requiredLiteral(
      ctx,
      requiredField(ctx, obj, "confidence", joinFieldPath(fieldPath, "confidence")),
      joinFieldPath(fieldPath, "confidence"),
      FOCUS_CONFIDENCES
    ),
    reasons: requiredStringArray(ctx, requiredField(ctx, obj, "reasons", joinFieldPath(fieldPath, "reasons")), joinFieldPath(fieldPath, "reasons")),
    ambiguityNotes: requiredStringArray(
      ctx,
      requiredField(ctx, obj, "ambiguityNotes", joinFieldPath(fieldPath, "ambiguityNotes")),
      joinFieldPath(fieldPath, "ambiguityNotes")
    ),
    warnings: requiredStringArray(ctx, requiredField(ctx, obj, "warnings", joinFieldPath(fieldPath, "warnings")), joinFieldPath(fieldPath, "warnings"))
  };
}

function validateSelectedGraphNode(ctx: FieldContext, value: JsonValue, fieldPath: string): SelectedGraphNode {
  const obj = requiredObject(ctx, value, fieldPath);
  const result: SelectedGraphNode = {
    nodeId: requiredString(ctx, requiredField(ctx, obj, "nodeId", joinFieldPath(fieldPath, "nodeId")), joinFieldPath(fieldPath, "nodeId")),
    kind: requiredString(ctx, requiredField(ctx, obj, "kind", joinFieldPath(fieldPath, "kind")), joinFieldPath(fieldPath, "kind")),
    label: requiredString(ctx, requiredField(ctx, obj, "label", joinFieldPath(fieldPath, "label")), joinFieldPath(fieldPath, "label")),
    reasons: requiredStringArray(ctx, requiredField(ctx, obj, "reasons", joinFieldPath(fieldPath, "reasons")), joinFieldPath(fieldPath, "reasons"))
  };
  if (optionalField(obj, "filePath") !== undefined) result.filePath = optionalString(ctx, obj.filePath, joinFieldPath(fieldPath, "filePath"));
  return result;
}

function validateSelectedGraphEdge(ctx: FieldContext, value: JsonValue, fieldPath: string): SelectedGraphEdge {
  const obj = requiredObject(ctx, value, fieldPath);
  return {
    from: requiredString(ctx, requiredField(ctx, obj, "from", joinFieldPath(fieldPath, "from")), joinFieldPath(fieldPath, "from")),
    to: requiredString(ctx, requiredField(ctx, obj, "to", joinFieldPath(fieldPath, "to")), joinFieldPath(fieldPath, "to")),
    kind: requiredString(ctx, requiredField(ctx, obj, "kind", joinFieldPath(fieldPath, "kind")), joinFieldPath(fieldPath, "kind")),
    reasons: requiredStringArray(ctx, requiredField(ctx, obj, "reasons", joinFieldPath(fieldPath, "reasons")), joinFieldPath(fieldPath, "reasons"))
  };
}

function validateSelectedGraph(ctx: FieldContext, value: JsonValue, fieldPath: string): SelectedGraph {
  const obj = requiredObject(ctx, value, fieldPath);
  return {
    nodes: requiredArray(ctx, requiredField(ctx, obj, "nodes", joinFieldPath(fieldPath, "nodes")), joinFieldPath(fieldPath, "nodes")).map((item, i) =>
      validateSelectedGraphNode(ctx, item, arrayFieldPath(joinFieldPath(fieldPath, "nodes"), i))
    ),
    edges: requiredArray(ctx, requiredField(ctx, obj, "edges", joinFieldPath(fieldPath, "edges")), joinFieldPath(fieldPath, "edges")).map((item, i) =>
      validateSelectedGraphEdge(ctx, item, arrayFieldPath(joinFieldPath(fieldPath, "edges"), i))
    ),
    omittedNodeCount: requiredNonnegativeInteger(
      ctx,
      requiredField(ctx, obj, "omittedNodeCount", joinFieldPath(fieldPath, "omittedNodeCount")),
      joinFieldPath(fieldPath, "omittedNodeCount")
    ),
    omittedEdgeCount: requiredNonnegativeInteger(
      ctx,
      requiredField(ctx, obj, "omittedEdgeCount", joinFieldPath(fieldPath, "omittedEdgeCount")),
      joinFieldPath(fieldPath, "omittedEdgeCount")
    ),
    warnings: requiredStringArray(ctx, requiredField(ctx, obj, "warnings", joinFieldPath(fieldPath, "warnings")), joinFieldPath(fieldPath, "warnings"))
  };
}

function validateRetentionCapSettings(ctx: FieldContext, value: JsonValue, fieldPath: string): RetentionCapSettings {
  const obj = requiredObject(ctx, value, fieldPath);
  return {
    maxCandidateFiles: requiredNullableNumber(
      ctx,
      requiredField(ctx, obj, "maxCandidateFiles", joinFieldPath(fieldPath, "maxCandidateFiles")),
      joinFieldPath(fieldPath, "maxCandidateFiles")
    ),
    maxGraphNodes: requiredNullableNumber(
      ctx,
      requiredField(ctx, obj, "maxGraphNodes", joinFieldPath(fieldPath, "maxGraphNodes")),
      joinFieldPath(fieldPath, "maxGraphNodes")
    ),
    maxGraphEdges: requiredNullableNumber(
      ctx,
      requiredField(ctx, obj, "maxGraphEdges", joinFieldPath(fieldPath, "maxGraphEdges")),
      joinFieldPath(fieldPath, "maxGraphEdges")
    )
  };
}

function validateRetentionSummary(ctx: FieldContext, value: JsonValue, fieldPath: string): RetentionSummary {
  const obj = requiredObject(ctx, value, fieldPath);
  const reqInt = (key: string): number =>
    requiredNonnegativeInteger(ctx, requiredField(ctx, obj, key, joinFieldPath(fieldPath, key)), joinFieldPath(fieldPath, key));
  return {
    retainedCandidateCount: reqInt("retainedCandidateCount"),
    droppedCandidateCount: reqInt("droppedCandidateCount"),
    retainedGraphNodeCount: reqInt("retainedGraphNodeCount"),
    droppedGraphNodeCount: reqInt("droppedGraphNodeCount"),
    retainedGraphEdgeCount: reqInt("retainedGraphEdgeCount"),
    droppedGraphEdgeCount: reqInt("droppedGraphEdgeCount"),
    capSettings: validateRetentionCapSettings(
      ctx,
      requiredField(ctx, obj, "capSettings", joinFieldPath(fieldPath, "capSettings")),
      joinFieldPath(fieldPath, "capSettings")
    )
  };
}

function validateSelectedSourceSlice(ctx: FieldContext, value: JsonValue, fieldPath: string): SelectedSourceSlice {
  const obj = requiredObject(ctx, value, fieldPath);
  const result: SelectedSourceSlice = {
    id: requiredString(ctx, requiredField(ctx, obj, "id", joinFieldPath(fieldPath, "id")), joinFieldPath(fieldPath, "id")),
    kind: requiredString(ctx, requiredField(ctx, obj, "kind", joinFieldPath(fieldPath, "kind")), joinFieldPath(fieldPath, "kind")),
    filePath: requiredString(ctx, requiredField(ctx, obj, "filePath", joinFieldPath(fieldPath, "filePath")), joinFieldPath(fieldPath, "filePath")),
    startLine: requiredNumber(ctx, requiredField(ctx, obj, "startLine", joinFieldPath(fieldPath, "startLine")), joinFieldPath(fieldPath, "startLine")),
    endLine: requiredNumber(ctx, requiredField(ctx, obj, "endLine", joinFieldPath(fieldPath, "endLine")), joinFieldPath(fieldPath, "endLine")),
    reason: requiredString(ctx, requiredField(ctx, obj, "reason", joinFieldPath(fieldPath, "reason")), joinFieldPath(fieldPath, "reason")),
    sourceRetrievalMethod: requiredLiteral(
      ctx,
      requiredField(ctx, obj, "sourceRetrievalMethod", joinFieldPath(fieldPath, "sourceRetrievalMethod")),
      joinFieldPath(fieldPath, "sourceRetrievalMethod"),
      SOURCE_RETRIEVAL_METHODS
    ),
    includedBy: requiredLiteral(
      ctx,
      requiredField(ctx, obj, "includedBy", joinFieldPath(fieldPath, "includedBy")),
      joinFieldPath(fieldPath, "includedBy"),
      SOURCE_INCLUDED_BY
    ),
    truncated: requiredBoolean(ctx, requiredField(ctx, obj, "truncated", joinFieldPath(fieldPath, "truncated")), joinFieldPath(fieldPath, "truncated")),
    continuationUsed: requiredBoolean(
      ctx,
      requiredField(ctx, obj, "continuationUsed", joinFieldPath(fieldPath, "continuationUsed")),
      joinFieldPath(fieldPath, "continuationUsed")
    ),
    localExpansionUsed: requiredBoolean(
      ctx,
      requiredField(ctx, obj, "localExpansionUsed", joinFieldPath(fieldPath, "localExpansionUsed")),
      joinFieldPath(fieldPath, "localExpansionUsed")
    ),
    warnings: requiredStringArray(ctx, requiredField(ctx, obj, "warnings", joinFieldPath(fieldPath, "warnings")), joinFieldPath(fieldPath, "warnings"))
  };
  if (optionalField(obj, "nodeId") !== undefined) result.nodeId = optionalString(ctx, obj.nodeId, joinFieldPath(fieldPath, "nodeId"));
  if (optionalField(obj, "symbolName") !== undefined)
    result.symbolName = optionalNullableString(ctx, obj.symbolName, joinFieldPath(fieldPath, "symbolName"));
  if (optionalField(obj, "continuationAvailable") !== undefined)
    result.continuationAvailable = optionalBoolean(ctx, obj.continuationAvailable, joinFieldPath(fieldPath, "continuationAvailable"));
  if (optionalField(obj, "classificationRefs") !== undefined) {
    result.classificationRefs = requiredArray(ctx, obj.classificationRefs, joinFieldPath(fieldPath, "classificationRefs")).map((item, i) =>
      validateSemanticArtifactRef(ctx, item, arrayFieldPath(joinFieldPath(fieldPath, "classificationRefs"), i))
    );
  }
  if (optionalField(obj, "semanticRefs") !== undefined) {
    result.semanticRefs = requiredArray(ctx, obj.semanticRefs, joinFieldPath(fieldPath, "semanticRefs")).map((item, i) =>
      validateSemanticArtifactRef(ctx, item, arrayFieldPath(joinFieldPath(fieldPath, "semanticRefs"), i))
    );
  }
  return result;
}

function validateSkippedSourceEntry(ctx: FieldContext, value: JsonValue, fieldPath: string): SkippedSourceEntry {
  const obj = requiredObject(ctx, value, fieldPath);
  const result: SkippedSourceEntry = {
    id: requiredString(ctx, requiredField(ctx, obj, "id", joinFieldPath(fieldPath, "id")), joinFieldPath(fieldPath, "id")),
    kind: requiredString(ctx, requiredField(ctx, obj, "kind", joinFieldPath(fieldPath, "kind")), joinFieldPath(fieldPath, "kind")),
    reason: requiredString(ctx, requiredField(ctx, obj, "reason", joinFieldPath(fieldPath, "reason")), joinFieldPath(fieldPath, "reason"))
  };
  if (optionalField(obj, "filePath") !== undefined) result.filePath = optionalString(ctx, obj.filePath, joinFieldPath(fieldPath, "filePath"));
  if (optionalField(obj, "capType") !== undefined) result.capType = optionalString(ctx, obj.capType, joinFieldPath(fieldPath, "capType"));
  if (optionalField(obj, "candidateScore") !== undefined)
    result.candidateScore = optionalNumber(ctx, obj.candidateScore, joinFieldPath(fieldPath, "candidateScore"));
  return result;
}

function validateSelectedSource(ctx: FieldContext, value: JsonValue, fieldPath: string): SelectedSource {
  const obj = requiredObject(ctx, value, fieldPath);
  return {
    slices: requiredArray(ctx, requiredField(ctx, obj, "slices", joinFieldPath(fieldPath, "slices")), joinFieldPath(fieldPath, "slices")).map((item, i) =>
      validateSelectedSourceSlice(ctx, item, arrayFieldPath(joinFieldPath(fieldPath, "slices"), i))
    ),
    omittedSliceCount: requiredNonnegativeInteger(
      ctx,
      requiredField(ctx, obj, "omittedSliceCount", joinFieldPath(fieldPath, "omittedSliceCount")),
      joinFieldPath(fieldPath, "omittedSliceCount")
    ),
    totalSelectedLines: requiredNonnegativeInteger(
      ctx,
      requiredField(ctx, obj, "totalSelectedLines", joinFieldPath(fieldPath, "totalSelectedLines")),
      joinFieldPath(fieldPath, "totalSelectedLines")
    ),
    maxSourceSlices: requiredNonnegativeInteger(
      ctx,
      requiredField(ctx, obj, "maxSourceSlices", joinFieldPath(fieldPath, "maxSourceSlices")),
      joinFieldPath(fieldPath, "maxSourceSlices")
    ),
    warnings: requiredStringArray(ctx, requiredField(ctx, obj, "warnings", joinFieldPath(fieldPath, "warnings")), joinFieldPath(fieldPath, "warnings")),
    skipped: requiredArray(ctx, requiredField(ctx, obj, "skipped", joinFieldPath(fieldPath, "skipped")), joinFieldPath(fieldPath, "skipped")).map((item, i) =>
      validateSkippedSourceEntry(ctx, item, arrayFieldPath(joinFieldPath(fieldPath, "skipped"), i))
    )
  };
}

function validateSelectedSourceBundleBlock(ctx: FieldContext, value: JsonValue, fieldPath: string): SelectedSourceBundleBlock {
  const obj = requiredObject(ctx, value, fieldPath);
  const result: SelectedSourceBundleBlock = {
    id: requiredString(ctx, requiredField(ctx, obj, "id", joinFieldPath(fieldPath, "id")), joinFieldPath(fieldPath, "id")),
    kind: requiredString(ctx, requiredField(ctx, obj, "kind", joinFieldPath(fieldPath, "kind")), joinFieldPath(fieldPath, "kind")),
    filePath: requiredString(ctx, requiredField(ctx, obj, "filePath", joinFieldPath(fieldPath, "filePath")), joinFieldPath(fieldPath, "filePath")),
    startLine: requiredNumber(ctx, requiredField(ctx, obj, "startLine", joinFieldPath(fieldPath, "startLine")), joinFieldPath(fieldPath, "startLine")),
    endLine: requiredNumber(ctx, requiredField(ctx, obj, "endLine", joinFieldPath(fieldPath, "endLine")), joinFieldPath(fieldPath, "endLine")),
    reason: requiredString(ctx, requiredField(ctx, obj, "reason", joinFieldPath(fieldPath, "reason")), joinFieldPath(fieldPath, "reason")),
    includedBy: requiredString(ctx, requiredField(ctx, obj, "includedBy", joinFieldPath(fieldPath, "includedBy")), joinFieldPath(fieldPath, "includedBy")),
    truncated: requiredBoolean(ctx, requiredField(ctx, obj, "truncated", joinFieldPath(fieldPath, "truncated")), joinFieldPath(fieldPath, "truncated")),
    warnings: requiredStringArray(ctx, requiredField(ctx, obj, "warnings", joinFieldPath(fieldPath, "warnings")), joinFieldPath(fieldPath, "warnings"))
  };
  if (optionalField(obj, "symbolName") !== undefined)
    result.symbolName = optionalNullableString(ctx, obj.symbolName, joinFieldPath(fieldPath, "symbolName"));
  return result;
}

function validateSelectedSourceBundleSkippedBlock(ctx: FieldContext, value: JsonValue, fieldPath: string): SelectedSourceBundleSkippedBlock {
  const obj = requiredObject(ctx, value, fieldPath);
  const result: SelectedSourceBundleSkippedBlock = {
    id: requiredString(ctx, requiredField(ctx, obj, "id", joinFieldPath(fieldPath, "id")), joinFieldPath(fieldPath, "id")),
    kind: requiredString(ctx, requiredField(ctx, obj, "kind", joinFieldPath(fieldPath, "kind")), joinFieldPath(fieldPath, "kind")),
    reason: requiredString(ctx, requiredField(ctx, obj, "reason", joinFieldPath(fieldPath, "reason")), joinFieldPath(fieldPath, "reason"))
  };
  if (optionalField(obj, "filePath") !== undefined) result.filePath = optionalString(ctx, obj.filePath, joinFieldPath(fieldPath, "filePath"));
  if (optionalField(obj, "capType") !== undefined) result.capType = optionalString(ctx, obj.capType, joinFieldPath(fieldPath, "capType"));
  if (optionalField(obj, "candidateScore") !== undefined)
    result.candidateScore = optionalNumber(ctx, obj.candidateScore, joinFieldPath(fieldPath, "candidateScore"));
  return result;
}

function validateSelectedSourceBundle(ctx: FieldContext, value: JsonValue, fieldPath: string): SelectedSourceBundle {
  const obj = requiredObject(ctx, value, fieldPath);
  const result: SelectedSourceBundle = {
    id: requiredString(ctx, requiredField(ctx, obj, "id", joinFieldPath(fieldPath, "id")), joinFieldPath(fieldPath, "id")),
    title: requiredString(ctx, requiredField(ctx, obj, "title", joinFieldPath(fieldPath, "title")), joinFieldPath(fieldPath, "title")),
    focusFilePath: requiredNullableString(
      ctx,
      requiredField(ctx, obj, "focusFilePath", joinFieldPath(fieldPath, "focusFilePath")),
      joinFieldPath(fieldPath, "focusFilePath")
    ),
    reason: requiredString(ctx, requiredField(ctx, obj, "reason", joinFieldPath(fieldPath, "reason")), joinFieldPath(fieldPath, "reason")),
    blocks: requiredArray(ctx, requiredField(ctx, obj, "blocks", joinFieldPath(fieldPath, "blocks")), joinFieldPath(fieldPath, "blocks")).map((item, i) =>
      validateSelectedSourceBundleBlock(ctx, item, arrayFieldPath(joinFieldPath(fieldPath, "blocks"), i))
    ),
    totalLines: requiredNumber(ctx, requiredField(ctx, obj, "totalLines", joinFieldPath(fieldPath, "totalLines")), joinFieldPath(fieldPath, "totalLines")),
    maxLines: requiredNumber(ctx, requiredField(ctx, obj, "maxLines", joinFieldPath(fieldPath, "maxLines")), joinFieldPath(fieldPath, "maxLines")),
    skippedBlocks: requiredArray(
      ctx,
      requiredField(ctx, obj, "skippedBlocks", joinFieldPath(fieldPath, "skippedBlocks")),
      joinFieldPath(fieldPath, "skippedBlocks")
    ).map((item, i) => validateSelectedSourceBundleSkippedBlock(ctx, item, arrayFieldPath(joinFieldPath(fieldPath, "skippedBlocks"), i))),
    warnings: requiredStringArray(ctx, requiredField(ctx, obj, "warnings", joinFieldPath(fieldPath, "warnings")), joinFieldPath(fieldPath, "warnings"))
  };
  if (optionalField(obj, "focusNodeId") !== undefined) result.focusNodeId = optionalString(ctx, obj.focusNodeId, joinFieldPath(fieldPath, "focusNodeId"));
  return result;
}

function validateSelectedSourceBundles(ctx: FieldContext, value: JsonValue, fieldPath: string): SelectedSourceBundles {
  const obj = requiredObject(ctx, value, fieldPath);
  return {
    bundles: requiredArray(ctx, requiredField(ctx, obj, "bundles", joinFieldPath(fieldPath, "bundles")), joinFieldPath(fieldPath, "bundles")).map(
      (item, i) => validateSelectedSourceBundle(ctx, item, arrayFieldPath(joinFieldPath(fieldPath, "bundles"), i))
    ),
    omittedBundleCount: requiredNonnegativeInteger(
      ctx,
      requiredField(ctx, obj, "omittedBundleCount", joinFieldPath(fieldPath, "omittedBundleCount")),
      joinFieldPath(fieldPath, "omittedBundleCount")
    ),
    totalSelectedLines: requiredNonnegativeInteger(
      ctx,
      requiredField(ctx, obj, "totalSelectedLines", joinFieldPath(fieldPath, "totalSelectedLines")),
      joinFieldPath(fieldPath, "totalSelectedLines")
    ),
    warnings: requiredStringArray(ctx, requiredField(ctx, obj, "warnings", joinFieldPath(fieldPath, "warnings")), joinFieldPath(fieldPath, "warnings"))
  };
}

function validateSemanticSummaryEntry(ctx: FieldContext, value: JsonValue, fieldPath: string): SemanticSummaryEntry {
  const obj = requiredObject(ctx, value, fieldPath);
  return {
    roles: requiredArray(ctx, requiredField(ctx, obj, "roles", joinFieldPath(fieldPath, "roles")), joinFieldPath(fieldPath, "roles")).map((item, i) =>
      validateSemanticRole(ctx, item, arrayFieldPath(joinFieldPath(fieldPath, "roles"), i))
    ),
    artifactRefs: requiredArray(
      ctx,
      requiredField(ctx, obj, "artifactRefs", joinFieldPath(fieldPath, "artifactRefs")),
      joinFieldPath(fieldPath, "artifactRefs")
    ).map((item, i) => validateSemanticArtifactRef(ctx, item, arrayFieldPath(joinFieldPath(fieldPath, "artifactRefs"), i))),
    evidenceRefs: requiredArray(
      ctx,
      requiredField(ctx, obj, "evidenceRefs", joinFieldPath(fieldPath, "evidenceRefs")),
      joinFieldPath(fieldPath, "evidenceRefs")
    ).map((item, i) => validateSemanticEvidenceRef(ctx, item, arrayFieldPath(joinFieldPath(fieldPath, "evidenceRefs"), i)))
  };
}

function validateRecordOf<T>(
  ctx: FieldContext,
  value: JsonValue,
  fieldPath: string,
  elementValidator: (ctx: FieldContext, item: JsonValue, path: string) => T
): Record<string, T> {
  const obj = requiredRecord(ctx, value, fieldPath);
  const result: Record<string, T> = {};
  for (const [key, val] of Object.entries(obj)) {
    result[key] = elementValidator(ctx, val, joinFieldPath(fieldPath, key));
  }
  return result;
}

function validateSemanticSummary(ctx: FieldContext, value: JsonValue, fieldPath: string): SemanticSummary {
  const obj = requiredObject(ctx, value, fieldPath);
  return {
    available: requiredBoolean(ctx, requiredField(ctx, obj, "available", joinFieldPath(fieldPath, "available")), joinFieldPath(fieldPath, "available")),
    roles: requiredArray(ctx, requiredField(ctx, obj, "roles", joinFieldPath(fieldPath, "roles")), joinFieldPath(fieldPath, "roles")).map((item, i) =>
      validateSemanticRole(ctx, item, arrayFieldPath(joinFieldPath(fieldPath, "roles"), i))
    ),
    artifactRefs: requiredArray(
      ctx,
      requiredField(ctx, obj, "artifactRefs", joinFieldPath(fieldPath, "artifactRefs")),
      joinFieldPath(fieldPath, "artifactRefs")
    ).map((item, i) => validateSemanticArtifactRef(ctx, item, arrayFieldPath(joinFieldPath(fieldPath, "artifactRefs"), i))),
    evidenceRefs: requiredArray(
      ctx,
      requiredField(ctx, obj, "evidenceRefs", joinFieldPath(fieldPath, "evidenceRefs")),
      joinFieldPath(fieldPath, "evidenceRefs")
    ).map((item, i) => validateSemanticEvidenceRef(ctx, item, arrayFieldPath(joinFieldPath(fieldPath, "evidenceRefs"), i))),
    summariesByNode: validateRecordOf(
      ctx,
      requiredField(ctx, obj, "summariesByNode", joinFieldPath(fieldPath, "summariesByNode")),
      joinFieldPath(fieldPath, "summariesByNode"),
      validateSemanticSummaryEntry
    ),
    summariesByFile: validateRecordOf(
      ctx,
      requiredField(ctx, obj, "summariesByFile", joinFieldPath(fieldPath, "summariesByFile")),
      joinFieldPath(fieldPath, "summariesByFile"),
      validateSemanticSummaryEntry
    ),
    warnings: requiredStringArray(ctx, requiredField(ctx, obj, "warnings", joinFieldPath(fieldPath, "warnings")), joinFieldPath(fieldPath, "warnings"))
  };
}

function validateClassificationSummaryEntry(ctx: FieldContext, value: JsonValue, fieldPath: string): ClassificationSummaryEntry {
  const obj = requiredObject(ctx, value, fieldPath);
  return {
    classifications: requiredArray(
      ctx,
      requiredField(ctx, obj, "classifications", joinFieldPath(fieldPath, "classifications")),
      joinFieldPath(fieldPath, "classifications")
    ).map((item, i) => validateClassificationRole(ctx, item, arrayFieldPath(joinFieldPath(fieldPath, "classifications"), i))),
    editGuidance: requiredLiteral(
      ctx,
      requiredField(ctx, obj, "editGuidance", joinFieldPath(fieldPath, "editGuidance")),
      joinFieldPath(fieldPath, "editGuidance"),
      EDIT_GUIDANCES
    ),
    readiness: requiredLiteral(
      ctx,
      requiredField(ctx, obj, "readiness", joinFieldPath(fieldPath, "readiness")),
      joinFieldPath(fieldPath, "readiness"),
      READINESSES
    ),
    risks: requiredArray(ctx, requiredField(ctx, obj, "risks", joinFieldPath(fieldPath, "risks")), joinFieldPath(fieldPath, "risks")).map((item, i) =>
      requiredLiteral(ctx, item, arrayFieldPath(joinFieldPath(fieldPath, "risks"), i), RISK_LABELS)
    ),
    uncertainty: requiredLiteral(
      ctx,
      requiredField(ctx, obj, "uncertainty", joinFieldPath(fieldPath, "uncertainty")),
      joinFieldPath(fieldPath, "uncertainty"),
      UNCERTAINTY_TIERS
    ),
    warnings: requiredStringArray(ctx, requiredField(ctx, obj, "warnings", joinFieldPath(fieldPath, "warnings")), joinFieldPath(fieldPath, "warnings"))
  };
}

function validateClassificationSummary(ctx: FieldContext, value: JsonValue, fieldPath: string): ClassificationSummary {
  const obj = requiredObject(ctx, value, fieldPath);
  return {
    available: requiredBoolean(ctx, requiredField(ctx, obj, "available", joinFieldPath(fieldPath, "available")), joinFieldPath(fieldPath, "available")),
    classificationArtifactPath: requiredNullableString(
      ctx,
      requiredField(ctx, obj, "classificationArtifactPath", joinFieldPath(fieldPath, "classificationArtifactPath")),
      joinFieldPath(fieldPath, "classificationArtifactPath")
    ),
    roles: requiredArray(ctx, requiredField(ctx, obj, "roles", joinFieldPath(fieldPath, "roles")), joinFieldPath(fieldPath, "roles")).map((item, i) =>
      validateClassificationRole(ctx, item, arrayFieldPath(joinFieldPath(fieldPath, "roles"), i))
    ),
    refs: requiredArray(ctx, requiredField(ctx, obj, "refs", joinFieldPath(fieldPath, "refs")), joinFieldPath(fieldPath, "refs")).map((item, i) =>
      validateSemanticEvidenceRef(ctx, item, arrayFieldPath(joinFieldPath(fieldPath, "refs"), i))
    ) as SourceRef[],
    editGuidance: requiredArray(
      ctx,
      requiredField(ctx, obj, "editGuidance", joinFieldPath(fieldPath, "editGuidance")),
      joinFieldPath(fieldPath, "editGuidance")
    ).map((item, i) => requiredLiteral(ctx, item, arrayFieldPath(joinFieldPath(fieldPath, "editGuidance"), i), EDIT_GUIDANCES)),
    readiness: requiredArray(
      ctx,
      requiredField(ctx, obj, "readiness", joinFieldPath(fieldPath, "readiness")),
      joinFieldPath(fieldPath, "readiness")
    ).map((item, i) => requiredLiteral(ctx, item, arrayFieldPath(joinFieldPath(fieldPath, "readiness"), i), READINESSES)),
    riskLabels: requiredArray(
      ctx,
      requiredField(ctx, obj, "riskLabels", joinFieldPath(fieldPath, "riskLabels")),
      joinFieldPath(fieldPath, "riskLabels")
    ).map((item, i) => requiredLiteral(ctx, item, arrayFieldPath(joinFieldPath(fieldPath, "riskLabels"), i), RISK_LABELS)),
    uncertainty: requiredArray(
      ctx,
      requiredField(ctx, obj, "uncertainty", joinFieldPath(fieldPath, "uncertainty")),
      joinFieldPath(fieldPath, "uncertainty")
    ).map((item, i) => requiredLiteral(ctx, item, arrayFieldPath(joinFieldPath(fieldPath, "uncertainty"), i), UNCERTAINTY_TIERS)),
    summariesByNode: validateRecordOf(
      ctx,
      requiredField(ctx, obj, "summariesByNode", joinFieldPath(fieldPath, "summariesByNode")),
      joinFieldPath(fieldPath, "summariesByNode"),
      validateClassificationSummaryEntry
    ),
    summariesByFile: validateRecordOf(
      ctx,
      requiredField(ctx, obj, "summariesByFile", joinFieldPath(fieldPath, "summariesByFile")),
      joinFieldPath(fieldPath, "summariesByFile"),
      validateClassificationSummaryEntry
    ),
    warnings: requiredStringArray(ctx, requiredField(ctx, obj, "warnings", joinFieldPath(fieldPath, "warnings")), joinFieldPath(fieldPath, "warnings"))
  };
}

function validateArtifactReferenceSummaryEntry(ctx: FieldContext, value: JsonValue, fieldPath: string): ArtifactReferenceSummaryEntry {
  const obj = requiredObject(ctx, value, fieldPath);
  return {
    artifactKind: requiredString(
      ctx,
      requiredField(ctx, obj, "artifactKind", joinFieldPath(fieldPath, "artifactKind")),
      joinFieldPath(fieldPath, "artifactKind")
    ),
    artifactPath: requiredNullableString(
      ctx,
      requiredField(ctx, obj, "artifactPath", joinFieldPath(fieldPath, "artifactPath")),
      joinFieldPath(fieldPath, "artifactPath")
    ),
    available: requiredBoolean(ctx, requiredField(ctx, obj, "available", joinFieldPath(fieldPath, "available")), joinFieldPath(fieldPath, "available")),
    reason: requiredString(ctx, requiredField(ctx, obj, "reason", joinFieldPath(fieldPath, "reason")), joinFieldPath(fieldPath, "reason")),
    warnings: requiredStringArray(ctx, requiredField(ctx, obj, "warnings", joinFieldPath(fieldPath, "warnings")), joinFieldPath(fieldPath, "warnings"))
  };
}

function validatePruningCounts(ctx: FieldContext, value: JsonValue, fieldPath: string): PruningCounts {
  const obj = requiredObject(ctx, value, fieldPath);
  const reqInt = (key: string): number =>
    requiredNonnegativeInteger(ctx, requiredField(ctx, obj, key, joinFieldPath(fieldPath, key)), joinFieldPath(fieldPath, key));
  return {
    candidateFiles: reqInt("candidateFiles"),
    candidateNodes: reqInt("candidateNodes"),
    graphNodes: reqInt("graphNodes"),
    graphEdges: reqInt("graphEdges"),
    sourceSlices: reqInt("sourceSlices"),
    sourceBundles: reqInt("sourceBundles")
  };
}

function validatePruningCapSettings(ctx: FieldContext, value: JsonValue, fieldPath: string): PruningCapSettings {
  const obj = requiredObject(ctx, value, fieldPath);
  return {
    maxCandidateFiles: requiredNullableNumber(
      ctx,
      requiredField(ctx, obj, "maxCandidateFiles", joinFieldPath(fieldPath, "maxCandidateFiles")),
      joinFieldPath(fieldPath, "maxCandidateFiles")
    ),
    maxGraphNodes: requiredNullableNumber(
      ctx,
      requiredField(ctx, obj, "maxGraphNodes", joinFieldPath(fieldPath, "maxGraphNodes")),
      joinFieldPath(fieldPath, "maxGraphNodes")
    ),
    maxGraphEdges: requiredNullableNumber(
      ctx,
      requiredField(ctx, obj, "maxGraphEdges", joinFieldPath(fieldPath, "maxGraphEdges")),
      joinFieldPath(fieldPath, "maxGraphEdges")
    ),
    maxSourceSlices: requiredNumber(
      ctx,
      requiredField(ctx, obj, "maxSourceSlices", joinFieldPath(fieldPath, "maxSourceSlices")),
      joinFieldPath(fieldPath, "maxSourceSlices")
    )
  };
}

function validatePruningSummary(ctx: FieldContext, value: JsonValue, fieldPath: string): PruningSummary {
  const obj = requiredObject(ctx, value, fieldPath);
  return {
    policyVersion: requiredLiteral(
      ctx,
      requiredField(ctx, obj, "policyVersion", joinFieldPath(fieldPath, "policyVersion")),
      joinFieldPath(fieldPath, "policyVersion"),
      ["1.0.0"] as const
    ),
    retainedCounts: validatePruningCounts(
      ctx,
      requiredField(ctx, obj, "retainedCounts", joinFieldPath(fieldPath, "retainedCounts")),
      joinFieldPath(fieldPath, "retainedCounts")
    ),
    droppedCounts: validatePruningCounts(
      ctx,
      requiredField(ctx, obj, "droppedCounts", joinFieldPath(fieldPath, "droppedCounts")),
      joinFieldPath(fieldPath, "droppedCounts")
    ),
    capSettings: validatePruningCapSettings(
      ctx,
      requiredField(ctx, obj, "capSettings", joinFieldPath(fieldPath, "capSettings")),
      joinFieldPath(fieldPath, "capSettings")
    ),
    retainedReasons: requiredStringArray(
      ctx,
      requiredField(ctx, obj, "retainedReasons", joinFieldPath(fieldPath, "retainedReasons")),
      joinFieldPath(fieldPath, "retainedReasons")
    ),
    droppedReasons: requiredStringArray(
      ctx,
      requiredField(ctx, obj, "droppedReasons", joinFieldPath(fieldPath, "droppedReasons")),
      joinFieldPath(fieldPath, "droppedReasons")
    ),
    warnings: requiredStringArray(ctx, requiredField(ctx, obj, "warnings", joinFieldPath(fieldPath, "warnings")), joinFieldPath(fieldPath, "warnings"))
  };
}

function validateModeEffect(ctx: FieldContext, value: JsonValue, fieldPath: string): ModeEffect {
  const obj = requiredObject(ctx, value, fieldPath);
  return {
    candidateId: requiredString(
      ctx,
      requiredField(ctx, obj, "candidateId", joinFieldPath(fieldPath, "candidateId")),
      joinFieldPath(fieldPath, "candidateId")
    ),
    adjustment: requiredNumber(
      ctx,
      requiredField(ctx, obj, "adjustment", joinFieldPath(fieldPath, "adjustment")),
      joinFieldPath(fieldPath, "adjustment")
    ),
    reasons: requiredStringArray(ctx, requiredField(ctx, obj, "reasons", joinFieldPath(fieldPath, "reasons")), joinFieldPath(fieldPath, "reasons"))
  };
}

function validateModeEffects(ctx: FieldContext, value: JsonValue, fieldPath: string): ModeEffects {
  const obj = requiredObject(ctx, value, fieldPath);
  return {
    mode: requiredLiteral(
      ctx,
      requiredField(ctx, obj, "mode", joinFieldPath(fieldPath, "mode")),
      joinFieldPath(fieldPath, "mode"),
      CONTEXT_CAPSULE_MODES
    ) as ContextCapsuleMode,
    applied: requiredBoolean(ctx, requiredField(ctx, obj, "applied", joinFieldPath(fieldPath, "applied")), joinFieldPath(fieldPath, "applied")),
    effects: requiredArray(ctx, requiredField(ctx, obj, "effects", joinFieldPath(fieldPath, "effects")), joinFieldPath(fieldPath, "effects")).map(
      (item, i) => validateModeEffect(ctx, item, arrayFieldPath(joinFieldPath(fieldPath, "effects"), i))
    ),
    warnings: requiredStringArray(ctx, requiredField(ctx, obj, "warnings", joinFieldPath(fieldPath, "warnings")), joinFieldPath(fieldPath, "warnings"))
  };
}

function validateSourceControl(ctx: FieldContext, value: JsonValue, fieldPath: string): SourceControl {
  const obj = requiredObject(ctx, value, fieldPath);
  return {
    enabled: requiredBoolean(ctx, requiredField(ctx, obj, "enabled", joinFieldPath(fieldPath, "enabled")), joinFieldPath(fieldPath, "enabled")),
    reason: requiredString(ctx, requiredField(ctx, obj, "reason", joinFieldPath(fieldPath, "reason")), joinFieldPath(fieldPath, "reason"))
  };
}

function validateContextConflictCandidate(ctx: FieldContext, value: JsonValue, fieldPath: string): ContextConflictCandidate {
  const obj = requiredObject(ctx, value, fieldPath);
  return {
    nodeId: requiredString(ctx, requiredField(ctx, obj, "nodeId", joinFieldPath(fieldPath, "nodeId")), joinFieldPath(fieldPath, "nodeId")),
    filePath: requiredNullableString(
      ctx,
      requiredField(ctx, obj, "filePath", joinFieldPath(fieldPath, "filePath")),
      joinFieldPath(fieldPath, "filePath")
    ),
    score: requiredNumber(ctx, requiredField(ctx, obj, "score", joinFieldPath(fieldPath, "score")), joinFieldPath(fieldPath, "score")),
    editGuidance: requiredArray(
      ctx,
      requiredField(ctx, obj, "editGuidance", joinFieldPath(fieldPath, "editGuidance")),
      joinFieldPath(fieldPath, "editGuidance")
    ).map((item, i) => requiredLiteral(ctx, item, arrayFieldPath(joinFieldPath(fieldPath, "editGuidance"), i), EDIT_GUIDANCES))
  };
}

function validateContextConflict(ctx: FieldContext, value: JsonValue, fieldPath: string): ContextConflict {
  const obj = requiredObject(ctx, value, fieldPath);
  return {
    id: requiredString(ctx, requiredField(ctx, obj, "id", joinFieldPath(fieldPath, "id")), joinFieldPath(fieldPath, "id")),
    status: requiredLiteral(ctx, requiredField(ctx, obj, "status", joinFieldPath(fieldPath, "status")), joinFieldPath(fieldPath, "status"), [
      "conflict"
    ] as const),
    reason: requiredString(ctx, requiredField(ctx, obj, "reason", joinFieldPath(fieldPath, "reason")), joinFieldPath(fieldPath, "reason")),
    evidenceRefs: requiredStringArray(
      ctx,
      requiredField(ctx, obj, "evidenceRefs", joinFieldPath(fieldPath, "evidenceRefs")),
      joinFieldPath(fieldPath, "evidenceRefs")
    ),
    affectedFiles: requiredStringArray(
      ctx,
      requiredField(ctx, obj, "affectedFiles", joinFieldPath(fieldPath, "affectedFiles")),
      joinFieldPath(fieldPath, "affectedFiles")
    ),
    affectedNodes: requiredStringArray(
      ctx,
      requiredField(ctx, obj, "affectedNodes", joinFieldPath(fieldPath, "affectedNodes")),
      joinFieldPath(fieldPath, "affectedNodes")
    ),
    candidates: requiredArray(
      ctx,
      requiredField(ctx, obj, "candidates", joinFieldPath(fieldPath, "candidates")),
      joinFieldPath(fieldPath, "candidates")
    ).map((item, i) => validateContextConflictCandidate(ctx, item, arrayFieldPath(joinFieldPath(fieldPath, "candidates"), i))),
    recommendedNextAction: requiredString(
      ctx,
      requiredField(ctx, obj, "recommendedNextAction", joinFieldPath(fieldPath, "recommendedNextAction")),
      joinFieldPath(fieldPath, "recommendedNextAction")
    )
  };
}

function validateContextConflictSummary(ctx: FieldContext, value: JsonValue, fieldPath: string): ContextConflictSummary {
  const obj = requiredObject(ctx, value, fieldPath);
  return {
    status: requiredLiteral(ctx, requiredField(ctx, obj, "status", joinFieldPath(fieldPath, "status")), joinFieldPath(fieldPath, "status"), [
      "none",
      "conflict"
    ] as const),
    conflicts: requiredArray(
      ctx,
      requiredField(ctx, obj, "conflicts", joinFieldPath(fieldPath, "conflicts")),
      joinFieldPath(fieldPath, "conflicts")
    ).map((item, i) => validateContextConflict(ctx, item, arrayFieldPath(joinFieldPath(fieldPath, "conflicts"), i))),
    warnings: requiredStringArray(ctx, requiredField(ctx, obj, "warnings", joinFieldPath(fieldPath, "warnings")), joinFieldPath(fieldPath, "warnings"))
  };
}

function validateFocusFileResolution(ctx: FieldContext, value: JsonValue, fieldPath: string): FocusFileResolution {
  const obj = requiredObject(ctx, value, fieldPath);
  return {
    path: requiredString(ctx, requiredField(ctx, obj, "path", joinFieldPath(fieldPath, "path")), joinFieldPath(fieldPath, "path")),
    resolved: requiredBoolean(ctx, requiredField(ctx, obj, "resolved", joinFieldPath(fieldPath, "resolved")), joinFieldPath(fieldPath, "resolved")),
    matchedFilePaths: requiredStringArray(
      ctx,
      requiredField(ctx, obj, "matchedFilePaths", joinFieldPath(fieldPath, "matchedFilePaths")),
      joinFieldPath(fieldPath, "matchedFilePaths")
    ),
    containedSymbolIds: requiredStringArray(
      ctx,
      requiredField(ctx, obj, "containedSymbolIds", joinFieldPath(fieldPath, "containedSymbolIds")),
      joinFieldPath(fieldPath, "containedSymbolIds")
    )
  };
}

function validateFocusSymbolResolution(ctx: FieldContext, value: JsonValue, fieldPath: string): FocusSymbolResolution {
  const obj = requiredObject(ctx, value, fieldPath);
  return {
    symbol: requiredString(ctx, requiredField(ctx, obj, "symbol", joinFieldPath(fieldPath, "symbol")), joinFieldPath(fieldPath, "symbol")),
    resolved: requiredBoolean(ctx, requiredField(ctx, obj, "resolved", joinFieldPath(fieldPath, "resolved")), joinFieldPath(fieldPath, "resolved")),
    ambiguous: requiredBoolean(ctx, requiredField(ctx, obj, "ambiguous", joinFieldPath(fieldPath, "ambiguous")), joinFieldPath(fieldPath, "ambiguous")),
    matchedNodeIds: requiredStringArray(
      ctx,
      requiredField(ctx, obj, "matchedNodeIds", joinFieldPath(fieldPath, "matchedNodeIds")),
      joinFieldPath(fieldPath, "matchedNodeIds")
    )
  };
}

function validateContextFocusIntake(ctx: FieldContext, value: JsonValue, fieldPath: string): ContextFocusIntake {
  const obj = requiredObject(ctx, value, fieldPath);
  return {
    focusFiles: requiredArray(
      ctx,
      requiredField(ctx, obj, "focusFiles", joinFieldPath(fieldPath, "focusFiles")),
      joinFieldPath(fieldPath, "focusFiles")
    ).map((item, i) => validateFocusFileResolution(ctx, item, arrayFieldPath(joinFieldPath(fieldPath, "focusFiles"), i))),
    focusSymbols: requiredArray(
      ctx,
      requiredField(ctx, obj, "focusSymbols", joinFieldPath(fieldPath, "focusSymbols")),
      joinFieldPath(fieldPath, "focusSymbols")
    ).map((item, i) => validateFocusSymbolResolution(ctx, item, arrayFieldPath(joinFieldPath(fieldPath, "focusSymbols"), i))),
    unresolvedFocusFiles: requiredStringArray(
      ctx,
      requiredField(ctx, obj, "unresolvedFocusFiles", joinFieldPath(fieldPath, "unresolvedFocusFiles")),
      joinFieldPath(fieldPath, "unresolvedFocusFiles")
    ),
    unresolvedFocusSymbols: requiredStringArray(
      ctx,
      requiredField(ctx, obj, "unresolvedFocusSymbols", joinFieldPath(fieldPath, "unresolvedFocusSymbols")),
      joinFieldPath(fieldPath, "unresolvedFocusSymbols")
    ),
    ambiguousFocusSymbols: requiredStringArray(
      ctx,
      requiredField(ctx, obj, "ambiguousFocusSymbols", joinFieldPath(fieldPath, "ambiguousFocusSymbols")),
      joinFieldPath(fieldPath, "ambiguousFocusSymbols")
    ),
    warnings: requiredStringArray(ctx, requiredField(ctx, obj, "warnings", joinFieldPath(fieldPath, "warnings")), joinFieldPath(fieldPath, "warnings"))
  };
}

function validateChangedFileEntry(ctx: FieldContext, value: JsonValue, fieldPath: string): ChangedFileEntry {
  const obj = requiredObject(ctx, value, fieldPath);
  return {
    path: requiredString(ctx, requiredField(ctx, obj, "path", joinFieldPath(fieldPath, "path")), joinFieldPath(fieldPath, "path")),
    status: requiredLiteral(
      ctx,
      requiredField(ctx, obj, "status", joinFieldPath(fieldPath, "status")),
      joinFieldPath(fieldPath, "status"),
      CHANGED_SURFACE_STATUSES
    ),
    provenance: requiredLiteral(
      ctx,
      requiredField(ctx, obj, "provenance", joinFieldPath(fieldPath, "provenance")),
      joinFieldPath(fieldPath, "provenance"),
      CHANGED_SURFACE_PROVENANCES
    )
  };
}

function validateChangedSymbolEntry(ctx: FieldContext, value: JsonValue, fieldPath: string): ChangedSymbolEntry {
  const obj = requiredObject(ctx, value, fieldPath);
  const result: ChangedSymbolEntry = {
    symbolId: requiredString(ctx, requiredField(ctx, obj, "symbolId", joinFieldPath(fieldPath, "symbolId")), joinFieldPath(fieldPath, "symbolId")),
    status: requiredLiteral(
      ctx,
      requiredField(ctx, obj, "status", joinFieldPath(fieldPath, "status")),
      joinFieldPath(fieldPath, "status"),
      CHANGED_SURFACE_STATUSES
    ),
    provenance: requiredLiteral(
      ctx,
      requiredField(ctx, obj, "provenance", joinFieldPath(fieldPath, "provenance")),
      joinFieldPath(fieldPath, "provenance"),
      CHANGED_SURFACE_PROVENANCES
    )
  };
  if (optionalField(obj, "filePath") !== undefined) result.filePath = optionalString(ctx, obj.filePath, joinFieldPath(fieldPath, "filePath"));
  if (optionalField(obj, "name") !== undefined) result.name = optionalString(ctx, obj.name, joinFieldPath(fieldPath, "name"));
  if (optionalField(obj, "kind") !== undefined) result.kind = optionalString(ctx, obj.kind, joinFieldPath(fieldPath, "kind"));
  return result;
}

function validateChangedSurface(ctx: FieldContext, value: JsonValue, fieldPath: string): ChangedSurface {
  const obj = requiredObject(ctx, value, fieldPath);
  return {
    available: requiredBoolean(ctx, requiredField(ctx, obj, "available", joinFieldPath(fieldPath, "available")), joinFieldPath(fieldPath, "available")),
    diffRequested: requiredBoolean(
      ctx,
      requiredField(ctx, obj, "diffRequested", joinFieldPath(fieldPath, "diffRequested")),
      joinFieldPath(fieldPath, "diffRequested")
    ),
    files: requiredArray(ctx, requiredField(ctx, obj, "files", joinFieldPath(fieldPath, "files")), joinFieldPath(fieldPath, "files")).map((item, i) =>
      validateChangedFileEntry(ctx, item, arrayFieldPath(joinFieldPath(fieldPath, "files"), i))
    ),
    symbols: requiredArray(ctx, requiredField(ctx, obj, "symbols", joinFieldPath(fieldPath, "symbols")), joinFieldPath(fieldPath, "symbols")).map(
      (item, i) => validateChangedSymbolEntry(ctx, item, arrayFieldPath(joinFieldPath(fieldPath, "symbols"), i))
    ),
    conflicts: requiredStringArray(
      ctx,
      requiredField(ctx, obj, "conflicts", joinFieldPath(fieldPath, "conflicts")),
      joinFieldPath(fieldPath, "conflicts")
    ),
    warnings: requiredStringArray(ctx, requiredField(ctx, obj, "warnings", joinFieldPath(fieldPath, "warnings")), joinFieldPath(fieldPath, "warnings"))
  };
}

export function validateRoleContextSummary(ctx: FieldContext, value: JsonValue, fieldPath: string): RoleContextSummary {
  const obj = requiredObject(ctx, value, fieldPath);
  return {
    role: validateContextRole(ctx, requiredField(ctx, obj, "role", joinFieldPath(fieldPath, "role")), joinFieldPath(fieldPath, "role")),
    focus: validateContextFocusIntake(
      ctx,
      requiredField(ctx, obj, "focus", joinFieldPath(fieldPath, "focus")),
      joinFieldPath(fieldPath, "focus")
    ),
    changedSurface: validateChangedSurface(
      ctx,
      requiredField(ctx, obj, "changedSurface", joinFieldPath(fieldPath, "changedSurface")),
      joinFieldPath(fieldPath, "changedSurface")
    ),
    requestedEvidenceKinds: requiredArray(
      ctx,
      requiredField(ctx, obj, "requestedEvidenceKinds", joinFieldPath(fieldPath, "requestedEvidenceKinds")),
      joinFieldPath(fieldPath, "requestedEvidenceKinds")
    ).map((item, i) => requiredLiteral(ctx, item, arrayFieldPath(joinFieldPath(fieldPath, "requestedEvidenceKinds"), i), REQUESTED_EVIDENCE_KINDS)),
    unsupportedRequestedEvidenceKinds: requiredArray(
      ctx,
      requiredField(ctx, obj, "unsupportedRequestedEvidenceKinds", joinFieldPath(fieldPath, "unsupportedRequestedEvidenceKinds")),
      joinFieldPath(fieldPath, "unsupportedRequestedEvidenceKinds")
    ).map((item, i) =>
      requiredLiteral(ctx, item, arrayFieldPath(joinFieldPath(fieldPath, "unsupportedRequestedEvidenceKinds"), i), REQUESTED_EVIDENCE_KINDS)
    ),
    warnings: requiredStringArray(ctx, requiredField(ctx, obj, "warnings", joinFieldPath(fieldPath, "warnings")), joinFieldPath(fieldPath, "warnings"))
  };
}

function validateEvidenceItemSourceLocation(ctx: FieldContext, value: JsonValue, fieldPath: string): EvidenceItemSourceLocation {
  const obj = requiredObject(ctx, value, fieldPath);
  const result: EvidenceItemSourceLocation = {
    filePath: requiredString(ctx, requiredField(ctx, obj, "filePath", joinFieldPath(fieldPath, "filePath")), joinFieldPath(fieldPath, "filePath"))
  };
  if (optionalField(obj, "line") !== undefined) result.line = optionalNumber(ctx, obj.line, joinFieldPath(fieldPath, "line"));
  return result;
}

function validateEvidenceItemRef(ctx: FieldContext, value: JsonValue, fieldPath: string): EvidenceItemRef {
  const obj = requiredObject(ctx, value, fieldPath);
  const result: EvidenceItemRef = {
    id: requiredString(ctx, requiredField(ctx, obj, "id", joinFieldPath(fieldPath, "id")), joinFieldPath(fieldPath, "id")),
    itemKind: requiredLiteral(
      ctx,
      requiredField(ctx, obj, "itemKind", joinFieldPath(fieldPath, "itemKind")),
      joinFieldPath(fieldPath, "itemKind"),
      EVIDENCE_ITEM_KINDS
    ),
    relationship: requiredString(
      ctx,
      requiredField(ctx, obj, "relationship", joinFieldPath(fieldPath, "relationship")),
      joinFieldPath(fieldPath, "relationship")
    ),
    basis: requiredString(ctx, requiredField(ctx, obj, "basis", joinFieldPath(fieldPath, "basis")), joinFieldPath(fieldPath, "basis")),
    provenance: requiredString(
      ctx,
      requiredField(ctx, obj, "provenance", joinFieldPath(fieldPath, "provenance")),
      joinFieldPath(fieldPath, "provenance")
    )
  };
  if (optionalField(obj, "path") !== undefined) result.path = optionalString(ctx, obj.path, joinFieldPath(fieldPath, "path"));
  if (optionalField(obj, "symbolId") !== undefined) result.symbolId = optionalString(ctx, obj.symbolId, joinFieldPath(fieldPath, "symbolId"));
  if (optionalField(obj, "nodeId") !== undefined) result.nodeId = optionalString(ctx, obj.nodeId, joinFieldPath(fieldPath, "nodeId"));
  if (optionalField(obj, "sourceLocation") !== undefined)
    result.sourceLocation = validateEvidenceItemSourceLocation(ctx, obj.sourceLocation, joinFieldPath(fieldPath, "sourceLocation"));
  if (optionalField(obj, "metadata") !== undefined) {
    const recordObj = requiredRecord(ctx, obj.metadata, joinFieldPath(fieldPath, "metadata"));
    const record: Record<string, string | number | boolean | null> = {};
    for (const [key, val] of Object.entries(recordObj)) {
      record[key] = requiredScalarLike(ctx, val, joinFieldPath(joinFieldPath(fieldPath, "metadata"), key));
    }
    result.metadata = record;
  }
  return result;
}

function validateUnresolvedEvidenceItem(ctx: FieldContext, value: JsonValue, fieldPath: string): UnresolvedEvidenceItem {
  const obj = requiredObject(ctx, value, fieldPath);
  return {
    evidenceKind: requiredString(
      ctx,
      requiredField(ctx, obj, "evidenceKind", joinFieldPath(fieldPath, "evidenceKind")),
      joinFieldPath(fieldPath, "evidenceKind")
    ),
    role: validateContextRole(ctx, requiredField(ctx, obj, "role", joinFieldPath(fieldPath, "role")), joinFieldPath(fieldPath, "role")),
    basis: requiredString(ctx, requiredField(ctx, obj, "basis", joinFieldPath(fieldPath, "basis")), joinFieldPath(fieldPath, "basis")),
    reason: requiredString(ctx, requiredField(ctx, obj, "reason", joinFieldPath(fieldPath, "reason")), joinFieldPath(fieldPath, "reason")),
    blocking: requiredBoolean(ctx, requiredField(ctx, obj, "blocking", joinFieldPath(fieldPath, "blocking")), joinFieldPath(fieldPath, "blocking"))
  };
}

function validateEvidenceGroup(ctx: FieldContext, value: JsonValue, fieldPath: string): EvidenceGroup {
  const obj = requiredObject(ctx, value, fieldPath);
  return {
    id: requiredString(ctx, requiredField(ctx, obj, "id", joinFieldPath(fieldPath, "id")), joinFieldPath(fieldPath, "id")),
    kind: requiredLiteral(
      ctx,
      requiredField(ctx, obj, "kind", joinFieldPath(fieldPath, "kind")),
      joinFieldPath(fieldPath, "kind"),
      EVIDENCE_GROUP_KINDS
    ),
    role: validateContextRole(ctx, requiredField(ctx, obj, "role", joinFieldPath(fieldPath, "role")), joinFieldPath(fieldPath, "role")),
    title: requiredString(ctx, requiredField(ctx, obj, "title", joinFieldPath(fieldPath, "title")), joinFieldPath(fieldPath, "title")),
    required: requiredBoolean(ctx, requiredField(ctx, obj, "required", joinFieldPath(fieldPath, "required")), joinFieldPath(fieldPath, "required")),
    items: requiredArray(ctx, requiredField(ctx, obj, "items", joinFieldPath(fieldPath, "items")), joinFieldPath(fieldPath, "items")).map((item, i) =>
      validateEvidenceItemRef(ctx, item, arrayFieldPath(joinFieldPath(fieldPath, "items"), i))
    ),
    unresolved: requiredArray(
      ctx,
      requiredField(ctx, obj, "unresolved", joinFieldPath(fieldPath, "unresolved")),
      joinFieldPath(fieldPath, "unresolved")
    ).map((item, i) => validateUnresolvedEvidenceItem(ctx, item, arrayFieldPath(joinFieldPath(fieldPath, "unresolved"), i))),
    warnings: requiredStringArray(ctx, requiredField(ctx, obj, "warnings", joinFieldPath(fieldPath, "warnings")), joinFieldPath(fieldPath, "warnings")),
    limit: requiredNullableNumber(ctx, requiredField(ctx, obj, "limit", joinFieldPath(fieldPath, "limit")), joinFieldPath(fieldPath, "limit")),
    availableCount: requiredNonnegativeInteger(
      ctx,
      requiredField(ctx, obj, "availableCount", joinFieldPath(fieldPath, "availableCount")),
      joinFieldPath(fieldPath, "availableCount")
    ),
    usedCount: requiredNonnegativeInteger(
      ctx,
      requiredField(ctx, obj, "usedCount", joinFieldPath(fieldPath, "usedCount")),
      joinFieldPath(fieldPath, "usedCount")
    ),
    truncated: requiredBoolean(ctx, requiredField(ctx, obj, "truncated", joinFieldPath(fieldPath, "truncated")), joinFieldPath(fieldPath, "truncated")),
    droppedCount: requiredNonnegativeInteger(
      ctx,
      requiredField(ctx, obj, "droppedCount", joinFieldPath(fieldPath, "droppedCount")),
      joinFieldPath(fieldPath, "droppedCount")
    ),
    provenance: requiredString(
      ctx,
      requiredField(ctx, obj, "provenance", joinFieldPath(fieldPath, "provenance")),
      joinFieldPath(fieldPath, "provenance")
    )
  };
}

function validateTestConfigurationEvidenceEntry(ctx: FieldContext, value: JsonValue, fieldPath: string): TestConfigurationEvidenceEntry {
  const obj = requiredObject(ctx, value, fieldPath);
  const fieldsObj = requiredRecord(
    ctx,
    requiredField(ctx, obj, "fields", joinFieldPath(fieldPath, "fields")),
    joinFieldPath(fieldPath, "fields")
  );
  const fields: Record<string, string | number | boolean | string[] | null> = {};
  for (const [key, val] of Object.entries(fieldsObj)) {
    fields[key] = requiredScalarOrStringArrayLike(ctx, val, joinFieldPath(joinFieldPath(fieldPath, "fields"), key));
  }
  return {
    path: requiredString(ctx, requiredField(ctx, obj, "path", joinFieldPath(fieldPath, "path")), joinFieldPath(fieldPath, "path")),
    framework: requiredString(
      ctx,
      requiredField(ctx, obj, "framework", joinFieldPath(fieldPath, "framework")),
      joinFieldPath(fieldPath, "framework")
    ),
    supported: requiredBoolean(
      ctx,
      requiredField(ctx, obj, "supported", joinFieldPath(fieldPath, "supported")),
      joinFieldPath(fieldPath, "supported")
    ),
    fields,
    warnings: requiredStringArray(ctx, requiredField(ctx, obj, "warnings", joinFieldPath(fieldPath, "warnings")), joinFieldPath(fieldPath, "warnings"))
  };
}

function validatePackageScriptEvidenceEntry(ctx: FieldContext, value: JsonValue, fieldPath: string): PackageScriptEvidenceEntry {
  const obj = requiredObject(ctx, value, fieldPath);
  return {
    name: requiredString(ctx, requiredField(ctx, obj, "name", joinFieldPath(fieldPath, "name")), joinFieldPath(fieldPath, "name")),
    command: requiredString(ctx, requiredField(ctx, obj, "command", joinFieldPath(fieldPath, "command")), joinFieldPath(fieldPath, "command")),
    reason: requiredString(ctx, requiredField(ctx, obj, "reason", joinFieldPath(fieldPath, "reason")), joinFieldPath(fieldPath, "reason")),
    packageJsonPath: requiredString(
      ctx,
      requiredField(ctx, obj, "packageJsonPath", joinFieldPath(fieldPath, "packageJsonPath")),
      joinFieldPath(fieldPath, "packageJsonPath")
    )
  };
}

function validateTestCommandEvidenceEntry(ctx: FieldContext, value: JsonValue, fieldPath: string): TestCommandEvidenceEntry {
  const obj = requiredObject(ctx, value, fieldPath);
  const result: TestCommandEvidenceEntry = {
    commandText: requiredNullableString(
      ctx,
      requiredField(ctx, obj, "commandText", joinFieldPath(fieldPath, "commandText")),
      joinFieldPath(fieldPath, "commandText")
    ),
    commandSource: requiredString(
      ctx,
      requiredField(ctx, obj, "commandSource", joinFieldPath(fieldPath, "commandSource")),
      joinFieldPath(fieldPath, "commandSource")
    ),
    testFiles: requiredStringArray(
      ctx,
      requiredField(ctx, obj, "testFiles", joinFieldPath(fieldPath, "testFiles")),
      joinFieldPath(fieldPath, "testFiles")
    ),
    framework: requiredNullableString(
      ctx,
      requiredField(ctx, obj, "framework", joinFieldPath(fieldPath, "framework")),
      joinFieldPath(fieldPath, "framework")
    ),
    scope: requiredLiteral(
      ctx,
      requiredField(ctx, obj, "scope", joinFieldPath(fieldPath, "scope")),
      joinFieldPath(fieldPath, "scope"),
      TEST_COMMAND_SCOPES
    ),
    basis: requiredString(ctx, requiredField(ctx, obj, "basis", joinFieldPath(fieldPath, "basis")), joinFieldPath(fieldPath, "basis"))
  };
  if (optionalField(obj, "unresolvedReason") !== undefined)
    result.unresolvedReason = optionalString(ctx, obj.unresolvedReason, joinFieldPath(fieldPath, "unresolvedReason"));
  return result;
}

function validateTestInfrastructureSummary(ctx: FieldContext, value: JsonValue, fieldPath: string): TestInfrastructureSummary {
  const obj = requiredObject(ctx, value, fieldPath);
  const reqRefArray = (key: string): EvidenceItemRef[] =>
    requiredArray(ctx, requiredField(ctx, obj, key, joinFieldPath(fieldPath, key)), joinFieldPath(fieldPath, key)).map((item, i) =>
      validateEvidenceItemRef(ctx, item, arrayFieldPath(joinFieldPath(fieldPath, key), i))
    );
  return {
    relatedTests: reqRefArray("relatedTests"),
    fixtures: reqRefArray("fixtures"),
    factories: reqRefArray("factories"),
    mocks: reqRefArray("mocks"),
    setupFiles: reqRefArray("setupFiles"),
    testConfigurations: requiredArray(
      ctx,
      requiredField(ctx, obj, "testConfigurations", joinFieldPath(fieldPath, "testConfigurations")),
      joinFieldPath(fieldPath, "testConfigurations")
    ).map((item, i) => validateTestConfigurationEvidenceEntry(ctx, item, arrayFieldPath(joinFieldPath(fieldPath, "testConfigurations"), i))),
    packageScripts: requiredArray(
      ctx,
      requiredField(ctx, obj, "packageScripts", joinFieldPath(fieldPath, "packageScripts")),
      joinFieldPath(fieldPath, "packageScripts")
    ).map((item, i) => validatePackageScriptEvidenceEntry(ctx, item, arrayFieldPath(joinFieldPath(fieldPath, "packageScripts"), i))),
    testCommands: requiredArray(
      ctx,
      requiredField(ctx, obj, "testCommands", joinFieldPath(fieldPath, "testCommands")),
      joinFieldPath(fieldPath, "testCommands")
    ).map((item, i) => validateTestCommandEvidenceEntry(ctx, item, arrayFieldPath(joinFieldPath(fieldPath, "testCommands"), i))),
    unresolved: requiredArray(
      ctx,
      requiredField(ctx, obj, "unresolved", joinFieldPath(fieldPath, "unresolved")),
      joinFieldPath(fieldPath, "unresolved")
    ).map((item, i) => validateUnresolvedEvidenceItem(ctx, item, arrayFieldPath(joinFieldPath(fieldPath, "unresolved"), i))),
    warnings: requiredStringArray(ctx, requiredField(ctx, obj, "warnings", joinFieldPath(fieldPath, "warnings")), joinFieldPath(fieldPath, "warnings"))
  };
}

function validateGroupTruncationEntry(ctx: FieldContext, value: JsonValue, fieldPath: string): GroupTruncationEntry {
  const obj = requiredObject(ctx, value, fieldPath);
  return {
    groupId: requiredString(ctx, requiredField(ctx, obj, "groupId", joinFieldPath(fieldPath, "groupId")), joinFieldPath(fieldPath, "groupId")),
    limit: requiredNullableNumber(ctx, requiredField(ctx, obj, "limit", joinFieldPath(fieldPath, "limit")), joinFieldPath(fieldPath, "limit")),
    availableCount: requiredNonnegativeInteger(
      ctx,
      requiredField(ctx, obj, "availableCount", joinFieldPath(fieldPath, "availableCount")),
      joinFieldPath(fieldPath, "availableCount")
    ),
    usedCount: requiredNonnegativeInteger(
      ctx,
      requiredField(ctx, obj, "usedCount", joinFieldPath(fieldPath, "usedCount")),
      joinFieldPath(fieldPath, "usedCount")
    ),
    truncated: requiredBoolean(ctx, requiredField(ctx, obj, "truncated", joinFieldPath(fieldPath, "truncated")), joinFieldPath(fieldPath, "truncated")),
    droppedCount: requiredNonnegativeInteger(
      ctx,
      requiredField(ctx, obj, "droppedCount", joinFieldPath(fieldPath, "droppedCount")),
      joinFieldPath(fieldPath, "droppedCount")
    )
  };
}

export function validateProvenanceRecord(ctx: FieldContext, value: JsonValue, fieldPath: string): ProvenanceRecord {
  const obj = requiredObject(ctx, value, fieldPath);
  return {
    id: requiredString(ctx, requiredField(ctx, obj, "id", joinFieldPath(fieldPath, "id")), joinFieldPath(fieldPath, "id")),
    category: requiredLiteral(
      ctx,
      requiredField(ctx, obj, "category", joinFieldPath(fieldPath, "category")),
      joinFieldPath(fieldPath, "category"),
      PROVENANCE_CATEGORIES
    ),
    sourcePath: requiredNullableString(
      ctx,
      requiredField(ctx, obj, "sourcePath", joinFieldPath(fieldPath, "sourcePath")),
      joinFieldPath(fieldPath, "sourcePath")
    ),
    sourceId: requiredNullableString(
      ctx,
      requiredField(ctx, obj, "sourceId", joinFieldPath(fieldPath, "sourceId")),
      joinFieldPath(fieldPath, "sourceId")
    ),
    evidenceId: requiredString(
      ctx,
      requiredField(ctx, obj, "evidenceId", joinFieldPath(fieldPath, "evidenceId")),
      joinFieldPath(fieldPath, "evidenceId")
    ),
    relationshipBasis: requiredString(
      ctx,
      requiredField(ctx, obj, "relationshipBasis", joinFieldPath(fieldPath, "relationshipBasis")),
      joinFieldPath(fieldPath, "relationshipBasis")
    ),
    role: validateContextRole(ctx, requiredField(ctx, obj, "role", joinFieldPath(fieldPath, "role")), joinFieldPath(fieldPath, "role")),
    requestField: requiredNullableString(
      ctx,
      requiredField(ctx, obj, "requestField", joinFieldPath(fieldPath, "requestField")),
      joinFieldPath(fieldPath, "requestField")
    ),
    derivedByModule: requiredString(
      ctx,
      requiredField(ctx, obj, "derivedByModule", joinFieldPath(fieldPath, "derivedByModule")),
      joinFieldPath(fieldPath, "derivedByModule")
    )
  };
}

function validateResponsibilityMapping(ctx: FieldContext, value: JsonValue, fieldPath: string): ResponsibilityMapping {
  const obj = requiredObject(ctx, value, fieldPath);
  const reqRefArray = (key: string): EvidenceItemRef[] =>
    requiredArray(ctx, requiredField(ctx, obj, key, joinFieldPath(fieldPath, key)), joinFieldPath(fieldPath, key)).map((item, i) =>
      validateEvidenceItemRef(ctx, item, arrayFieldPath(joinFieldPath(fieldPath, key), i))
    );
  return {
    responsibilityId: requiredString(
      ctx,
      requiredField(ctx, obj, "responsibilityId", joinFieldPath(fieldPath, "responsibilityId")),
      joinFieldPath(fieldPath, "responsibilityId")
    ),
    behavior: requiredNullableString(
      ctx,
      requiredField(ctx, obj, "behavior", joinFieldPath(fieldPath, "behavior")),
      joinFieldPath(fieldPath, "behavior")
    ),
    invariant: requiredNullableString(
      ctx,
      requiredField(ctx, obj, "invariant", joinFieldPath(fieldPath, "invariant")),
      joinFieldPath(fieldPath, "invariant")
    ),
    criticality: requiredLiteral(
      ctx,
      requiredField(ctx, obj, "criticality", joinFieldPath(fieldPath, "criticality")),
      joinFieldPath(fieldPath, "criticality"),
      RESPONSIBILITY_CRITICALITIES
    ),
    productionSymbols: reqRefArray("productionSymbols"),
    contracts: reqRefArray("contracts"),
    validators: reqRefArray("validators"),
    constants: reqRefArray("constants"),
    errors: reqRefArray("errors"),
    sideEffectEvidence: reqRefArray("sideEffectEvidence"),
    proposedOrExistingTestFiles: reqRefArray("proposedOrExistingTestFiles"),
    reusableHelpers: reqRefArray("reusableHelpers"),
    oracleEvidence: reqRefArray("oracleEvidence"),
    testCommands: reqRefArray("testCommands"),
    mappingStatus: requiredLiteral(
      ctx,
      requiredField(ctx, obj, "mappingStatus", joinFieldPath(fieldPath, "mappingStatus")),
      joinFieldPath(fieldPath, "mappingStatus"),
      RESPONSIBILITY_MAPPING_STATUSES
    ),
    unresolvedReasons: requiredStringArray(
      ctx,
      requiredField(ctx, obj, "unresolvedReasons", joinFieldPath(fieldPath, "unresolvedReasons")),
      joinFieldPath(fieldPath, "unresolvedReasons")
    ),
    provenance: requiredArray(
      ctx,
      requiredField(ctx, obj, "provenance", joinFieldPath(fieldPath, "provenance")),
      joinFieldPath(fieldPath, "provenance")
    ).map((item, i) => validateProvenanceRecord(ctx, item, arrayFieldPath(joinFieldPath(fieldPath, "provenance"), i))),
    warnings: requiredStringArray(ctx, requiredField(ctx, obj, "warnings", joinFieldPath(fieldPath, "warnings")), joinFieldPath(fieldPath, "warnings"))
  };
}

export function validateResponsibilityMappingSummary(ctx: FieldContext, value: JsonValue, fieldPath: string): ResponsibilityMappingSummary {
  const obj = requiredObject(ctx, value, fieldPath);
  return {
    requested: requiredBoolean(
      ctx,
      requiredField(ctx, obj, "requested", joinFieldPath(fieldPath, "requested")),
      joinFieldPath(fieldPath, "requested")
    ),
    operational: requiredBoolean(
      ctx,
      requiredField(ctx, obj, "operational", joinFieldPath(fieldPath, "operational")),
      joinFieldPath(fieldPath, "operational")
    ),
    mappings: requiredArray(
      ctx,
      requiredField(ctx, obj, "mappings", joinFieldPath(fieldPath, "mappings")),
      joinFieldPath(fieldPath, "mappings")
    ).map((item, i) => validateResponsibilityMapping(ctx, item, arrayFieldPath(joinFieldPath(fieldPath, "mappings"), i))),
    unknownResponsibilityIds: requiredStringArray(
      ctx,
      requiredField(ctx, obj, "unknownResponsibilityIds", joinFieldPath(fieldPath, "unknownResponsibilityIds")),
      joinFieldPath(fieldPath, "unknownResponsibilityIds")
    ),
    duplicateResponsibilityIds: requiredStringArray(
      ctx,
      requiredField(ctx, obj, "duplicateResponsibilityIds", joinFieldPath(fieldPath, "duplicateResponsibilityIds")),
      joinFieldPath(fieldPath, "duplicateResponsibilityIds")
    ),
    limit: requiredNullableNumber(ctx, requiredField(ctx, obj, "limit", joinFieldPath(fieldPath, "limit")), joinFieldPath(fieldPath, "limit")),
    availableCount: requiredNonnegativeInteger(
      ctx,
      requiredField(ctx, obj, "availableCount", joinFieldPath(fieldPath, "availableCount")),
      joinFieldPath(fieldPath, "availableCount")
    ),
    usedCount: requiredNonnegativeInteger(
      ctx,
      requiredField(ctx, obj, "usedCount", joinFieldPath(fieldPath, "usedCount")),
      joinFieldPath(fieldPath, "usedCount")
    ),
    truncated: requiredBoolean(ctx, requiredField(ctx, obj, "truncated", joinFieldPath(fieldPath, "truncated")), joinFieldPath(fieldPath, "truncated")),
    droppedCount: requiredNonnegativeInteger(
      ctx,
      requiredField(ctx, obj, "droppedCount", joinFieldPath(fieldPath, "droppedCount")),
      joinFieldPath(fieldPath, "droppedCount")
    ),
    criticalDropped: requiredBoolean(
      ctx,
      requiredField(ctx, obj, "criticalDropped", joinFieldPath(fieldPath, "criticalDropped")),
      joinFieldPath(fieldPath, "criticalDropped")
    ),
    warnings: requiredStringArray(ctx, requiredField(ctx, obj, "warnings", joinFieldPath(fieldPath, "warnings")), joinFieldPath(fieldPath, "warnings"))
  };
}

function validateFreshnessComparedIdentity(ctx: FieldContext, value: JsonValue, fieldPath: string): FreshnessComparedIdentity {
  const obj = requiredObject(ctx, value, fieldPath);
  return {
    label: requiredString(ctx, requiredField(ctx, obj, "label", joinFieldPath(fieldPath, "label")), joinFieldPath(fieldPath, "label")),
    value: requiredNullableString(
      ctx,
      requiredField(ctx, obj, "value", joinFieldPath(fieldPath, "value")),
      joinFieldPath(fieldPath, "value")
    )
  };
}

export function validateFreshnessSummary(ctx: FieldContext, value: JsonValue, fieldPath: string): FreshnessSummary {
  const obj = requiredObject(ctx, value, fieldPath);
  return {
    state: requiredLiteral(
      ctx,
      requiredField(ctx, obj, "state", joinFieldPath(fieldPath, "state")),
      joinFieldPath(fieldPath, "state"),
      FRESHNESS_STATES
    ),
    role: validateContextRole(ctx, requiredField(ctx, obj, "role", joinFieldPath(fieldPath, "role")), joinFieldPath(fieldPath, "role")),
    evidenceUsed: requiredStringArray(
      ctx,
      requiredField(ctx, obj, "evidenceUsed", joinFieldPath(fieldPath, "evidenceUsed")),
      joinFieldPath(fieldPath, "evidenceUsed")
    ),
    evidenceUnavailable: requiredStringArray(
      ctx,
      requiredField(ctx, obj, "evidenceUnavailable", joinFieldPath(fieldPath, "evidenceUnavailable")),
      joinFieldPath(fieldPath, "evidenceUnavailable")
    ),
    comparedIdentities: requiredArray(
      ctx,
      requiredField(ctx, obj, "comparedIdentities", joinFieldPath(fieldPath, "comparedIdentities")),
      joinFieldPath(fieldPath, "comparedIdentities")
    ).map((item, i) => validateFreshnessComparedIdentity(ctx, item, arrayFieldPath(joinFieldPath(fieldPath, "comparedIdentities"), i))),
    reason: requiredString(ctx, requiredField(ctx, obj, "reason", joinFieldPath(fieldPath, "reason")), joinFieldPath(fieldPath, "reason")),
    relevantChangedPaths: requiredStringArray(
      ctx,
      requiredField(ctx, obj, "relevantChangedPaths", joinFieldPath(fieldPath, "relevantChangedPaths")),
      joinFieldPath(fieldPath, "relevantChangedPaths")
    ),
    warnings: requiredStringArray(ctx, requiredField(ctx, obj, "warnings", joinFieldPath(fieldPath, "warnings")), joinFieldPath(fieldPath, "warnings"))
  };
}

function validateBudgetLimitUsage(ctx: FieldContext, value: JsonValue, fieldPath: string): BudgetLimitUsage {
  const obj = requiredObject(ctx, value, fieldPath);
  return {
    name: requiredString(ctx, requiredField(ctx, obj, "name", joinFieldPath(fieldPath, "name")), joinFieldPath(fieldPath, "name")),
    declaredValue: requiredNullableNumber(
      ctx,
      requiredField(ctx, obj, "declaredValue", joinFieldPath(fieldPath, "declaredValue")),
      joinFieldPath(fieldPath, "declaredValue")
    ),
    usedValue: requiredNumber(
      ctx,
      requiredField(ctx, obj, "usedValue", joinFieldPath(fieldPath, "usedValue")),
      joinFieldPath(fieldPath, "usedValue")
    ),
    availableCount: requiredNullableNumber(
      ctx,
      requiredField(ctx, obj, "availableCount", joinFieldPath(fieldPath, "availableCount")),
      joinFieldPath(fieldPath, "availableCount")
    ),
    droppedCount: requiredNullableNumber(
      ctx,
      requiredField(ctx, obj, "droppedCount", joinFieldPath(fieldPath, "droppedCount")),
      joinFieldPath(fieldPath, "droppedCount")
    ),
    truncated: requiredBoolean(ctx, requiredField(ctx, obj, "truncated", joinFieldPath(fieldPath, "truncated")), joinFieldPath(fieldPath, "truncated")),
    requiredEvidenceAffected: requiredBoolean(
      ctx,
      requiredField(ctx, obj, "requiredEvidenceAffected", joinFieldPath(fieldPath, "requiredEvidenceAffected")),
      joinFieldPath(fieldPath, "requiredEvidenceAffected")
    ),
    adequacyImpact: requiredNullableString(
      ctx,
      requiredField(ctx, obj, "adequacyImpact", joinFieldPath(fieldPath, "adequacyImpact")),
      joinFieldPath(fieldPath, "adequacyImpact")
    )
  };
}

function validateBudgetCharacterUsage(ctx: FieldContext, value: JsonValue, fieldPath: string): BudgetCharacterUsage {
  const obj = requiredObject(ctx, value, fieldPath);
  return {
    measured: requiredNumber(
      ctx,
      requiredField(ctx, obj, "measured", joinFieldPath(fieldPath, "measured")),
      joinFieldPath(fieldPath, "measured")
    ),
    limit: requiredNullableNumber(ctx, requiredField(ctx, obj, "limit", joinFieldPath(fieldPath, "limit")), joinFieldPath(fieldPath, "limit")),
    truncated: requiredBoolean(ctx, requiredField(ctx, obj, "truncated", joinFieldPath(fieldPath, "truncated")), joinFieldPath(fieldPath, "truncated"))
  };
}

export function validateBudgetSummary(ctx: FieldContext, value: JsonValue, fieldPath: string): BudgetSummary {
  const obj = requiredObject(ctx, value, fieldPath);
  const charactersValue = requiredField(ctx, obj, "characters", joinFieldPath(fieldPath, "characters"));
  return {
    limits: requiredArray(
      ctx,
      requiredField(ctx, obj, "limits", joinFieldPath(fieldPath, "limits")),
      joinFieldPath(fieldPath, "limits")
    ).map((item, i) => validateBudgetLimitUsage(ctx, item, arrayFieldPath(joinFieldPath(fieldPath, "limits"), i))),
    characters: charactersValue === null ? null : validateBudgetCharacterUsage(ctx, charactersValue, joinFieldPath(fieldPath, "characters")),
    warnings: requiredStringArray(ctx, requiredField(ctx, obj, "warnings", joinFieldPath(fieldPath, "warnings")), joinFieldPath(fieldPath, "warnings"))
  };
}

function validateCapsuleTruncationRecord(ctx: FieldContext, value: JsonValue, fieldPath: string): TruncationRecord {
  const obj = requiredObject(ctx, value, fieldPath);
  return {
    id: requiredString(ctx, requiredField(ctx, obj, "id", joinFieldPath(fieldPath, "id")), joinFieldPath(fieldPath, "id")),
    affectedGroup: requiredString(
      ctx,
      requiredField(ctx, obj, "affectedGroup", joinFieldPath(fieldPath, "affectedGroup")),
      joinFieldPath(fieldPath, "affectedGroup")
    ),
    limit: requiredNullableNumber(ctx, requiredField(ctx, obj, "limit", joinFieldPath(fieldPath, "limit")), joinFieldPath(fieldPath, "limit")),
    used: requiredNumber(ctx, requiredField(ctx, obj, "used", joinFieldPath(fieldPath, "used")), joinFieldPath(fieldPath, "used")),
    available: requiredNumber(
      ctx,
      requiredField(ctx, obj, "available", joinFieldPath(fieldPath, "available")),
      joinFieldPath(fieldPath, "available")
    ),
    droppedCount: requiredNonnegativeInteger(
      ctx,
      requiredField(ctx, obj, "droppedCount", joinFieldPath(fieldPath, "droppedCount")),
      joinFieldPath(fieldPath, "droppedCount")
    ),
    droppedEvidenceIds: requiredStringArray(
      ctx,
      requiredField(ctx, obj, "droppedEvidenceIds", joinFieldPath(fieldPath, "droppedEvidenceIds")),
      joinFieldPath(fieldPath, "droppedEvidenceIds")
    ),
    requiredEvidenceLost: requiredBoolean(
      ctx,
      requiredField(ctx, obj, "requiredEvidenceLost", joinFieldPath(fieldPath, "requiredEvidenceLost")),
      joinFieldPath(fieldPath, "requiredEvidenceLost")
    ),
    adequacyImpact: requiredNullableString(
      ctx,
      requiredField(ctx, obj, "adequacyImpact", joinFieldPath(fieldPath, "adequacyImpact")),
      joinFieldPath(fieldPath, "adequacyImpact")
    ),
    reason: requiredString(ctx, requiredField(ctx, obj, "reason", joinFieldPath(fieldPath, "reason")), joinFieldPath(fieldPath, "reason"))
  };
}

export function validateTruncationSummary(ctx: FieldContext, value: JsonValue, fieldPath: string): TruncationSummary {
  const obj = requiredObject(ctx, value, fieldPath);
  return {
    truncated: requiredBoolean(ctx, requiredField(ctx, obj, "truncated", joinFieldPath(fieldPath, "truncated")), joinFieldPath(fieldPath, "truncated")),
    records: requiredArray(
      ctx,
      requiredField(ctx, obj, "records", joinFieldPath(fieldPath, "records")),
      joinFieldPath(fieldPath, "records")
    ).map((item, i) => validateCapsuleTruncationRecord(ctx, item, arrayFieldPath(joinFieldPath(fieldPath, "records"), i))),
    warnings: requiredStringArray(ctx, requiredField(ctx, obj, "warnings", joinFieldPath(fieldPath, "warnings")), joinFieldPath(fieldPath, "warnings"))
  };
}

function validateFullFileFallbackRecord(ctx: FieldContext, value: JsonValue, fieldPath: string): FullFileFallbackRecord {
  const obj = requiredObject(ctx, value, fieldPath);
  return {
    id: requiredString(ctx, requiredField(ctx, obj, "id", joinFieldPath(fieldPath, "id")), joinFieldPath(fieldPath, "id")),
    filePath: requiredString(ctx, requiredField(ctx, obj, "filePath", joinFieldPath(fieldPath, "filePath")), joinFieldPath(fieldPath, "filePath")),
    reason: requiredString(ctx, requiredField(ctx, obj, "reason", joinFieldPath(fieldPath, "reason")), joinFieldPath(fieldPath, "reason")),
    requestedEvidenceKind: requiredNullableString(
      ctx,
      requiredField(ctx, obj, "requestedEvidenceKind", joinFieldPath(fieldPath, "requestedEvidenceKind")),
      joinFieldPath(fieldPath, "requestedEvidenceKind")
    ),
    boundedRetrievalAttempted: requiredBoolean(
      ctx,
      requiredField(ctx, obj, "boundedRetrievalAttempted", joinFieldPath(fieldPath, "boundedRetrievalAttempted")),
      joinFieldPath(fieldPath, "boundedRetrievalAttempted")
    ),
    sourceRangesAttempted: requiredNonnegativeInteger(
      ctx,
      requiredField(ctx, obj, "sourceRangesAttempted", joinFieldPath(fieldPath, "sourceRangesAttempted")),
      joinFieldPath(fieldPath, "sourceRangesAttempted")
    ),
    includedLineCount: requiredNonnegativeInteger(
      ctx,
      requiredField(ctx, obj, "includedLineCount", joinFieldPath(fieldPath, "includedLineCount")),
      joinFieldPath(fieldPath, "includedLineCount")
    ),
    includedCharacterCount: requiredNonnegativeInteger(
      ctx,
      requiredField(ctx, obj, "includedCharacterCount", joinFieldPath(fieldPath, "includedCharacterCount")),
      joinFieldPath(fieldPath, "includedCharacterCount")
    ),
    role: validateContextRole(ctx, requiredField(ctx, obj, "role", joinFieldPath(fieldPath, "role")), joinFieldPath(fieldPath, "role")),
    responsibilityIdsAffected: requiredStringArray(
      ctx,
      requiredField(ctx, obj, "responsibilityIdsAffected", joinFieldPath(fieldPath, "responsibilityIdsAffected")),
      joinFieldPath(fieldPath, "responsibilityIdsAffected")
    ),
    allowed: requiredBoolean(ctx, requiredField(ctx, obj, "allowed", joinFieldPath(fieldPath, "allowed")), joinFieldPath(fieldPath, "allowed")),
    provenance: requiredString(
      ctx,
      requiredField(ctx, obj, "provenance", joinFieldPath(fieldPath, "provenance")),
      joinFieldPath(fieldPath, "provenance")
    )
  };
}

export function validateFullFileFallbackSummary(ctx: FieldContext, value: JsonValue, fieldPath: string): FullFileFallbackSummary {
  const obj = requiredObject(ctx, value, fieldPath);
  return {
    enabled: requiredBoolean(ctx, requiredField(ctx, obj, "enabled", joinFieldPath(fieldPath, "enabled")), joinFieldPath(fieldPath, "enabled")),
    limit: requiredNullableNumber(ctx, requiredField(ctx, obj, "limit", joinFieldPath(fieldPath, "limit")), joinFieldPath(fieldPath, "limit")),
    used: requiredNonnegativeInteger(
      ctx,
      requiredField(ctx, obj, "used", joinFieldPath(fieldPath, "used")),
      joinFieldPath(fieldPath, "used")
    ),
    fallbacks: requiredArray(
      ctx,
      requiredField(ctx, obj, "fallbacks", joinFieldPath(fieldPath, "fallbacks")),
      joinFieldPath(fieldPath, "fallbacks")
    ).map((item, i) => validateFullFileFallbackRecord(ctx, item, arrayFieldPath(joinFieldPath(fieldPath, "fallbacks"), i))),
    warnings: requiredStringArray(ctx, requiredField(ctx, obj, "warnings", joinFieldPath(fieldPath, "warnings")), joinFieldPath(fieldPath, "warnings"))
  };
}

export function validateRoleAdequacyStatement(ctx: FieldContext, value: JsonValue, fieldPath: string): RoleAdequacyStatement {
  const obj = requiredObject(ctx, value, fieldPath);
  return {
    role: validateContextRole(ctx, requiredField(ctx, obj, "role", joinFieldPath(fieldPath, "role")), joinFieldPath(fieldPath, "role")),
    status: requiredLiteral(
      ctx,
      requiredField(ctx, obj, "status", joinFieldPath(fieldPath, "status")),
      joinFieldPath(fieldPath, "status"),
      CONTEXT_ADEQUACY_STATUSES
    ) as ContextAdequacyStatus,
    requiredConditions: requiredStringArray(
      ctx,
      requiredField(ctx, obj, "requiredConditions", joinFieldPath(fieldPath, "requiredConditions")),
      joinFieldPath(fieldPath, "requiredConditions")
    ),
    satisfiedConditions: requiredStringArray(
      ctx,
      requiredField(ctx, obj, "satisfiedConditions", joinFieldPath(fieldPath, "satisfiedConditions")),
      joinFieldPath(fieldPath, "satisfiedConditions")
    ),
    missingConditions: requiredStringArray(
      ctx,
      requiredField(ctx, obj, "missingConditions", joinFieldPath(fieldPath, "missingConditions")),
      joinFieldPath(fieldPath, "missingConditions")
    ),
    blockingConditions: requiredStringArray(
      ctx,
      requiredField(ctx, obj, "blockingConditions", joinFieldPath(fieldPath, "blockingConditions")),
      joinFieldPath(fieldPath, "blockingConditions")
    ),
    warnings: requiredStringArray(ctx, requiredField(ctx, obj, "warnings", joinFieldPath(fieldPath, "warnings")), joinFieldPath(fieldPath, "warnings")),
    supportingEvidence: requiredStringArray(
      ctx,
      requiredField(ctx, obj, "supportingEvidence", joinFieldPath(fieldPath, "supportingEvidence")),
      joinFieldPath(fieldPath, "supportingEvidence")
    ),
    affectedResponsibilityIds: requiredStringArray(
      ctx,
      requiredField(ctx, obj, "affectedResponsibilityIds", joinFieldPath(fieldPath, "affectedResponsibilityIds")),
      joinFieldPath(fieldPath, "affectedResponsibilityIds")
    ),
    truncationImpact: requiredBoolean(
      ctx,
      requiredField(ctx, obj, "truncationImpact", joinFieldPath(fieldPath, "truncationImpact")),
      joinFieldPath(fieldPath, "truncationImpact")
    ),
    freshnessImpact: requiredBoolean(
      ctx,
      requiredField(ctx, obj, "freshnessImpact", joinFieldPath(fieldPath, "freshnessImpact")),
      joinFieldPath(fieldPath, "freshnessImpact")
    )
  };
}

function validateContextCapsuleArtifactRef(ctx: FieldContext, value: JsonValue, fieldPath: string): ContextCapsuleArtifactRef {
  const obj = requiredObject(ctx, value, fieldPath);
  return {
    name: requiredString(ctx, requiredField(ctx, obj, "name", joinFieldPath(fieldPath, "name")), joinFieldPath(fieldPath, "name")),
    path: requiredString(ctx, requiredField(ctx, obj, "path", joinFieldPath(fieldPath, "path")), joinFieldPath(fieldPath, "path"))
  };
}

function validateContextCapsuleIndex(ctx: FieldContext, value: JsonValue, fieldPath: string): ContextCapsuleIndex {
  const obj = requiredObject(ctx, value, fieldPath);
  const result: ContextCapsuleIndex = {
    indexPath: requiredString(
      ctx,
      requiredField(ctx, obj, "indexPath", joinFieldPath(fieldPath, "indexPath")),
      joinFieldPath(fieldPath, "indexPath")
    ),
    manifestPath: requiredString(
      ctx,
      requiredField(ctx, obj, "manifestPath", joinFieldPath(fieldPath, "manifestPath")),
      joinFieldPath(fieldPath, "manifestPath")
    ),
    artifactRefs: requiredArray(
      ctx,
      requiredField(ctx, obj, "artifactRefs", joinFieldPath(fieldPath, "artifactRefs")),
      joinFieldPath(fieldPath, "artifactRefs")
    ).map((item, i) => validateContextCapsuleArtifactRef(ctx, item, arrayFieldPath(joinFieldPath(fieldPath, "artifactRefs"), i)))
  };
  if (optionalField(obj, "manifestSchemaVersion") !== undefined)
    result.manifestSchemaVersion = optionalString(ctx, obj.manifestSchemaVersion, joinFieldPath(fieldPath, "manifestSchemaVersion"));
  if (optionalField(obj, "projectRoot") !== undefined)
    result.projectRoot = optionalString(ctx, obj.projectRoot, joinFieldPath(fieldPath, "projectRoot"));
  return result;
}

function validateContextCapsuleLimits(ctx: FieldContext, value: JsonValue, fieldPath: string): ContextCapsuleLimits {
  const obj = requiredObject(ctx, value, fieldPath);
  return {
    maxCandidateFiles: requiredNullableNumber(
      ctx,
      requiredField(ctx, obj, "maxCandidateFiles", joinFieldPath(fieldPath, "maxCandidateFiles")),
      joinFieldPath(fieldPath, "maxCandidateFiles")
    ),
    maxSourceSlices: requiredNullableNumber(
      ctx,
      requiredField(ctx, obj, "maxSourceSlices", joinFieldPath(fieldPath, "maxSourceSlices")),
      joinFieldPath(fieldPath, "maxSourceSlices")
    ),
    maxGraphNodes: requiredNullableNumber(
      ctx,
      requiredField(ctx, obj, "maxGraphNodes", joinFieldPath(fieldPath, "maxGraphNodes")),
      joinFieldPath(fieldPath, "maxGraphNodes")
    ),
    maxGraphEdges: requiredNullableNumber(
      ctx,
      requiredField(ctx, obj, "maxGraphEdges", joinFieldPath(fieldPath, "maxGraphEdges")),
      joinFieldPath(fieldPath, "maxGraphEdges")
    )
  };
}

export function validateContextCapsuleRequest(ctx: FieldContext, value: JsonValue, fieldPath: string) {
  const obj = requiredObject(ctx, value, fieldPath);
  return {
    originalQuery: requiredString(
      ctx,
      requiredField(ctx, obj, "originalQuery", joinFieldPath(fieldPath, "originalQuery")),
      joinFieldPath(fieldPath, "originalQuery")
    ),
    normalizedQuery: requiredString(
      ctx,
      requiredField(ctx, obj, "normalizedQuery", joinFieldPath(fieldPath, "normalizedQuery")),
      joinFieldPath(fieldPath, "normalizedQuery")
    ),
    mode: requiredLiteral(
      ctx,
      requiredField(ctx, obj, "mode", joinFieldPath(fieldPath, "mode")),
      joinFieldPath(fieldPath, "mode"),
      CONTEXT_CAPSULE_MODES
    ) as ContextCapsuleMode,
    requestedOutputPath: requiredString(
      ctx,
      requiredField(ctx, obj, "requestedOutputPath", joinFieldPath(fieldPath, "requestedOutputPath")),
      joinFieldPath(fieldPath, "requestedOutputPath")
    ),
    role: validateContextRole(ctx, requiredField(ctx, obj, "role", joinFieldPath(fieldPath, "role")), joinFieldPath(fieldPath, "role")),
    requestFilePath: requiredNullableString(
      ctx,
      requiredField(ctx, obj, "requestFilePath", joinFieldPath(fieldPath, "requestFilePath")),
      joinFieldPath(fieldPath, "requestFilePath")
    )
  };
}

function validateContextCapsuleTool(ctx: FieldContext, value: JsonValue, fieldPath: string) {
  const obj = requiredObject(ctx, value, fieldPath);
  return {
    name: requiredString(ctx, requiredField(ctx, obj, "name", joinFieldPath(fieldPath, "name")), joinFieldPath(fieldPath, "name")),
    version: requiredString(ctx, requiredField(ctx, obj, "version", joinFieldPath(fieldPath, "version")), joinFieldPath(fieldPath, "version"))
  };
}

export function validateMyDevKitContextCapsuleV1(value: JsonObject, sourcePath: string): UpstreamArtifactReadResult<ContextCapsule> {
  const ctx: FieldContext = { artifactKind: ARTIFACT_KIND, sourcePath };
  try {
    const schemaVersionResult = parseSupportedMajorOneSchemaVersion(
      requiredField(ctx, value, "schemaVersion", "schemaVersion"),
      ARTIFACT_KIND,
      sourcePath
    );
    if ("ok" in schemaVersionResult) return schemaVersionResult;

    const capsule: ContextCapsule = {
      schemaVersion: requiredString(ctx, value.schemaVersion, "schemaVersion") as "1.0.0",
      generatedAt: requiredString(ctx, requiredField(ctx, value, "generatedAt", "generatedAt"), "generatedAt"),
      tool: validateContextCapsuleTool(ctx, requiredField(ctx, value, "tool", "tool"), "tool"),
      request: validateContextCapsuleRequest(ctx, requiredField(ctx, value, "request", "request"), "request"),
      index: validateContextCapsuleIndex(ctx, requiredField(ctx, value, "index", "index"), "index"),
      limits: validateContextCapsuleLimits(ctx, requiredField(ctx, value, "limits", "limits"), "limits"),
      requiredContext: requiredArray(ctx, requiredField(ctx, value, "requiredContext", "requiredContext"), "requiredContext").map((item, i) =>
        validateContextEntry(ctx, item, arrayFieldPath("requiredContext", i))
      ),
      optionalSupportContext: requiredArray(
        ctx,
        requiredField(ctx, value, "optionalSupportContext", "optionalSupportContext"),
        "optionalSupportContext"
      ).map((item, i) => validateContextEntry(ctx, item, arrayFieldPath("optionalSupportContext", i))),
      droppedContext: requiredArray(ctx, requiredField(ctx, value, "droppedContext", "droppedContext"), "droppedContext").map((item, i) =>
        validateDroppedContextEntry(ctx, item, arrayFieldPath("droppedContext", i))
      ),
      warnings: requiredStringArray(ctx, requiredField(ctx, value, "warnings", "warnings"), "warnings"),
      contextAdequacy: validateContextAdequacyStatement(ctx, requiredField(ctx, value, "contextAdequacy", "contextAdequacy"), "contextAdequacy"),
      queryPlan: validateQueryPlan(ctx, requiredField(ctx, value, "queryPlan", "queryPlan"), "queryPlan"),
      candidateFiles: requiredArray(ctx, requiredField(ctx, value, "candidateFiles", "candidateFiles"), "candidateFiles").map((item, i) =>
        validateCandidateFile(ctx, item, arrayFieldPath("candidateFiles", i))
      ),
      candidateNodes: requiredArray(ctx, requiredField(ctx, value, "candidateNodes", "candidateNodes"), "candidateNodes").map((item, i) =>
        validateCandidateNode(ctx, item, arrayFieldPath("candidateNodes", i))
      ),
      focus: validateContextFocus(ctx, requiredField(ctx, value, "focus", "focus"), "focus"),
      selectedGraph: validateSelectedGraph(ctx, requiredField(ctx, value, "selectedGraph", "selectedGraph"), "selectedGraph"),
      retention: validateRetentionSummary(ctx, requiredField(ctx, value, "retention", "retention"), "retention"),
      selectedSource: validateSelectedSource(ctx, requiredField(ctx, value, "selectedSource", "selectedSource"), "selectedSource"),
      selectedSourceBundles: validateSelectedSourceBundles(
        ctx,
        requiredField(ctx, value, "selectedSourceBundles", "selectedSourceBundles"),
        "selectedSourceBundles"
      ),
      semanticSummary: validateSemanticSummary(ctx, requiredField(ctx, value, "semanticSummary", "semanticSummary"), "semanticSummary"),
      classificationSummary: validateClassificationSummary(
        ctx,
        requiredField(ctx, value, "classificationSummary", "classificationSummary"),
        "classificationSummary"
      ),
      artifactReferenceSummary: requiredArray(
        ctx,
        requiredField(ctx, value, "artifactReferenceSummary", "artifactReferenceSummary"),
        "artifactReferenceSummary"
      ).map((item, i) => validateArtifactReferenceSummaryEntry(ctx, item, arrayFieldPath("artifactReferenceSummary", i))),
      pruning: validatePruningSummary(ctx, requiredField(ctx, value, "pruning", "pruning"), "pruning"),
      conflicts: validateContextConflictSummary(ctx, requiredField(ctx, value, "conflicts", "conflicts"), "conflicts"),
      modeEffects: validateModeEffects(ctx, requiredField(ctx, value, "modeEffects", "modeEffects"), "modeEffects"),
      sourceControl: validateSourceControl(ctx, requiredField(ctx, value, "sourceControl", "sourceControl"), "sourceControl"),
      deferredRequestFields: requiredStringArray(
        ctx,
        requiredField(ctx, value, "deferredRequestFields", "deferredRequestFields"),
        "deferredRequestFields"
      ),
      roleContext: validateRoleContextSummary(ctx, requiredField(ctx, value, "roleContext", "roleContext"), "roleContext"),
      evidenceGroups: requiredArray(ctx, requiredField(ctx, value, "evidenceGroups", "evidenceGroups"), "evidenceGroups").map((item, i) =>
        validateEvidenceGroup(ctx, item, arrayFieldPath("evidenceGroups", i))
      ),
      selectedOwners: requiredArray(ctx, requiredField(ctx, value, "selectedOwners", "selectedOwners"), "selectedOwners").map((item, i) =>
        validateEvidenceItemRef(ctx, item, arrayFieldPath("selectedOwners", i))
      ),
      selectedContracts: requiredArray(ctx, requiredField(ctx, value, "selectedContracts", "selectedContracts"), "selectedContracts").map(
        (item, i) => validateEvidenceItemRef(ctx, item, arrayFieldPath("selectedContracts", i))
      ),
      selectedTests: requiredArray(ctx, requiredField(ctx, value, "selectedTests", "selectedTests"), "selectedTests").map((item, i) =>
        validateEvidenceItemRef(ctx, item, arrayFieldPath("selectedTests", i))
      ),
      testInfrastructure: validateTestInfrastructureSummary(
        ctx,
        requiredField(ctx, value, "testInfrastructure", "testInfrastructure"),
        "testInfrastructure"
      ),
      unresolvedItems: requiredArray(ctx, requiredField(ctx, value, "unresolvedItems", "unresolvedItems"), "unresolvedItems").map((item, i) =>
        validateUnresolvedEvidenceItem(ctx, item, arrayFieldPath("unresolvedItems", i))
      ),
      groupTruncation: requiredArray(ctx, requiredField(ctx, value, "groupTruncation", "groupTruncation"), "groupTruncation").map((item, i) =>
        validateGroupTruncationEntry(ctx, item, arrayFieldPath("groupTruncation", i))
      ),
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

    // Kit artifact writers do not generically reject duplicate IDs (report section 27); the
    // capsule reconstruction above exists only to walk and type-check every field. The
    // returned artifact must be the original parsed reference, never a rebuilt object.
    void capsule;

    return {
      ok: true,
      artifactKind: ARTIFACT_KIND,
      sourcePath,
      schemaVersion: (value.schemaVersion as string),
      schemaMajor: 1,
      artifact: value as unknown as ContextCapsule,
      rawArtifact: value
    };
  } catch (error) {
    if (error instanceof ArtifactValidationError) return error.failure;
    throw error;
  }
}
