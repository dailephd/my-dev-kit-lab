import { afterEach, describe, expect, it } from "vitest";
import {
  checkSupplementalReadinessIdentityConsistency,
  validateOrchestratorContextReadinessResultV1
} from "../../../src/evaluation/upstreamArtifacts/orchestratorContextReadinessResultV1.js";
import { readImplementationContextPacketV1 } from "../../../src/evaluation/upstreamArtifacts/readImplementationContextPacketV1.js";
import { buildValidSupplementalContextText } from "./supplementalContextFixtures.js";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

function baseReadyResult(overrides: Record<string, unknown> = {}) {
  return {
    schemaVersion: "1.0.0",
    kind: "implementation",
    role: "implementation",
    decision: "ready",
    classification: "ready",
    stageId: "stage.feature.implementation",
    packetPath: "artifacts/implementation-context-packet.txt",
    reportPath: "reports/implementation-context-retrieval-report.txt",
    issues: [],
    warnings: [],
    blockingIssueCodes: [],
    affectedResponsibilityIds: [],
    evaluatedFreshness: "fresh",
    evaluatedAdequacy: "sufficient",
    requiredEvidenceTruncated: "no",
    readyWithAssumptions: false,
    provenanceSummary: "resolved from populated packet/report pair",
    indexIdentity: "Z:/repo/canonical",
    ...overrides
  };
}

describe("validateOrchestratorContextReadinessResultV1", () => {
  // TST-B1-016
  it("parses a valid ready readiness result as observed consumer evidence", () => {
    const result = validateOrchestratorContextReadinessResultV1(baseReadyResult(), "test:ready");
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.artifact.decision).toBe("ready");
    expect(result.artifact.classification).toBe("ready");
  });

  // TST-B1-017
  it("parses a valid blocked (refresh-required) readiness result", () => {
    const blocked = baseReadyResult({
      decision: "refresh-required",
      classification: "stale",
      blockingIssueCodes: ["CONTEXT_SOURCE_STALE"],
      blockerSummary: {
        contextKind: "implementation",
        primaryCode: "CONTEXT_SOURCE_STALE",
        primaryReason: "Raw evidence is stale relative to the working tree.",
        correctiveAction: "Regenerate the context capsule/audit pair.",
        evidenceTarget: "raw context evidence",
        blockingIssueCodes: ["CONTEXT_SOURCE_STALE"],
        supportingIssueCodes: []
      }
    });
    const result = validateOrchestratorContextReadinessResultV1(blocked, "test:blocked");
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.artifact.decision).toBe("refresh-required");
    expect(result.artifact.blockerSummary?.primaryCode).toBe("CONTEXT_SOURCE_STALE");
  });

  // TST-B1-018
  it("parses a valid not-required result exactly", () => {
    const result = validateOrchestratorContextReadinessResultV1(
      baseReadyResult({ decision: "not-required", classification: "not-required", indexIdentity: undefined }),
      "test:not-required"
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.artifact.decision).toBe("not-required");
  });

  // TST-B1-019 + TST-B1-020
  it("preserves actionable issue codes exactly, including ordering and the primary issue", () => {
    const issue1 = {
      code: "CONTEXT_PACKET_TEMPLATE",
      severity: "error" as const,
      message: "Packet is still a template.",
      priority: 12,
      correctiveAction: "Populate the packet.",
      evidenceTarget: "supplemental context packet",
      stageId: "stage.feature.implementation",
      contextKind: "implementation" as const
    };
    const issue2 = { ...issue1, code: "CONTEXT_REPORT_TEMPLATE", priority: 13 };
    const blocked = baseReadyResult({
      decision: "refresh-required",
      classification: "template",
      issues: [issue1, issue2],
      blockingIssueCodes: ["CONTEXT_PACKET_TEMPLATE", "CONTEXT_REPORT_TEMPLATE"],
      primaryIssue: issue1
    });
    const result = validateOrchestratorContextReadinessResultV1(blocked, "test:issues");
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.artifact.issues.map((i) => i.code)).toEqual(["CONTEXT_PACKET_TEMPLATE", "CONTEXT_REPORT_TEMPLATE"]);
    expect(result.artifact.primaryIssue?.code).toBe("CONTEXT_PACKET_TEMPLATE");
  });

  // TST-B1-021
  it("parses a fail-closed supplemental contradiction result without rerunning contradiction policy", () => {
    const contradiction = baseReadyResult({
      decision: "refresh-required",
      classification: "source-evidence-malformed",
      blockingIssueCodes: ["CONTEXT_SOURCE_SUMMARY_MISMATCH", "CONTEXT_SOURCE_REPOSITORY_INCOMPLETE"]
    });
    const result = validateOrchestratorContextReadinessResultV1(contradiction, "test:contradiction");
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    // The lab only preserves the already-computed outcome; it never recomputes it.
    expect(result.artifact.blockingIssueCodes).toEqual([
      "CONTEXT_SOURCE_SUMMARY_MISMATCH",
      "CONTEXT_SOURCE_REPOSITORY_INCOMPLETE"
    ]);
  });

  // TST-B1-022
  it("fails explicitly on an unknown readiness decision", () => {
    const result = validateOrchestratorContextReadinessResultV1(baseReadyResult({ decision: "approved" }), "test:unknown-decision");
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.code).toBe("UNKNOWN_READINESS_DECISION");
  });

  // TST-B1-023
  it("fails explicitly on a malformed issue structure", () => {
    const result = validateOrchestratorContextReadinessResultV1(
      baseReadyResult({ issues: [{ code: "X" }] }),
      "test:malformed-issue"
    );
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.code).toBe("MALFORMED_ISSUE_STRUCTURE");
  });

  it("fails explicitly on a malformed blockerSummary structure", () => {
    const result = validateOrchestratorContextReadinessResultV1(
      baseReadyResult({ blockerSummary: { primaryCode: "X" } }),
      "test:malformed-blocker"
    );
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.code).toBe("MALFORMED_ISSUE_STRUCTURE");
  });

  it("rejects a kind/role combination that is structurally inconsistent", () => {
    const result = validateOrchestratorContextReadinessResultV1(
      baseReadyResult({ kind: "test", role: "implementation" }),
      "test:kind-role-mismatch"
    );
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.code).toBe("DOCUMENT_ROLE_MISMATCH");
  });

  // TST-B1-026
  it("produces deeply equal output on repeated validation of the same input", () => {
    const input = baseReadyResult();
    const first = validateOrchestratorContextReadinessResultV1(input, "test:repeat");
    const second = validateOrchestratorContextReadinessResultV1(input, "test:repeat");
    expect(first).toEqual(second);
  });
});

describe("checkSupplementalReadinessIdentityConsistency", () => {
  const tempDirs: string[] = [];
  function writeTempFile(text: string): string {
    const dir = mkdtempSync(join(tmpdir(), "mdkl-readiness-identity-"));
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

  // TST-B1-024
  it("reports a structural identity diagnostic without producing a lab readiness verdict", async () => {
    const packetText = buildValidSupplementalContextText("implementation-context-packet", {
      metadata: { "Index identity": "Z:/repo/one" }
    });
    const packetResult = await readImplementationContextPacketV1(writeTempFile(packetText));
    expect(packetResult.ok).toBe(true);
    if (!packetResult.ok) return;

    const readinessResult = validateOrchestratorContextReadinessResultV1(
      baseReadyResult({ indexIdentity: "Z:/repo/two" }),
      "test:identity-mismatch"
    );
    expect(readinessResult.ok).toBe(true);
    if (!readinessResult.ok) return;

    const diagnostic = checkSupplementalReadinessIdentityConsistency(packetResult.artifact, readinessResult.artifact);
    expect(diagnostic).not.toBeNull();
    expect(diagnostic?.code).toBe("INCOMPATIBLE_ARTIFACT_IDENTITY");
    // Structural diagnostic only: does not touch/override the upstream decision.
    expect(readinessResult.artifact.decision).toBe("ready");
  });

  it("reports no diagnostic when identities match", async () => {
    const packetText = buildValidSupplementalContextText("implementation-context-packet", {
      metadata: { "Index identity": "Z:/repo/same" }
    });
    const packetResult = await readImplementationContextPacketV1(writeTempFile(packetText));
    expect(packetResult.ok).toBe(true);
    if (!packetResult.ok) return;

    const readinessResult = validateOrchestratorContextReadinessResultV1(
      baseReadyResult({ indexIdentity: "Z:/repo/same" }),
      "test:identity-match"
    );
    expect(readinessResult.ok).toBe(true);
    if (!readinessResult.ok) return;

    expect(checkSupplementalReadinessIdentityConsistency(packetResult.artifact, readinessResult.artifact)).toBeNull();
  });
});
