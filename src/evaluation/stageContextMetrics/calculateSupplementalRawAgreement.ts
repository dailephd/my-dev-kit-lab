// v0.4.4 Batch 2: supplemental/raw agreement. Compares Batch 1 supplemental document
// evidence against the raw ContextCapsule/RetrievalAuditRecord only on fields whose
// vocabularies are directly, losslessly comparable without inventing a translation (e.g.
// my-dev-kit's four-sentence ContextAdequacyStatus values have no frozen mapping onto the
// orchestrator's five-slug DeclaredAdequacy vocabulary, so adequacy is intentionally left
// unavailable here rather than guessed). Producer parity itself is never recomputed: a
// successfully read raw capsule/audit pair is itself observed evidence that the frozen
// my-dev-kit assertRawEvidenceParity() write-time guard already held (Batch 1 contract
// lock), so this module only preserves that outcome -- it never re-diffs the shared fields
// the way rawEvidenceParity.ts does.
import type { ContextCapsule, RetrievalAuditRecord, SupplementalContextDocumentV1 } from "../upstreamArtifacts/index.js";
import type { SupplementalRawAgreementV1, SupplementalRawFieldAgreementV1 } from "./producerReadinessMetricTypes.js";

type RawArtifactIdentity = {
  projectRoot: string | undefined;
  role: "architecture" | "implementation" | "test-implementation" | null;
  freshnessState: string;
  truncated: boolean;
  requiredEvidenceLost: boolean | undefined;
};

function extractRawIdentity(artifact: ContextCapsule | RetrievalAuditRecord): RawArtifactIdentity {
  return {
    projectRoot: artifact.index.projectRoot,
    role: artifact.request.role,
    freshnessState: artifact.freshness.state,
    truncated: artifact.truncation.truncated,
    requiredEvidenceLost: artifact.truncation.requiredEvidenceLost
  };
}

function truncationToYesNo(value: boolean): "yes" | "no" {
  return value ? "yes" : "no";
}

function buildField(
  field: string,
  rawValue: string | boolean | null,
  supplementalValue: string | boolean | null,
  unavailableReason: string | null
): SupplementalRawFieldAgreementV1 {
  if (unavailableReason !== null) {
    return { field, rawValue, supplementalValue, agreement: null, availability: "unavailable", reason: unavailableReason };
  }
  return { field, rawValue, supplementalValue, agreement: rawValue === supplementalValue, availability: "available", reason: null };
}

export function calculateSupplementalRawAgreement(
  supplemental: SupplementalContextDocumentV1 | undefined,
  raw: (ContextCapsule | RetrievalAuditRecord) | undefined
): SupplementalRawAgreementV1 {
  if (supplemental === undefined || raw === undefined) {
    const reason =
      supplemental === undefined && raw === undefined
        ? "Neither a supplemental document nor a raw artifact was supplied."
        : supplemental === undefined
          ? "No supplemental document was supplied."
          : "No raw context-capsule or retrieval-audit artifact was supplied.";
    const fields: SupplementalRawFieldAgreementV1[] = [
      buildField("canonicalRepositoryIdentity", null, supplemental?.indexIdentity ?? null, reason),
      buildField("role", null, supplemental?.role ?? null, reason),
      buildField("freshness", null, supplemental?.freshness ?? null, reason),
      buildField("requiredEvidenceTruncated", null, supplemental?.requiredEvidenceTruncated ?? null, reason),
      buildField("requiredEvidenceLost", null, supplemental?.requiredEvidenceTruncated ?? null, reason)
    ];
    return { fields, contradictions: [], upstreamProducerParityPreserved: null };
  }

  const rawIdentity = extractRawIdentity(raw);

  const fields: SupplementalRawFieldAgreementV1[] = [];

  fields.push(buildField("canonicalRepositoryIdentity", rawIdentity.projectRoot ?? null, supplemental.indexIdentity, rawIdentity.projectRoot === undefined ? "The raw artifact does not declare index.projectRoot." : null));

  const roleComparable = rawIdentity.role === "implementation" || rawIdentity.role === "test-implementation";
  fields.push(
    buildField(
      "role",
      rawIdentity.role,
      supplemental.role,
      roleComparable ? null : `Raw role "${rawIdentity.role}" has no supplemental-document counterpart in this vocabulary.`
    )
  );

  fields.push(buildField("freshness", rawIdentity.freshnessState, supplemental.freshness, null));

  fields.push(
    buildField(
      "requiredEvidenceTruncated",
      truncationToYesNo(rawIdentity.truncated),
      supplemental.requiredEvidenceTruncated,
      supplemental.requiredEvidenceTruncated === "unknown"
        ? "The supplemental document declares truncation as \"unknown\", so agreement with the raw boolean cannot be determined."
        : null
    )
  );

  // v0.4.5 Batch 2 (section 17): the stricter comparison against the Batch 1
  // truncation.requiredEvidenceLost rollup, additive to the general "truncated" comparison
  // above. Absent on legacy raw artifacts, never fabricated.
  fields.push(
    buildField(
      "requiredEvidenceLost",
      rawIdentity.requiredEvidenceLost === undefined ? null : truncationToYesNo(rawIdentity.requiredEvidenceLost),
      supplemental.requiredEvidenceTruncated,
      rawIdentity.requiredEvidenceLost === undefined
        ? "The raw artifact does not declare truncation.requiredEvidenceLost (legacy schema-major-1 evidence)."
        : supplemental.requiredEvidenceTruncated === "unknown"
          ? "The supplemental document declares truncation as \"unknown\", so agreement with the raw boolean cannot be determined."
          : null
    )
  );

  const contradictions = fields.filter((f) => f.availability === "available" && f.agreement === false);

  return {
    fields,
    contradictions,
    // A successfully read raw pair is itself the observed outcome of the frozen
    // assertRawEvidenceParity() write-time guard; see file header. Never recomputed here.
    upstreamProducerParityPreserved: true
  };
}
