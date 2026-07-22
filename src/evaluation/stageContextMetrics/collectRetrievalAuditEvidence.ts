import type { RetrievalAuditRecord } from "../upstreamArtifacts/index.js";
import type { StageContextObservedEvidenceV1 } from "./types.js";

const SOURCE_ARTIFACT = "retrieval-audit-record" as const;

function dedupeEvidence(records: StageContextObservedEvidenceV1[]): StageContextObservedEvidenceV1[] {
  const seen = new Set<string>();
  const result: StageContextObservedEvidenceV1[] = [];
  for (const record of records) {
    const key = `${record.sourceInstance} ${record.category} ${record.targetKey}`;
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(record);
  }
  return result;
}

export function collectRetrievalAuditEvidence(
  artifact: RetrievalAuditRecord,
  sourceInstance: string
): StageContextObservedEvidenceV1[] {
  const records: StageContextObservedEvidenceV1[] = [];

  artifact.responsibilityMappings.mappings.forEach((mapping, index) => {
    records.push({
      sourceArtifact: SOURCE_ARTIFACT,
      sourceInstance,
      category: "production-responsibility",
      targetKey: `${SOURCE_ARTIFACT}|production-responsibility|responsibilityId:${mapping.responsibilityId}`,
      sourceFieldPath: `responsibilityMappings.mappings[${index}].responsibilityId`
    });
  });

  artifact.provenance.forEach((provenanceRecord, index) => {
    records.push({
      sourceArtifact: SOURCE_ARTIFACT,
      sourceInstance,
      category: "provenance",
      targetKey: `${SOURCE_ARTIFACT}|provenance|evidenceId:${provenanceRecord.evidenceId}`,
      sourceFieldPath: `provenance[${index}].evidenceId`
    });
  });

  return dedupeEvidence(records);
}
