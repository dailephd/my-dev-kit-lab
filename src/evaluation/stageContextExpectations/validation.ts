import type { JsonObject, JsonValue } from "../upstreamArtifacts/index.js";
import type {
  StageContextExpectationCategory,
  StageContextExpectationFixtureV1,
  StageContextExpectationInclusion,
  StageContextExpectationSourceArtifact,
  StageContextPathExpectationCategory,
  StageContextSymbolExpectationCategory,
  StageContextWorkflowStableIdCategory
} from "./types.js";
import type { StageContextExpectationReadErrorCode, StageContextExpectationReadResult } from "./readTypes.js";

const SCHEMA_VERSION_PATTERN = /^[0-9]+\.[0-9]+\.[0-9]+$/;
const CASE_ID_PATTERN = /^CASE-[A-Z0-9]+(?:-[A-Z0-9]+)*-[0-9]{3}$/;
const EXPECTATION_ID_PATTERN = /^(REQ|ALLOW|FORBID)-[A-Z0-9]+(?:-[A-Z0-9]+)*-[0-9]{3}$/;

const INCLUSION_VALUES: StageContextExpectationInclusion[] = ["required", "allowed", "forbidden"];

const SOURCE_ARTIFACT_VALUES: StageContextExpectationSourceArtifact[] = [
  "context-capsule",
  "retrieval-audit-record",
  "workflow-instruction-packet",
  "full-workflow-library"
];

const CATEGORY_VALUES: StageContextExpectationCategory[] = [
  "file",
  "symbol",
  "source-range",
  "contract",
  "validator",
  "constant",
  "error",
  "schema-or-serializer",
  "production-responsibility",
  "test-file",
  "fixture",
  "factory",
  "mock",
  "setup-file",
  "test-configuration",
  "package-script",
  "test-command",
  "workflow",
  "stage",
  "command",
  "rule",
  "report-contract",
  "provenance"
];

const PATH_CATEGORIES: StageContextPathExpectationCategory[] = [
  "file",
  "test-file",
  "fixture",
  "factory",
  "mock",
  "setup-file",
  "test-configuration"
];

const SYMBOL_CATEGORIES: StageContextSymbolExpectationCategory[] = [
  "symbol",
  "contract",
  "validator",
  "constant",
  "error",
  "schema-or-serializer"
];

const WORKFLOW_STABLE_ID_CATEGORIES: StageContextWorkflowStableIdCategory[] = [
  "workflow",
  "stage",
  "command",
  "rule",
  "report-contract"
];

const INCLUSION_PREFIX: Record<StageContextExpectationInclusion, string> = {
  required: "REQ-",
  allowed: "ALLOW-",
  forbidden: "FORBID-"
};

const CONTEXT_ADEQUACY_STATUS_VALUES = [
  "context sufficient for implementation",
  "context sufficient with listed assumptions",
  "context insufficient and more retrieval required",
  "context conflict found and user or upstream stage decision required"
];

const FRESHNESS_STATE_VALUES = ["fresh", "stale", "unknown"];

const PACKET_ADEQUACY_STATUS_VALUES = ["adequate", "inadequate"];

function failure(
  sourcePath: string,
  code: StageContextExpectationReadErrorCode,
  message: string,
  extra?: { fieldPath?: string; expected?: string; actual?: JsonValue }
): StageContextExpectationReadResult {
  return { ok: false, sourcePath, code, message, ...extra };
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((entry) => typeof entry === "string");
}

function isNonNegativeInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value >= 0;
}

function isPositiveInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value > 0;
}

function hasDuplicates(values: string[]): boolean {
  return new Set(values).size !== values.length;
}

function requireNonEmptyString(
  root: Record<string, unknown>,
  key: string,
  fieldPath: string,
  sourcePath: string
): StageContextExpectationReadResult | null {
  const value = root[key];
  if (value === undefined) {
    return failure(sourcePath, "MISSING_REQUIRED_FIELD", `${fieldPath} is required.`, { fieldPath });
  }
  if (typeof value !== "string") {
    return failure(sourcePath, "INVALID_FIELD_TYPE", `${fieldPath} must be a string.`, { fieldPath });
  }
  if (value.trim().length === 0) {
    return failure(sourcePath, "INVALID_FIELD_TYPE", `${fieldPath} must be a nonempty string.`, { fieldPath });
  }
  return null;
}

export function validateStageContextExpectationFixtureV1(
  value: JsonObject,
  sourcePath: string
): StageContextExpectationReadResult {
  const root = value as unknown as Record<string, unknown>;

  if (root.schemaVersion === undefined) {
    return failure(sourcePath, "MISSING_REQUIRED_FIELD", "schemaVersion is required.", { fieldPath: "schemaVersion" });
  }
  if (typeof root.schemaVersion !== "string") {
    return failure(sourcePath, "INVALID_FIELD_TYPE", "schemaVersion must be a string.", { fieldPath: "schemaVersion" });
  }
  if (!SCHEMA_VERSION_PATTERN.test(root.schemaVersion)) {
    return failure(sourcePath, "INVALID_SCHEMA_VERSION", `schemaVersion "${root.schemaVersion}" does not match x.y.z.`, {
      fieldPath: "schemaVersion",
      actual: root.schemaVersion
    });
  }
  const schemaVersionValue = root.schemaVersion;
  const schemaMajor = Number(schemaVersionValue.split(".")[0]);
  if (schemaMajor !== 1) {
    return failure(sourcePath, "UNSUPPORTED_SCHEMA_MAJOR", `schemaVersion major "${schemaMajor}" is not supported.`, {
      fieldPath: "schemaVersion",
      actual: schemaVersionValue
    });
  }

  if (root.caseId === undefined) {
    return failure(sourcePath, "MISSING_REQUIRED_FIELD", "caseId is required.", { fieldPath: "caseId" });
  }
  if (typeof root.caseId !== "string") {
    return failure(sourcePath, "INVALID_FIELD_TYPE", "caseId must be a string.", { fieldPath: "caseId" });
  }
  if (!CASE_ID_PATTERN.test(root.caseId)) {
    return failure(sourcePath, "INVALID_CASE_ID", `caseId "${root.caseId}" does not match the required pattern.`, {
      fieldPath: "caseId",
      actual: root.caseId
    });
  }

  const titleFailure = requireNonEmptyString(root, "title", "title", sourcePath);
  if (titleFailure) return titleFailure;

  const descriptionFailure = requireNonEmptyString(root, "description", "description", sourcePath);
  if (descriptionFailure) return descriptionFailure;

  if (root.expectedEvidence === undefined) {
    return failure(sourcePath, "MISSING_REQUIRED_FIELD", "expectedEvidence is required.", { fieldPath: "expectedEvidence" });
  }
  if (!Array.isArray(root.expectedEvidence)) {
    return failure(sourcePath, "INVALID_FIELD_TYPE", "expectedEvidence must be an array.", { fieldPath: "expectedEvidence" });
  }
  if (root.expectedEvidence.length === 0) {
    return failure(sourcePath, "EMPTY_EXPECTATION_SET", "expectedEvidence must contain at least one item.", {
      fieldPath: "expectedEvidence"
    });
  }

  if (root.expectedStates === undefined) {
    return failure(sourcePath, "MISSING_REQUIRED_FIELD", "expectedStates is required.", { fieldPath: "expectedStates" });
  }
  if (!isPlainObject(root.expectedStates)) {
    return failure(sourcePath, "INVALID_FIELD_TYPE", "expectedStates must be an object.", { fieldPath: "expectedStates" });
  }

  if (root.warnings === undefined) {
    return failure(sourcePath, "MISSING_REQUIRED_FIELD", "warnings is required.", { fieldPath: "warnings" });
  }
  if (!isStringArray(root.warnings)) {
    return failure(sourcePath, "INVALID_FIELD_TYPE", "warnings must be an array of strings.", { fieldPath: "warnings" });
  }

  const items = root.expectedEvidence as unknown[];
  for (let index = 0; index < items.length; index += 1) {
    const itemFailure = validateExpectationItem(items[index], `expectedEvidence[${index}]`, sourcePath);
    if (itemFailure) return itemFailure;
  }

  const typedItems = items as Record<string, unknown>[];

  const seenIds = new Set<string>();
  for (let index = 0; index < typedItems.length; index += 1) {
    const id = typedItems[index].expectationId as string;
    if (seenIds.has(id)) {
      return failure(sourcePath, "DUPLICATE_EXPECTATION_ID", `expectationId "${id}" is duplicated.`, {
        fieldPath: `expectedEvidence[${index}].expectationId`,
        actual: id
      });
    }
    seenIds.add(id);
  }

  const seenTargets = new Map<string, StageContextExpectationInclusion>();
  for (let index = 0; index < typedItems.length; index += 1) {
    const item = typedItems[index];
    const targetKey = buildTargetKey(item);
    const inclusion = item.inclusion as StageContextExpectationInclusion;
    const existingInclusion = seenTargets.get(targetKey);
    if (existingInclusion !== undefined) {
      if (existingInclusion === inclusion) {
        return failure(
          sourcePath,
          "DUPLICATE_EXPECTATION_TARGET",
          `Target "${targetKey}" is duplicated with the same inclusion.`,
          { fieldPath: `expectedEvidence[${index}]`, actual: targetKey }
        );
      }
      return failure(
        sourcePath,
        "CONFLICTING_EXPECTATION_INCLUSION",
        `Target "${targetKey}" has conflicting inclusion values.`,
        { fieldPath: `expectedEvidence[${index}]`, actual: targetKey }
      );
    }
    seenTargets.set(targetKey, inclusion);
  }

  const statesFailure = validateExpectedStates(root.expectedStates as Record<string, unknown>, sourcePath);
  if (statesFailure) return statesFailure;

  return {
    ok: true,
    sourcePath,
    schemaVersion: schemaVersionValue,
    schemaMajor: 1,
    fixture: value as unknown as StageContextExpectationFixtureV1,
    rawFixture: value
  };
}

function validateExpectationItem(
  itemValue: unknown,
  itemPath: string,
  sourcePath: string
): StageContextExpectationReadResult | null {
  if (!isPlainObject(itemValue)) {
    return failure(sourcePath, "INVALID_FIELD_TYPE", `${itemPath} must be an object.`, { fieldPath: itemPath });
  }
  const item = itemValue;

  if (item.expectationId === undefined) {
    return failure(sourcePath, "MISSING_REQUIRED_FIELD", `${itemPath}.expectationId is required.`, {
      fieldPath: `${itemPath}.expectationId`
    });
  }
  if (typeof item.expectationId !== "string") {
    return failure(sourcePath, "INVALID_FIELD_TYPE", `${itemPath}.expectationId must be a string.`, {
      fieldPath: `${itemPath}.expectationId`
    });
  }

  if (item.inclusion === undefined) {
    return failure(sourcePath, "MISSING_REQUIRED_FIELD", `${itemPath}.inclusion is required.`, {
      fieldPath: `${itemPath}.inclusion`
    });
  }
  if (typeof item.inclusion !== "string") {
    return failure(sourcePath, "INVALID_FIELD_TYPE", `${itemPath}.inclusion must be a string.`, {
      fieldPath: `${itemPath}.inclusion`
    });
  }
  if (!INCLUSION_VALUES.includes(item.inclusion as StageContextExpectationInclusion)) {
    return failure(sourcePath, "INVALID_LITERAL_VALUE", `${itemPath}.inclusion "${item.inclusion}" is not valid.`, {
      fieldPath: `${itemPath}.inclusion`,
      actual: item.inclusion
    });
  }

  if (item.sourceArtifact === undefined) {
    return failure(sourcePath, "MISSING_REQUIRED_FIELD", `${itemPath}.sourceArtifact is required.`, {
      fieldPath: `${itemPath}.sourceArtifact`
    });
  }
  if (typeof item.sourceArtifact !== "string") {
    return failure(sourcePath, "INVALID_FIELD_TYPE", `${itemPath}.sourceArtifact must be a string.`, {
      fieldPath: `${itemPath}.sourceArtifact`
    });
  }
  if (!SOURCE_ARTIFACT_VALUES.includes(item.sourceArtifact as StageContextExpectationSourceArtifact)) {
    return failure(sourcePath, "INVALID_LITERAL_VALUE", `${itemPath}.sourceArtifact "${item.sourceArtifact}" is not valid.`, {
      fieldPath: `${itemPath}.sourceArtifact`,
      actual: item.sourceArtifact
    });
  }

  if (item.category === undefined) {
    return failure(sourcePath, "MISSING_REQUIRED_FIELD", `${itemPath}.category is required.`, {
      fieldPath: `${itemPath}.category`
    });
  }
  if (typeof item.category !== "string") {
    return failure(sourcePath, "INVALID_FIELD_TYPE", `${itemPath}.category must be a string.`, {
      fieldPath: `${itemPath}.category`
    });
  }
  if (!CATEGORY_VALUES.includes(item.category as StageContextExpectationCategory)) {
    return failure(sourcePath, "INVALID_LITERAL_VALUE", `${itemPath}.category "${item.category}" is not valid.`, {
      fieldPath: `${itemPath}.category`,
      actual: item.category
    });
  }

  if (item.match === undefined) {
    return failure(sourcePath, "MISSING_REQUIRED_FIELD", `${itemPath}.match is required.`, {
      fieldPath: `${itemPath}.match`
    });
  }
  if (!isPlainObject(item.match)) {
    return failure(sourcePath, "INVALID_FIELD_TYPE", `${itemPath}.match must be an object.`, {
      fieldPath: `${itemPath}.match`
    });
  }

  if (item.notes === undefined) {
    return failure(sourcePath, "MISSING_REQUIRED_FIELD", `${itemPath}.notes is required.`, {
      fieldPath: `${itemPath}.notes`
    });
  }
  if (!isStringArray(item.notes)) {
    return failure(sourcePath, "INVALID_FIELD_TYPE", `${itemPath}.notes must be an array of strings.`, {
      fieldPath: `${itemPath}.notes`
    });
  }

  const expectationId = item.expectationId;
  if (!EXPECTATION_ID_PATTERN.test(expectationId)) {
    return failure(
      sourcePath,
      "INVALID_EXPECTATION_ID",
      `${itemPath}.expectationId "${expectationId}" does not match the required pattern.`,
      { fieldPath: `${itemPath}.expectationId`, actual: expectationId }
    );
  }

  const inclusion = item.inclusion as StageContextExpectationInclusion;
  const requiredPrefix = INCLUSION_PREFIX[inclusion];
  if (!expectationId.startsWith(requiredPrefix)) {
    return failure(
      sourcePath,
      "EXPECTATION_ID_PREFIX_MISMATCH",
      `${itemPath}.expectationId "${expectationId}" does not have the "${requiredPrefix}" prefix required by inclusion "${inclusion}".`,
      { fieldPath: `${itemPath}.expectationId`, actual: expectationId }
    );
  }

  const category = item.category as StageContextExpectationCategory;
  const sourceArtifact = item.sourceArtifact as StageContextExpectationSourceArtifact;
  const pairFailure = validateCategorySourcePair(category, sourceArtifact, itemPath, sourcePath);
  if (pairFailure) return pairFailure;

  const matchFailure = validateMatchFields(category, item.match as Record<string, unknown>, itemPath, sourcePath);
  if (matchFailure) return matchFailure;

  return null;
}

function allowedSourceArtifactsForCategory(category: StageContextExpectationCategory): StageContextExpectationSourceArtifact[] {
  if (PATH_CATEGORIES.includes(category as StageContextPathExpectationCategory)) return ["context-capsule"];
  if (SYMBOL_CATEGORIES.includes(category as StageContextSymbolExpectationCategory)) return ["context-capsule"];
  if (category === "source-range") return ["context-capsule"];
  if (category === "production-responsibility") return ["context-capsule", "retrieval-audit-record"];
  if (category === "package-script") return ["context-capsule"];
  if (category === "test-command") return ["context-capsule"];
  if (WORKFLOW_STABLE_ID_CATEGORIES.includes(category as StageContextWorkflowStableIdCategory)) {
    return ["workflow-instruction-packet", "full-workflow-library"];
  }
  return SOURCE_ARTIFACT_VALUES;
}

function validateCategorySourcePair(
  category: StageContextExpectationCategory,
  sourceArtifact: StageContextExpectationSourceArtifact,
  itemPath: string,
  sourcePath: string
): StageContextExpectationReadResult | null {
  const allowed = allowedSourceArtifactsForCategory(category);
  if (!allowed.includes(sourceArtifact)) {
    return failure(
      sourcePath,
      "INVALID_CATEGORY_SOURCE_PAIR",
      `${itemPath} category "${category}" is not valid for sourceArtifact "${sourceArtifact}".`,
      { fieldPath: `${itemPath}.sourceArtifact`, actual: sourceArtifact }
    );
  }
  return null;
}

function requireNonEmptyMatchString(
  match: Record<string, unknown>,
  key: string,
  itemPath: string,
  sourcePath: string
): StageContextExpectationReadResult | null {
  const value = match[key];
  if (value === undefined) {
    return failure(sourcePath, "MISSING_REQUIRED_FIELD", `${itemPath}.match.${key} is required.`, {
      fieldPath: `${itemPath}.match.${key}`
    });
  }
  if (typeof value !== "string") {
    return failure(sourcePath, "INVALID_FIELD_TYPE", `${itemPath}.match.${key} must be a string.`, {
      fieldPath: `${itemPath}.match.${key}`
    });
  }
  if (value.trim().length === 0) {
    return failure(sourcePath, "INVALID_FIELD_TYPE", `${itemPath}.match.${key} must be a nonempty string.`, {
      fieldPath: `${itemPath}.match.${key}`
    });
  }
  return null;
}

function validateMatchFields(
  category: StageContextExpectationCategory,
  match: Record<string, unknown>,
  itemPath: string,
  sourcePath: string
): StageContextExpectationReadResult | null {
  if (PATH_CATEGORIES.includes(category as StageContextPathExpectationCategory)) {
    return requireNonEmptyMatchString(match, "path", itemPath, sourcePath);
  }
  if (SYMBOL_CATEGORIES.includes(category as StageContextSymbolExpectationCategory)) {
    return requireNonEmptyMatchString(match, "symbolId", itemPath, sourcePath);
  }
  if (category === "source-range") {
    const filePathFailure = requireNonEmptyMatchString(match, "filePath", itemPath, sourcePath);
    if (filePathFailure) return filePathFailure;

    if (match.startLine === undefined) {
      return failure(sourcePath, "MISSING_REQUIRED_FIELD", `${itemPath}.match.startLine is required.`, {
        fieldPath: `${itemPath}.match.startLine`
      });
    }
    if (!isPositiveInteger(match.startLine)) {
      return failure(sourcePath, "INVALID_SOURCE_RANGE", `${itemPath}.match.startLine must be a positive integer.`, {
        fieldPath: `${itemPath}.match.startLine`,
        actual: match.startLine as JsonValue
      });
    }
    if (match.endLine === undefined) {
      return failure(sourcePath, "MISSING_REQUIRED_FIELD", `${itemPath}.match.endLine is required.`, {
        fieldPath: `${itemPath}.match.endLine`
      });
    }
    if (!isPositiveInteger(match.endLine)) {
      return failure(sourcePath, "INVALID_SOURCE_RANGE", `${itemPath}.match.endLine must be a positive integer.`, {
        fieldPath: `${itemPath}.match.endLine`,
        actual: match.endLine as JsonValue
      });
    }
    if (match.endLine < match.startLine) {
      return failure(sourcePath, "INVALID_SOURCE_RANGE", `${itemPath}.match.endLine must be >= startLine.`, {
        fieldPath: `${itemPath}.match.endLine`,
        actual: match.endLine as JsonValue
      });
    }
    return null;
  }
  if (category === "production-responsibility") {
    return requireNonEmptyMatchString(match, "responsibilityId", itemPath, sourcePath);
  }
  if (category === "package-script") {
    return requireNonEmptyMatchString(match, "name", itemPath, sourcePath);
  }
  if (category === "test-command") {
    return requireNonEmptyMatchString(match, "commandText", itemPath, sourcePath);
  }
  if (WORKFLOW_STABLE_ID_CATEGORIES.includes(category as StageContextWorkflowStableIdCategory)) {
    return requireNonEmptyMatchString(match, "id", itemPath, sourcePath);
  }
  return requireNonEmptyMatchString(match, "evidenceId", itemPath, sourcePath);
}

function buildTargetKey(item: Record<string, unknown>): string {
  const category = item.category as StageContextExpectationCategory;
  const sourceArtifact = item.sourceArtifact as StageContextExpectationSourceArtifact;
  const match = item.match as Record<string, unknown>;

  if (PATH_CATEGORIES.includes(category as StageContextPathExpectationCategory)) {
    return `${sourceArtifact}|${category}|path:${match.path as string}`;
  }
  if (SYMBOL_CATEGORIES.includes(category as StageContextSymbolExpectationCategory)) {
    return `${sourceArtifact}|${category}|symbolId:${match.symbolId as string}`;
  }
  if (category === "source-range") {
    return `context-capsule|source-range|filePath:${match.filePath as string}|startLine:${match.startLine as number}|endLine:${match.endLine as number}`;
  }
  if (category === "production-responsibility") {
    return `${sourceArtifact}|production-responsibility|responsibilityId:${match.responsibilityId as string}`;
  }
  if (category === "package-script") {
    return `context-capsule|package-script|name:${match.name as string}`;
  }
  if (category === "test-command") {
    return `context-capsule|test-command|commandText:${match.commandText as string}`;
  }
  if (WORKFLOW_STABLE_ID_CATEGORIES.includes(category as StageContextWorkflowStableIdCategory)) {
    return `${sourceArtifact}|${category}|id:${match.id as string}`;
  }
  return `${sourceArtifact}|provenance|evidenceId:${match.evidenceId as string}`;
}

function validateMyDevKitContextArtifactState(
  value: unknown,
  fieldPath: string,
  sourcePath: string
): StageContextExpectationReadResult | null {
  if (value === undefined) return null;
  if (!isPlainObject(value)) {
    return failure(sourcePath, "INVALID_FIELD_TYPE", `${fieldPath} must be an object.`, { fieldPath });
  }

  if (
    value.contextAdequacyStatus !== undefined &&
    !CONTEXT_ADEQUACY_STATUS_VALUES.includes(value.contextAdequacyStatus as string)
  ) {
    return failure(sourcePath, "INVALID_LITERAL_VALUE", `${fieldPath}.contextAdequacyStatus is not valid.`, {
      fieldPath: `${fieldPath}.contextAdequacyStatus`,
      actual: value.contextAdequacyStatus as JsonValue
    });
  }
  if (
    value.roleAdequacyStatus !== undefined &&
    !CONTEXT_ADEQUACY_STATUS_VALUES.includes(value.roleAdequacyStatus as string)
  ) {
    return failure(sourcePath, "INVALID_LITERAL_VALUE", `${fieldPath}.roleAdequacyStatus is not valid.`, {
      fieldPath: `${fieldPath}.roleAdequacyStatus`,
      actual: value.roleAdequacyStatus as JsonValue
    });
  }
  if (value.freshnessState !== undefined && !FRESHNESS_STATE_VALUES.includes(value.freshnessState as string)) {
    return failure(sourcePath, "INVALID_LITERAL_VALUE", `${fieldPath}.freshnessState is not valid.`, {
      fieldPath: `${fieldPath}.freshnessState`,
      actual: value.freshnessState as JsonValue
    });
  }
  if (value.truncated !== undefined && typeof value.truncated !== "boolean") {
    return failure(sourcePath, "INVALID_FIELD_TYPE", `${fieldPath}.truncated must be a boolean.`, {
      fieldPath: `${fieldPath}.truncated`
    });
  }
  if (value.fullFileFallbackUsed !== undefined && !isNonNegativeInteger(value.fullFileFallbackUsed)) {
    return failure(sourcePath, "INVALID_FIELD_TYPE", `${fieldPath}.fullFileFallbackUsed must be a nonnegative integer.`, {
      fieldPath: `${fieldPath}.fullFileFallbackUsed`,
      actual: value.fullFileFallbackUsed as JsonValue
    });
  }
  if (value.unresolvedItemIds !== undefined) {
    if (!isStringArray(value.unresolvedItemIds) || value.unresolvedItemIds.some((entry) => entry.length === 0)) {
      return failure(sourcePath, "INVALID_FIELD_TYPE", `${fieldPath}.unresolvedItemIds must be an array of nonempty strings.`, {
        fieldPath: `${fieldPath}.unresolvedItemIds`
      });
    }
    if (hasDuplicates(value.unresolvedItemIds)) {
      return failure(sourcePath, "DUPLICATE_EXPECTED_VALUE", `${fieldPath}.unresolvedItemIds contains duplicates.`, {
        fieldPath: `${fieldPath}.unresolvedItemIds`
      });
    }
  }
  if (value.warningCount !== undefined && !isNonNegativeInteger(value.warningCount)) {
    return failure(sourcePath, "INVALID_FIELD_TYPE", `${fieldPath}.warningCount must be a nonnegative integer.`, {
      fieldPath: `${fieldPath}.warningCount`,
      actual: value.warningCount as JsonValue
    });
  }
  return null;
}

function validateWorkflowPacketState(value: unknown, sourcePath: string): StageContextExpectationReadResult | null {
  const fieldPath = "expectedStates.workflowInstructionPacket";
  if (value === undefined) return null;
  if (!isPlainObject(value)) {
    return failure(sourcePath, "INVALID_FIELD_TYPE", `${fieldPath} must be an object.`, { fieldPath });
  }
  if (value.adequacyStatus !== undefined && !PACKET_ADEQUACY_STATUS_VALUES.includes(value.adequacyStatus as string)) {
    return failure(sourcePath, "INVALID_LITERAL_VALUE", `${fieldPath}.adequacyStatus is not valid.`, {
      fieldPath: `${fieldPath}.adequacyStatus`,
      actual: value.adequacyStatus as JsonValue
    });
  }
  if (value.truncated !== undefined && typeof value.truncated !== "boolean") {
    return failure(sourcePath, "INVALID_FIELD_TYPE", `${fieldPath}.truncated must be a boolean.`, {
      fieldPath: `${fieldPath}.truncated`
    });
  }
  if (value.unresolvedReferences !== undefined) {
    if (!isStringArray(value.unresolvedReferences)) {
      return failure(sourcePath, "INVALID_FIELD_TYPE", `${fieldPath}.unresolvedReferences must be an array of strings.`, {
        fieldPath: `${fieldPath}.unresolvedReferences`
      });
    }
    if (hasDuplicates(value.unresolvedReferences)) {
      return failure(sourcePath, "DUPLICATE_EXPECTED_VALUE", `${fieldPath}.unresolvedReferences contains duplicates.`, {
        fieldPath: `${fieldPath}.unresolvedReferences`
      });
    }
  }
  if (value.warningCount !== undefined && !isNonNegativeInteger(value.warningCount)) {
    return failure(sourcePath, "INVALID_FIELD_TYPE", `${fieldPath}.warningCount must be a nonnegative integer.`, {
      fieldPath: `${fieldPath}.warningCount`,
      actual: value.warningCount as JsonValue
    });
  }
  return null;
}

function validateTargetImmutabilityState(value: unknown, sourcePath: string): StageContextExpectationReadResult | null {
  const fieldPath = "expectedStates.targetImmutability";
  if (value === undefined) return null;
  if (!isPlainObject(value)) {
    return failure(sourcePath, "INVALID_FIELD_TYPE", `${fieldPath} must be an object.`, { fieldPath });
  }
  if (value.newMutationCount === undefined) {
    return failure(sourcePath, "MISSING_REQUIRED_FIELD", `${fieldPath}.newMutationCount is required.`, {
      fieldPath: `${fieldPath}.newMutationCount`
    });
  }
  if (!isNonNegativeInteger(value.newMutationCount)) {
    return failure(sourcePath, "INVALID_FIELD_TYPE", `${fieldPath}.newMutationCount must be a nonnegative integer.`, {
      fieldPath: `${fieldPath}.newMutationCount`,
      actual: value.newMutationCount as JsonValue
    });
  }
  return null;
}

function validateExpectedStates(
  statesValue: Record<string, unknown>,
  sourcePath: string
): StageContextExpectationReadResult | null {
  const contextCapsuleFailure = validateMyDevKitContextArtifactState(
    statesValue.contextCapsule,
    "expectedStates.contextCapsule",
    sourcePath
  );
  if (contextCapsuleFailure) return contextCapsuleFailure;

  const auditFailure = validateMyDevKitContextArtifactState(
    statesValue.retrievalAuditRecord,
    "expectedStates.retrievalAuditRecord",
    sourcePath
  );
  if (auditFailure) return auditFailure;

  const packetFailure = validateWorkflowPacketState(statesValue.workflowInstructionPacket, sourcePath);
  if (packetFailure) return packetFailure;

  const immutabilityFailure = validateTargetImmutabilityState(statesValue.targetImmutability, sourcePath);
  if (immutabilityFailure) return immutabilityFailure;

  return null;
}
