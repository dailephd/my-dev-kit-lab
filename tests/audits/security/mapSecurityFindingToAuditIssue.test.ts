import { describe, expect, it } from "vitest";
import {
  mapSecurityFindingToAuditIssue,
  SECURITY_AUDIT_DETECTOR_ID,
} from "../../../src/audits/security/mapSecurityFindingToAuditIssue.js";
import type { SecurityFinding } from "../../../src/securityValidation/types.js";

// ---------------------------------------------------------------------------
// v0.3.2 Batch 4 -- T3: mapSecurityFindingToAuditIssue fidelity.
//
// Pure unit tests: no runSecurityValidation() call, no subprocess, no I/O --
// only verifies the SecurityFinding -> AuditIssue field-by-field mapping.
// ---------------------------------------------------------------------------

function makeFinding(overrides: Partial<SecurityFinding> = {}): SecurityFinding {
  return {
    id: "npm-audit-full:vulnerable-pkg",
    title: "Vulnerable dependency: vulnerable-pkg",
    severity: "major",
    category: "dependency-audit",
    description: "vulnerable-pkg has a known high-severity vulnerability.",
    evidence: "vulnerable-pkg@1.0.0 matches advisory GHSA-test",
    affectedFiles: ["package.json"],
    recommendation: "Upgrade vulnerable-pkg to >=1.2.3.",
    releaseImpact: "Should fix before release",
    ...overrides,
  };
}

describe("mapSecurityFindingToAuditIssue — severity mapping", () => {
  it("maps blocker -> blocker", () => {
    expect(mapSecurityFindingToAuditIssue(makeFinding({ severity: "blocker" })).severity).toBe("blocker");
  });

  it("maps major -> high (never understated to medium)", () => {
    expect(mapSecurityFindingToAuditIssue(makeFinding({ severity: "major" })).severity).toBe("high");
  });

  it("maps minor -> medium", () => {
    expect(mapSecurityFindingToAuditIssue(makeFinding({ severity: "minor" })).severity).toBe("medium");
  });

  it("maps informational -> info", () => {
    expect(mapSecurityFindingToAuditIssue(makeFinding({ severity: "informational" })).severity).toBe("info");
  });
});

describe("mapSecurityFindingToAuditIssue — releaseBlocking/implementationBlocking", () => {
  it("blocker and major findings are release- and implementation-blocking", () => {
    const blocker = mapSecurityFindingToAuditIssue(makeFinding({ severity: "blocker" }));
    const major = mapSecurityFindingToAuditIssue(makeFinding({ severity: "major" }));
    expect(blocker.releaseBlocking).toBe(true);
    expect(blocker.implementationBlocking).toBe(true);
    expect(major.releaseBlocking).toBe(true);
    expect(major.implementationBlocking).toBe(true);
  });

  it("minor and informational findings are never blocking", () => {
    const minor = mapSecurityFindingToAuditIssue(makeFinding({ severity: "minor" }));
    const info = mapSecurityFindingToAuditIssue(makeFinding({ severity: "informational" }));
    expect(minor.releaseBlocking).toBe(false);
    expect(minor.implementationBlocking).toBe(false);
    expect(info.releaseBlocking).toBe(false);
    expect(info.implementationBlocking).toBe(false);
  });
});

describe("mapSecurityFindingToAuditIssue — field fidelity", () => {
  it("preserves title, description, category, affectedFiles, and a stable content-addressed id", () => {
    const finding = makeFinding();
    const issue = mapSecurityFindingToAuditIssue(finding);

    expect(issue.id).toBe(`security:${finding.id}`);
    expect(issue.auditType).toBe("security");
    expect(issue.detectorId).toBe(SECURITY_AUDIT_DETECTOR_ID);
    expect(issue.title).toBe(finding.title);
    expect(issue.description).toBe(finding.description);
    expect(issue.category).toBe(finding.category);
    expect(issue.affectedFiles).toEqual(finding.affectedFiles);
    expect(issue.autoFixEligible).toBe(false);
  });

  it("carries the finding's evidence text into a bounded AuditEvidence entry", () => {
    const finding = makeFinding();
    const issue = mapSecurityFindingToAuditIssue(finding);

    expect(issue.evidence).toHaveLength(1);
    expect(issue.evidence[0].kind).toBe("observation");
    expect(issue.evidence[0].excerpt).toBe(finding.evidence);
    expect(issue.evidence[0].source).toBe(`security-validation:${finding.category}`);
    expect(issue.evidence[0].message).toContain(finding.title);
  });

  it("produces no evidence entries when the finding carries no evidence text", () => {
    const finding = makeFinding({ evidence: undefined });
    const issue = mapSecurityFindingToAuditIssue(finding);
    expect(issue.evidence).toEqual([]);
  });

  it("falls back to affectedFiles: [] when the finding omits it", () => {
    const finding = makeFinding({ affectedFiles: undefined });
    expect(mapSecurityFindingToAuditIssue(finding).affectedFiles).toEqual([]);
  });

  it("uses the finding's recommendation as recommendedAction, with a conservative fallback when absent", () => {
    const withRec = mapSecurityFindingToAuditIssue(makeFinding({ recommendation: "Do the thing." }));
    expect(withRec.recommendedAction).toBe("Do the thing.");

    const withoutRec = mapSecurityFindingToAuditIssue(makeFinding({ recommendation: undefined }));
    expect(withoutRec.recommendedAction).toMatch(/security validation report/i);
  });

  it("always suggests running security:validate as a validation command", () => {
    const issue = mapSecurityFindingToAuditIssue(makeFinding());
    expect(issue.validationCommands).toContain("npm run security:validate");
  });

  it("uses a conservative medium confidence/false-positive-risk default (no per-finding confidence field exists on SecurityFinding)", () => {
    const issue = mapSecurityFindingToAuditIssue(makeFinding());
    expect(issue.confidence).toBe("medium");
    expect(issue.falsePositiveRisk).toBe("medium");
  });

  it("two distinct findings never collide on id", () => {
    const a = mapSecurityFindingToAuditIssue(makeFinding({ id: "finding-a" }));
    const b = mapSecurityFindingToAuditIssue(makeFinding({ id: "finding-b" }));
    expect(a.id).not.toBe(b.id);
  });
});
