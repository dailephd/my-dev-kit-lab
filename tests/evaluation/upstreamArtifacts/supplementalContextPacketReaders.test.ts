import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { readImplementationContextPacketV1 } from "../../../src/evaluation/upstreamArtifacts/readImplementationContextPacketV1.js";
import { readTestContextPacketV1 } from "../../../src/evaluation/upstreamArtifacts/readTestContextPacketV1.js";
import { buildValidSupplementalContextText } from "./supplementalContextFixtures.js";

const tempDirs: string[] = [];
function writeTempFile(text: string): string {
  const dir = mkdtempSync(join(tmpdir(), "mdkl-supplemental-"));
  tempDirs.push(dir);
  const filePath = join(dir, "artifact.txt");
  writeFileSync(filePath, text, "utf8");
  return filePath;
}
afterEach(() => {
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop();
    if (dir) rmSync(dir, { recursive: true, force: true });
  }
});

describe("readImplementationContextPacketV1", () => {
  // TST-B1-001
  it("parses a valid frozen implementation-context packet and preserves known fields, identity, and source order", async () => {
    const text = buildValidSupplementalContextText("implementation-context-packet", {
      metadata: { "Index identity": "Z:/repo/canonical" }
    });
    const path = writeTempFile(text);
    const result = await readImplementationContextPacketV1(path);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.artifact.documentKind).toBe("implementation-context-packet");
    expect(result.artifact.role).toBe("implementation");
    expect(result.artifact.status).toBe("populated");
    expect(result.artifact.indexIdentity).toBe("Z:/repo/canonical");
    expect(result.artifact.sectionOrder[0]).toBe("Focus");
    expect(result.artifact.metadataOrder[0]).toBe("Schema version");
  });

  // TST-B1-003 (packet side): schema-version fields present without recomputation
  it("preserves context-capsule/retrieval-audit schema version fields verbatim (producer parity evidence)", async () => {
    const text = buildValidSupplementalContextText("implementation-context-packet", {
      metadata: { "Context capsule schema version": "1.4.0", "Retrieval audit schema version": "1.4.0" }
    });
    const result = await readImplementationContextPacketV1(writeTempFile(text));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.artifact.contextCapsuleSchemaVersion).toBe("1.4.0");
    expect(result.artifact.retrievalAuditSchemaVersion).toBe("1.4.0");
  });

  // TST-B1-008
  it("fails explicitly on malformed packet text", async () => {
    const result = await readImplementationContextPacketV1(writeTempFile("this is not a supplemental document at all"));
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.code).toBe("MALFORMED_TEXT_ARTIFACT");
  });

  // TST-B1-010
  it("fails explicitly on unsupported schema major", async () => {
    const text = buildValidSupplementalContextText("implementation-context-packet", {
      metadata: { "Schema version": "2.0.0" }
    });
    const result = await readImplementationContextPacketV1(writeTempFile(text));
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.code).toBe("UNSUPPORTED_SCHEMA_MAJOR");
  });

  // TST-B1-011
  it("fails explicitly when a required heading is missing", async () => {
    const text = buildValidSupplementalContextText("implementation-context-packet", {
      sections: { Focus: undefined }
    });
    const result = await readImplementationContextPacketV1(writeTempFile(text));
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.code).toBe("MISSING_REQUIRED_SECTION");
    expect(result.fieldPath).toBe("Focus");
  });

  // TST-B1-012
  it("fails when required canonical repository identity is missing", async () => {
    const text = buildValidSupplementalContextText("implementation-context-packet", {
      metadata: { "Index identity": "" }
    });
    const result = await readImplementationContextPacketV1(writeTempFile(text));
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.code).toBe("MISSING_CANONICAL_IDENTITY");
  });

  // TST-B1-013
  it("preserves unknown additive metadata keys and section headings", async () => {
    const text = buildValidSupplementalContextText("implementation-context-packet", {
      extraMetadataLines: ["Future field: kept"],
      extraSections: { "Future section": "kept text" }
    });
    const result = await readImplementationContextPacketV1(writeTempFile(text));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.artifact.rawMetadata["Future field"]).toBe("kept");
    expect(result.artifact.sections["Future section"]).toBe("kept text");
  });

  // TST-B1-014
  it("leaves test-only and report-only optional fields absent (undefined) for an implementation packet, never normalized", async () => {
    const text = buildValidSupplementalContextText("implementation-context-packet");
    const result = await readImplementationContextPacketV1(writeTempFile(text));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.artifact.responsibilityMappingsTruncated).toBeUndefined();
    expect(result.artifact.criticalResponsibilityMappingStatus).toBeUndefined();
    expect(result.artifact.requestSchemaVersion).toBeUndefined();
    expect(result.artifact.fullFileFallbackUsed).toBeUndefined();
    expect(result.artifact.determinismChecked).toBeUndefined();
    expect("responsibilityMappingsTruncated" in result.artifact).toBe(false);
  });

  // TST-B1-015
  it("keeps an absent metadata key distinguishable from a present metadata key with an empty value", async () => {
    const absentKeyText = buildValidSupplementalContextText("implementation-context-packet");
    const emptyValueText = buildValidSupplementalContextText("implementation-context-packet", {
      extraMetadataLines: ["Future field: "]
    });
    const absentResult = await readImplementationContextPacketV1(writeTempFile(absentKeyText));
    const emptyResult = await readImplementationContextPacketV1(writeTempFile(emptyValueText));
    expect(absentResult.ok).toBe(true);
    expect(emptyResult.ok).toBe(true);
    if (!absentResult.ok || !emptyResult.ok) return;
    expect("Future field" in absentResult.artifact.rawMetadata).toBe(false);
    expect("Future field" in emptyResult.artifact.rawMetadata).toBe(true);
    expect(emptyResult.artifact.rawMetadata["Future field"]).toBe("");
    expect(emptyResult.artifact.warnings.some((w) => w.includes("Future field"))).toBe(true);
  });

  // TST-B1-025 (packet reader does not break existing envelope shape)
  it("returns the standard UpstreamArtifactReadResult envelope shape", async () => {
    const text = buildValidSupplementalContextText("implementation-context-packet");
    const result = await readImplementationContextPacketV1(writeTempFile(text));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.artifactKind).toBe("orchestrator-implementation-context-packet-v1");
    expect(result.schemaMajor).toBe(1);
  });

  // TST-B1-026
  it("produces deeply equal output on repeated parses of the same artifact", async () => {
    const text = buildValidSupplementalContextText("implementation-context-packet");
    const path = writeTempFile(text);
    const first = await readImplementationContextPacketV1(path);
    const second = await readImplementationContextPacketV1(path);
    expect(first).toEqual(second);
  });
});

describe("readTestContextPacketV1", () => {
  // TST-B1-005
  it("preserves exact responsibility section text, canonical repository identity, and allocation evidence", async () => {
    const text = buildValidSupplementalContextText("test-context-packet", {
      metadata: {
        "Index identity": "Z:/repo/canonical",
        "Responsibility mappings truncated": "no",
        "Critical responsibility mapping status": "partially-mapped"
      },
      sections: { "Responsibility mappings": "TST-100: mapped\nTST-101: partially-mapped" }
    });
    const result = await readTestContextPacketV1(writeTempFile(text));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.artifact.indexIdentity).toBe("Z:/repo/canonical");
    expect(result.artifact.responsibilityMappingsTruncated).toBe("no");
    expect(result.artifact.criticalResponsibilityMappingStatus).toBe("partially-mapped");
    expect(result.artifact.sections["Responsibility mappings"]).toBe("TST-100: mapped\nTST-101: partially-mapped");
  });

  it("keeps a 'mapped' declaration distinct from a 'partially-mapped' declaration (verbatim strings, no re-derivation)", async () => {
    const mapped = buildValidSupplementalContextText("test-context-packet", {
      metadata: { "Critical responsibility mapping status": "mapped" }
    });
    const partial = buildValidSupplementalContextText("test-context-packet", {
      metadata: { "Critical responsibility mapping status": "partially-mapped" }
    });
    const mappedResult = await readTestContextPacketV1(writeTempFile(mapped));
    const partialResult = await readTestContextPacketV1(writeTempFile(partial));
    expect(mappedResult.ok && mappedResult.artifact.criticalResponsibilityMappingStatus).toBe("mapped");
    expect(partialResult.ok && partialResult.artifact.criticalResponsibilityMappingStatus).toBe("partially-mapped");
  });

  it("rejects a document declaring the wrong role for test-context-packet", async () => {
    const text = buildValidSupplementalContextText("test-context-packet", { metadata: { Role: "implementation" } });
    const result = await readTestContextPacketV1(writeTempFile(text));
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.code).toBe("DOCUMENT_ROLE_MISMATCH");
  });

  it("fails when a test-only required metadata key (Responsibility mappings truncated) is missing", async () => {
    const text = buildValidSupplementalContextText("test-context-packet", {
      metadata: { "Responsibility mappings truncated": undefined }
    });
    const result = await readTestContextPacketV1(writeTempFile(text));
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.code).toBe("MISSING_REQUIRED_METADATA");
  });
});
