import { isDeepStrictEqual } from "node:util";
import type { ContextCapsule, JsonValue, RetrievalAuditRecord } from "../upstreamArtifacts/index.js";

export type MyDevKitContextArtifactConsistencyFieldPath =
  | "schemaVersion"
  | "tool"
  | "request"
  | "index.indexPath"
  | "index.manifestPath"
  | "contextAdequacy"
  | "roleContext"
  | "responsibilityMappings"
  | "roleAdequacy"
  | "freshness"
  | "budget"
  | "truncation"
  | "fullFileFallback"
  | "provenance";

export interface MyDevKitContextArtifactConsistencyIssue {
  fieldPath: MyDevKitContextArtifactConsistencyFieldPath;
  capsuleValue: JsonValue;
  auditValue: JsonValue;
  message: string;
}

export interface MyDevKitContextArtifactConsistencyResult {
  consistent: boolean;
  issues: MyDevKitContextArtifactConsistencyIssue[];
}

interface FieldComparison {
  fieldPath: MyDevKitContextArtifactConsistencyFieldPath;
  capsuleValue: JsonValue;
  auditValue: JsonValue;
}

export function checkMyDevKitContextArtifactConsistency(
  capsule: ContextCapsule,
  audit: RetrievalAuditRecord
): MyDevKitContextArtifactConsistencyResult {
  const comparisons: FieldComparison[] = [
    { fieldPath: "schemaVersion", capsuleValue: capsule.schemaVersion, auditValue: audit.schemaVersion },
    {
      fieldPath: "tool",
      capsuleValue: capsule.tool as unknown as JsonValue,
      auditValue: audit.tool as unknown as JsonValue
    },
    {
      fieldPath: "request",
      capsuleValue: capsule.request as unknown as JsonValue,
      auditValue: audit.request as unknown as JsonValue
    },
    { fieldPath: "index.indexPath", capsuleValue: capsule.index.indexPath, auditValue: audit.index.indexPath },
    {
      fieldPath: "index.manifestPath",
      capsuleValue: capsule.index.manifestPath,
      auditValue: audit.index.manifestPath
    },
    {
      fieldPath: "contextAdequacy",
      capsuleValue: capsule.contextAdequacy as unknown as JsonValue,
      auditValue: audit.contextAdequacy as unknown as JsonValue
    },
    {
      fieldPath: "roleContext",
      capsuleValue: capsule.roleContext as unknown as JsonValue,
      auditValue: audit.roleContext as unknown as JsonValue
    },
    {
      fieldPath: "responsibilityMappings",
      capsuleValue: capsule.responsibilityMappings as unknown as JsonValue,
      auditValue: audit.responsibilityMappings as unknown as JsonValue
    },
    {
      fieldPath: "roleAdequacy",
      capsuleValue: capsule.roleAdequacy as unknown as JsonValue,
      auditValue: audit.roleAdequacy as unknown as JsonValue
    },
    {
      fieldPath: "freshness",
      capsuleValue: capsule.freshness as unknown as JsonValue,
      auditValue: audit.freshness as unknown as JsonValue
    },
    {
      fieldPath: "budget",
      capsuleValue: capsule.budget as unknown as JsonValue,
      auditValue: audit.budget as unknown as JsonValue
    },
    {
      fieldPath: "truncation",
      capsuleValue: capsule.truncation as unknown as JsonValue,
      auditValue: audit.truncation as unknown as JsonValue
    },
    {
      fieldPath: "fullFileFallback",
      capsuleValue: capsule.fullFileFallback as unknown as JsonValue,
      auditValue: audit.fullFileFallback as unknown as JsonValue
    },
    {
      fieldPath: "provenance",
      capsuleValue: capsule.provenance as unknown as JsonValue,
      auditValue: audit.provenance as unknown as JsonValue
    }
  ];

  const issues: MyDevKitContextArtifactConsistencyIssue[] = [];

  for (const comparison of comparisons) {
    if (!isDeepStrictEqual(comparison.capsuleValue, comparison.auditValue)) {
      issues.push({
        fieldPath: comparison.fieldPath,
        capsuleValue: comparison.capsuleValue,
        auditValue: comparison.auditValue,
        message: `ContextCapsule and RetrievalAuditRecord differ at "${comparison.fieldPath}".`
      });
    }
  }

  return { consistent: issues.length === 0, issues };
}
