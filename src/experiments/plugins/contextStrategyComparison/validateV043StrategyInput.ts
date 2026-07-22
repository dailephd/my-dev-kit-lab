import type { ContextRole } from "../../../evaluation/upstreamArtifacts/index.js";
import { V043_STAGE_CONTEXT_STRATEGY_IDS, type V043StageContextStrategyId } from "./v043StrategyIds.js";
import type { V043StageContextStrategyInputV1 } from "./v043StrategyInputContracts.js";

export type V043StrategyInputValidationErrorCode =
  | "NON_OBJECT_INPUT"
  | "MISSING_REQUIRED_FIELD"
  | "INVALID_FIELD_TYPE"
  | "INVALID_STRATEGY_ID"
  | "UNKNOWN_INPUT_FIELD"
  | "EMPTY_PATH"
  | "EMPTY_CONTEXT_ARTIFACT_SET"
  | "TOO_MANY_CONTEXT_ARTIFACTS"
  | "INVALID_CONTEXT_ROLE"
  | "DUPLICATE_CONTEXT_ROLE";

export interface V043StrategyInputValidationIssue {
  code: V043StrategyInputValidationErrorCode;
  fieldPath: string;
  message: string;
}

export type V043StrategyInputValidationResult =
  | {
      ok: true;
      input: V043StageContextStrategyInputV1;
    }
  | {
      ok: false;
      issues: V043StrategyInputValidationIssue[];
    };

type RootFieldKind = "required-path" | "optional-path" | "required-array";

interface StrategyContractField {
  name: string;
  kind: RootFieldKind;
}

interface StrategyContractDescriptor {
  fields: StrategyContractField[];
}

const CONTEXT_ROLE_VALUES: ContextRole[] = ["architecture", "implementation", "test-implementation"];

const COMBINED_ENTRY_ALLOWED_KEYS = ["role", "contextCapsulePath", "retrievalAuditRecordPath"];

const STRATEGY_CONTRACTS: Record<V043StageContextStrategyId, StrategyContractDescriptor> = {
  "architecture-context-only": {
    fields: [
      { name: "expectationsPath", kind: "required-path" },
      { name: "architectureContextCapsulePath", kind: "required-path" },
      { name: "architectureRetrievalAuditRecordPath", kind: "optional-path" }
    ]
  },
  "architecture-plus-implementation-refresh": {
    fields: [
      { name: "expectationsPath", kind: "required-path" },
      { name: "architectureContextCapsulePath", kind: "required-path" },
      { name: "architectureRetrievalAuditRecordPath", kind: "optional-path" },
      { name: "implementationContextCapsulePath", kind: "required-path" },
      { name: "implementationRetrievalAuditRecordPath", kind: "optional-path" }
    ]
  },
  "architecture-plus-implementation-and-test-refresh": {
    fields: [
      { name: "expectationsPath", kind: "required-path" },
      { name: "architectureContextCapsulePath", kind: "required-path" },
      { name: "architectureRetrievalAuditRecordPath", kind: "optional-path" },
      { name: "implementationContextCapsulePath", kind: "required-path" },
      { name: "implementationRetrievalAuditRecordPath", kind: "optional-path" },
      { name: "testImplementationContextCapsulePath", kind: "required-path" },
      { name: "testImplementationRetrievalAuditRecordPath", kind: "optional-path" }
    ]
  },
  "full-workflow-library": {
    fields: [
      { name: "expectationsPath", kind: "required-path" },
      { name: "fullWorkflowLibraryFixturePath", kind: "required-path" }
    ]
  },
  "bounded-workflow-instruction-packet": {
    fields: [
      { name: "expectationsPath", kind: "required-path" },
      { name: "workflowInstructionPacketPath", kind: "required-path" }
    ]
  },
  "combined-bounded-stage-context": {
    fields: [
      { name: "expectationsPath", kind: "required-path" },
      { name: "contextArtifacts", kind: "required-array" },
      { name: "workflowInstructionPacketPath", kind: "required-path" }
    ]
  }
};

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function validateV043StrategyInput(value: unknown): V043StrategyInputValidationResult {
  if (!isPlainObject(value)) {
    return {
      ok: false,
      issues: [{ code: "NON_OBJECT_INPUT", fieldPath: "", message: "Strategy input must be an object." }]
    };
  }

  const root = value;
  const issues: V043StrategyInputValidationIssue[] = [];

  let strategyId: V043StageContextStrategyId | undefined;
  if (root.strategyId === undefined) {
    issues.push({ code: "MISSING_REQUIRED_FIELD", fieldPath: "strategyId", message: "strategyId is required." });
  } else if (typeof root.strategyId !== "string") {
    issues.push({ code: "INVALID_FIELD_TYPE", fieldPath: "strategyId", message: "strategyId must be a string." });
  } else if (!V043_STAGE_CONTEXT_STRATEGY_IDS.includes(root.strategyId as V043StageContextStrategyId)) {
    issues.push({
      code: "INVALID_STRATEGY_ID",
      fieldPath: "strategyId",
      message: `strategyId "${root.strategyId}" is not a valid v0.4.3 stage-context strategy id.`
    });
  } else {
    strategyId = root.strategyId as V043StageContextStrategyId;
  }

  if (strategyId === undefined) {
    return { ok: false, issues };
  }

  const contract = STRATEGY_CONTRACTS[strategyId];
  const allowedKeys = ["strategyId", ...contract.fields.map((field) => field.name)];

  for (const key of Object.keys(root)) {
    if (!allowedKeys.includes(key)) {
      issues.push({
        code: "UNKNOWN_INPUT_FIELD",
        fieldPath: key,
        message: `"${key}" is not a recognized field for strategy "${strategyId}".`
      });
    }
  }

  for (const field of contract.fields) {
    if (field.kind !== "optional-path" && root[field.name] === undefined) {
      issues.push({
        code: "MISSING_REQUIRED_FIELD",
        fieldPath: field.name,
        message: `"${field.name}" is required for strategy "${strategyId}".`
      });
    }
  }

  for (const field of contract.fields) {
    const fieldValue = root[field.name];
    if (fieldValue === undefined) continue;
    if (field.kind === "required-array") {
      if (!Array.isArray(fieldValue)) {
        issues.push({
          code: "INVALID_FIELD_TYPE",
          fieldPath: field.name,
          message: `"${field.name}" must be an array.`
        });
      }
    } else if (typeof fieldValue !== "string") {
      issues.push({
        code: "INVALID_FIELD_TYPE",
        fieldPath: field.name,
        message: `"${field.name}" must be a string.`
      });
    }
  }

  for (const field of contract.fields) {
    if (field.kind === "required-array") continue;
    const fieldValue = root[field.name];
    if (typeof fieldValue === "string" && fieldValue.length === 0) {
      issues.push({ code: "EMPTY_PATH", fieldPath: field.name, message: `"${field.name}" must not be empty.` });
    }
  }

  if (strategyId === "combined-bounded-stage-context" && Array.isArray(root.contextArtifacts)) {
    const contextArtifacts = root.contextArtifacts;

    if (contextArtifacts.length === 0) {
      issues.push({
        code: "EMPTY_CONTEXT_ARTIFACT_SET",
        fieldPath: "contextArtifacts",
        message: "contextArtifacts must contain at least one entry."
      });
    } else if (contextArtifacts.length > 3) {
      issues.push({
        code: "TOO_MANY_CONTEXT_ARTIFACTS",
        fieldPath: "contextArtifacts",
        message: "contextArtifacts must contain at most three entries."
      });
    }

    for (let index = 0; index < contextArtifacts.length; index += 1) {
      const entry = contextArtifacts[index];
      if (!isPlainObject(entry)) {
        issues.push({
          code: "INVALID_FIELD_TYPE",
          fieldPath: `contextArtifacts[${index}]`,
          message: `contextArtifacts[${index}] must be an object.`
        });
        continue;
      }
      for (const key of Object.keys(entry)) {
        if (!COMBINED_ENTRY_ALLOWED_KEYS.includes(key)) {
          issues.push({
            code: "UNKNOWN_INPUT_FIELD",
            fieldPath: `contextArtifacts[${index}].${key}`,
            message: `"${key}" is not a recognized field for a combined context artifact entry.`
          });
        }
      }
    }

    for (let index = 0; index < contextArtifacts.length; index += 1) {
      const entry = contextArtifacts[index];
      if (!isPlainObject(entry)) continue;
      if (entry.role === undefined) {
        issues.push({
          code: "MISSING_REQUIRED_FIELD",
          fieldPath: `contextArtifacts[${index}].role`,
          message: `contextArtifacts[${index}].role is required.`
        });
      }
      if (entry.contextCapsulePath === undefined) {
        issues.push({
          code: "MISSING_REQUIRED_FIELD",
          fieldPath: `contextArtifacts[${index}].contextCapsulePath`,
          message: `contextArtifacts[${index}].contextCapsulePath is required.`
        });
      }
    }

    for (let index = 0; index < contextArtifacts.length; index += 1) {
      const entry = contextArtifacts[index];
      if (!isPlainObject(entry)) continue;
      if (entry.role !== undefined && (typeof entry.role !== "string" || !CONTEXT_ROLE_VALUES.includes(entry.role as ContextRole))) {
        issues.push({
          code: "INVALID_CONTEXT_ROLE",
          fieldPath: `contextArtifacts[${index}].role`,
          message: `contextArtifacts[${index}].role "${entry.role}" is not a valid context role.`
        });
      }
      if (entry.contextCapsulePath !== undefined && typeof entry.contextCapsulePath !== "string") {
        issues.push({
          code: "INVALID_FIELD_TYPE",
          fieldPath: `contextArtifacts[${index}].contextCapsulePath`,
          message: `contextArtifacts[${index}].contextCapsulePath must be a string.`
        });
      }
      if (entry.retrievalAuditRecordPath !== undefined && typeof entry.retrievalAuditRecordPath !== "string") {
        issues.push({
          code: "INVALID_FIELD_TYPE",
          fieldPath: `contextArtifacts[${index}].retrievalAuditRecordPath`,
          message: `contextArtifacts[${index}].retrievalAuditRecordPath must be a string.`
        });
      }
    }

    for (let index = 0; index < contextArtifacts.length; index += 1) {
      const entry = contextArtifacts[index];
      if (!isPlainObject(entry)) continue;
      if (typeof entry.contextCapsulePath === "string" && entry.contextCapsulePath.length === 0) {
        issues.push({
          code: "EMPTY_PATH",
          fieldPath: `contextArtifacts[${index}].contextCapsulePath`,
          message: `contextArtifacts[${index}].contextCapsulePath must not be empty.`
        });
      }
      if (typeof entry.retrievalAuditRecordPath === "string" && entry.retrievalAuditRecordPath.length === 0) {
        issues.push({
          code: "EMPTY_PATH",
          fieldPath: `contextArtifacts[${index}].retrievalAuditRecordPath`,
          message: `contextArtifacts[${index}].retrievalAuditRecordPath must not be empty.`
        });
      }
    }

    const seenRoles = new Set<string>();
    for (let index = 0; index < contextArtifacts.length; index += 1) {
      const entry = contextArtifacts[index];
      if (!isPlainObject(entry) || typeof entry.role !== "string") continue;
      if (seenRoles.has(entry.role)) {
        issues.push({
          code: "DUPLICATE_CONTEXT_ROLE",
          fieldPath: `contextArtifacts[${index}].role`,
          message: `contextArtifacts[${index}].role "${entry.role}" is duplicated.`
        });
      }
      seenRoles.add(entry.role);
    }
  }

  if (issues.length > 0) {
    return { ok: false, issues };
  }

  return { ok: true, input: value as unknown as V043StageContextStrategyInputV1 };
}
