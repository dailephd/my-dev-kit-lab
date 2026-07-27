import { describe, expect, it } from "vitest";
import { calculateSupplementalRawAgreement } from "../../../src/evaluation/stageContextMetrics/calculateSupplementalRawAgreement.js";
import type { ContextCapsule, SupplementalContextDocumentV1 } from "../../../src/evaluation/upstreamArtifacts/index.js";

function rawArtifact(overrides: Record<string, unknown> = {}): ContextCapsule {
  return {
    index: { indexPath: "/idx", manifestPath: "/idx/manifest.json", projectRoot: "Z:/repo/canonical" },
    request: { role: "implementation" },
    freshness: { state: "fresh" },
    truncation: { truncated: false },
    ...overrides
  } as unknown as ContextCapsule;
}

function supplemental(overrides: Partial<SupplementalContextDocumentV1> = {}): SupplementalContextDocumentV1 {
  return {
    documentKind: "implementation-context-packet",
    role: "implementation",
    schemaVersion: "1.0.0",
    schemaMajor: 1,
    status: "populated",
    repositoryScope: "single-repository",
    freshness: "fresh",
    adequacy: "sufficient",
    requiredEvidenceTruncated: "no",
    contextCapsuleSchemaVersion: "1.0.0",
    retrievalAuditSchemaVersion: "1.0.0",
    toolName: "my-dev-kit",
    toolVersion: "1.10.2",
    indexIdentity: "Z:/repo/canonical",
    rawMetadata: {},
    sections: {},
    sectionOrder: [],
    metadataOrder: [],
    warnings: [],
    ...overrides
  };
}

describe("calculateSupplementalRawAgreement", () => {
  // TST-B2-029
  it("matching canonical repository identity agrees", () => {
    const result = calculateSupplementalRawAgreement(supplemental(), rawArtifact());
    const identity = result.fields.find((f) => f.field === "canonicalRepositoryIdentity");
    expect(identity).toMatchObject({ agreement: true, availability: "available" });
  });

  // TST-B2-030
  it("contradictory canonical repository identity is reported", () => {
    const result = calculateSupplementalRawAgreement(supplemental({ indexIdentity: "Z:/repo/different" }), rawArtifact());
    const identity = result.fields.find((f) => f.field === "canonicalRepositoryIdentity")!;
    expect(identity.agreement).toBe(false);
    expect(result.contradictions).toContainEqual(identity);
  });

  // TST-B2-031
  it("matching index identities (via freshness field) agree", () => {
    const result = calculateSupplementalRawAgreement(supplemental({ freshness: "fresh" }), rawArtifact({ freshness: { state: "fresh" } }));
    const freshness = result.fields.find((f) => f.field === "freshness");
    expect(freshness).toMatchObject({ agreement: true, availability: "available" });
  });

  // TST-B2-032
  it("contradictory raw and supplemental truncation states are reported", () => {
    const result = calculateSupplementalRawAgreement(
      supplemental({ requiredEvidenceTruncated: "no" }),
      rawArtifact({ truncation: { truncated: true } })
    );
    const truncation = result.fields.find((f) => f.field === "requiredEvidenceTruncated")!;
    expect(truncation.agreement).toBe(false);
    expect(result.contradictions.map((c) => c.field)).toContain("requiredEvidenceTruncated");
  });

  // TST-B2-033
  it("missing evidence on one side reports unavailable rather than contradiction", () => {
    const result = calculateSupplementalRawAgreement(supplemental(), undefined);
    expect(result.fields.every((f) => f.availability === "unavailable")).toBe(true);
    expect(result.contradictions).toEqual([]);
  });

  // TST-B2-034
  it("multiple contradictions preserve deterministic per-field ordering", () => {
    const result = calculateSupplementalRawAgreement(
      supplemental({ indexIdentity: "Z:/repo/different", requiredEvidenceTruncated: "no" }),
      rawArtifact({ truncation: { truncated: true } })
    );
    expect(result.contradictions.map((c) => c.field)).toEqual(["canonicalRepositoryIdentity", "requiredEvidenceTruncated"]);
  });

  // TST-B2-035
  it("preserves the upstream producer-parity outcome without recomputing it", () => {
    const withPair = calculateSupplementalRawAgreement(supplemental(), rawArtifact());
    expect(withPair.upstreamProducerParityPreserved).toBe(true);
    const withoutRaw = calculateSupplementalRawAgreement(supplemental(), undefined);
    expect(withoutRaw.upstreamProducerParityPreserved).toBeNull();
  });

  it("a role with no supplemental counterpart (architecture) reports unavailable, not a forced mismatch", () => {
    const result = calculateSupplementalRawAgreement(supplemental(), rawArtifact({ request: { role: "architecture" } }));
    const role = result.fields.find((f) => f.field === "role")!;
    expect(role.availability).toBe("unavailable");
  });

  it("declared 'unknown' truncation makes agreement undeterminable rather than a forced value", () => {
    const result = calculateSupplementalRawAgreement(supplemental({ requiredEvidenceTruncated: "unknown" }), rawArtifact());
    const truncation = result.fields.find((f) => f.field === "requiredEvidenceTruncated")!;
    expect(truncation.availability).toBe("unavailable");
  });
});
