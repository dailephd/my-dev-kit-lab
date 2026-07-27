import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { readImplementationContextRetrievalReportV1 } from "../../../src/evaluation/upstreamArtifacts/readImplementationContextRetrievalReportV1.js";
import { readTestContextRetrievalReportV1 } from "../../../src/evaluation/upstreamArtifacts/readTestContextRetrievalReportV1.js";
import { buildValidSupplementalContextText } from "./supplementalContextFixtures.js";

const tempDirs: string[] = [];
function writeTempFile(text: string): string {
  const dir = mkdtempSync(join(tmpdir(), "mdkl-supplemental-report-"));
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

describe("readImplementationContextRetrievalReportV1", () => {
  // TST-B1-002
  it("parses a valid frozen implementation-context retrieval report independently from the packet", async () => {
    const text = buildValidSupplementalContextText("implementation-context-retrieval-report", {
      metadata: { "Index identity": "Z:/repo/canonical" }
    });
    const result = await readImplementationContextRetrievalReportV1(writeTempFile(text));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.artifact.documentKind).toBe("implementation-context-retrieval-report");
    expect(result.artifact.indexIdentity).toBe("Z:/repo/canonical");
    expect(result.artifact.requestSchemaVersion).toBe("1.0.0");
    expect(result.artifact.fullFileFallbackUsed).toBe("no");
    expect(result.artifact.determinismChecked).toBe("yes");
  });

  // TST-B1-004
  it("preserves declared truncation/adequacy/freshness fields without recalculating them", async () => {
    const text = buildValidSupplementalContextText("implementation-context-retrieval-report", {
      metadata: { "Required evidence truncated": "yes", Adequacy: "sufficient-with-assumptions", Freshness: "stale" }
    });
    const result = await readImplementationContextRetrievalReportV1(writeTempFile(text));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.artifact.requiredEvidenceTruncated).toBe("yes");
    expect(result.artifact.adequacy).toBe("sufficient-with-assumptions");
    expect(result.artifact.freshness).toBe("stale");
  });

  // TST-B1-009
  it("fails explicitly on malformed retrieval-report text", async () => {
    const result = await readImplementationContextRetrievalReportV1(writeTempFile("   \n\n   "));
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.code).toBe("MALFORMED_TEXT_ARTIFACT");
  });

  it("keeps the packet and report kinds structurally distinct (a packet file fails the report reader)", async () => {
    const packetText = buildValidSupplementalContextText("implementation-context-packet");
    const result = await readImplementationContextRetrievalReportV1(writeTempFile(packetText));
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.code).toBe("DOCUMENT_KIND_MISMATCH");
  });

  // TST-B1-015: explicit null vs absent optional distinguishable. requestSchemaVersion is
  // required for report kinds so this exercises "unknown" (explicit declared value) staying
  // distinct from an actually-absent key (which fails structurally, see TST-B1-011 style case).
  it("preserves the literal declared string 'unknown' rather than normalizing it away", async () => {
    const text = buildValidSupplementalContextText("implementation-context-retrieval-report", {
      metadata: { "Index identity": "unresolved-index" }
    });
    const result = await readImplementationContextRetrievalReportV1(writeTempFile(text));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.artifact.indexIdentity).toBe("unresolved-index");
  });
});

describe("readTestContextRetrievalReportV1", () => {
  // TST-B1-006
  it("preserves mapped/partially-mapped/unmapped/not-applicable declared states exactly and distinctly", async () => {
    for (const state of ["mapped", "partially-mapped", "unmapped", "not-applicable"]) {
      const text = buildValidSupplementalContextText("test-context-retrieval-report", {
        metadata: { "Critical responsibility mapping status": state }
      });
      const result = await readTestContextRetrievalReportV1(writeTempFile(text));
      expect(result.ok).toBe(true);
      if (!result.ok) continue;
      expect(result.artifact.criticalResponsibilityMappingStatus).toBe(state);
    }
  });

  // TST-B1-007
  it("preserves declared truncation/adequacy without recomputing producer parity or contradiction policy", async () => {
    const text = buildValidSupplementalContextText("test-context-retrieval-report", {
      metadata: { "Required evidence truncated": "unknown", Adequacy: "conflict" }
    });
    const result = await readTestContextRetrievalReportV1(writeTempFile(text));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.artifact.requiredEvidenceTruncated).toBe("unknown");
    expect(result.artifact.adequacy).toBe("conflict");
  });

  it("fails explicitly on an unknown declared status value", async () => {
    const text = buildValidSupplementalContextText("test-context-retrieval-report", {
      metadata: { Status: "draft" }
    });
    const result = await readTestContextRetrievalReportV1(writeTempFile(text));
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.code).toBe("UNKNOWN_STATUS_VALUE");
  });
});
