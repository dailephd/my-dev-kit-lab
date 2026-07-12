import { describe, expect, it } from "vitest";
import {
  ANDROID_SECURITY_AUDIT_DETECTOR_ID,
  mapAndroidSecurityFindingToAuditIssue,
  type AndroidAuditMappingContext,
} from "../../../src/audits/security/mapAndroidSecurityFindingToAuditIssue.js";
import { makeAndroidFinding } from "../../../src/mobile/android/audit/androidFinding.js";
import type { SecurityFinding, SecuritySeverity } from "../../../src/securityValidation/types.js";

// ---------------------------------------------------------------------------
// v0.4.2 Batch 1 -- pure Android SecurityFinding -> AuditIssue mapper.
//
// Pure unit tests: no validateAndroidTarget() call, no subprocess, no I/O --
// only verifies the mapping. Reuses makeAndroidFinding (the real, sole
// producer of Android SecurityFinding objects) as the primary fixture
// factory so tests exercise the actual evidence-string shape the mapper
// parses, rather than a hand-rolled approximation of it.
// ---------------------------------------------------------------------------

function baseContext(overrides: Partial<AndroidAuditMappingContext> = {}): AndroidAuditMappingContext {
  return {
    checkId: "android-backup-configuration-audit",
    checkCategory: "android-backup-configuration",
    ...overrides,
  };
}

describe("mapAndroidSecurityFindingToAuditIssue — severity matrix", () => {
  const cases: Array<[SecuritySeverity, ReturnType<typeof mapAndroidSecurityFindingToAuditIssue>["severity"], boolean]> = [
    ["blocker", "blocker", true],
    ["major", "high", true],
    ["minor", "medium", false],
    ["informational", "info", false],
  ];

  it.each(cases)("maps Android severity %s -> generic %s (blocking=%s)", (androidSeverity, expectedSeverity, expectedBlocking) => {
    const finding = makeAndroidFinding({
      ruleId: "android-backup-allow-backup",
      title: "Application manifest explicitly permits backup",
      severity: androidSeverity,
      confidence: "medium",
      description: "The manifest sets android:allowBackup=\"true\".",
      manifestPath: "app/src/main/AndroidManifest.xml",
      location: { line: 6 },
    });
    const issue = mapAndroidSecurityFindingToAuditIssue(finding, baseContext());

    expect(issue.severity).toBe(expectedSeverity);
    expect(issue.releaseBlocking).toBe(expectedBlocking);
    expect(issue.implementationBlocking).toBe(expectedBlocking);
  });

  it("never weakens a blocker or major finding to informational", () => {
    const blocker = mapAndroidSecurityFindingToAuditIssue(
      makeAndroidFinding({
        ruleId: "android-secret-hardcoded",
        title: "Hardcoded secret candidate",
        severity: "blocker",
        confidence: "high",
        description: "d",
        manifestPath: "app/src/main/kotlin/Sample.kt",
      }),
      baseContext({ checkId: "android-secret-candidates-audit", checkCategory: "android-secret-candidates" })
    );
    expect(blocker.severity).not.toBe("info");
    expect(blocker.severity).not.toBe("low");
  });

  it("never elevates a minor finding to blocker", () => {
    const minor = mapAndroidSecurityFindingToAuditIssue(
      makeAndroidFinding({
        ruleId: "android-backup-allow-backup",
        title: "Backup enabled",
        severity: "minor",
        confidence: "medium",
        description: "d",
        manifestPath: "app/src/main/AndroidManifest.xml",
      }),
      baseContext()
    );
    expect(minor.severity).not.toBe("blocker");
  });
});

describe("mapAndroidSecurityFindingToAuditIssue — field fidelity and provenance", () => {
  const finding = makeAndroidFinding({
    ruleId: "android-network-cleartext-permitted",
    title: "Cleartext traffic permitted",
    severity: "major",
    confidence: "high",
    description: "usesCleartextTraffic is explicitly true.",
    manifestPath: "app/src/main/AndroidManifest.xml",
    identity: "base-config",
    location: { line: 12 },
    recommendation: "Set usesCleartextTraffic to false.",
  });

  it("preserves title, description, and a stable content-addressed id namespaced by check id", () => {
    const issue = mapAndroidSecurityFindingToAuditIssue(finding, baseContext({ checkId: "android-network-security-audit" }));

    expect(issue.id).toBe(`android:android-network-security-audit:${finding.id}`);
    expect(issue.auditType).toBe("security");
    expect(issue.detectorId).toBe(ANDROID_SECURITY_AUDIT_DETECTOR_ID);
    expect(issue.title).toBe(finding.title);
    expect(issue.description).toBe(finding.description);
    expect(issue.autoFixEligible).toBe(false);
  });

  it("uses the Android check category, not the finding's own generic static-scan category", () => {
    expect(finding.category).toBe("static-scan");
    const issue = mapAndroidSecurityFindingToAuditIssue(finding, baseContext({ checkCategory: "android-network-security" }));
    expect(issue.category).toBe("android-network-security");
    expect(issue.category).not.toBe("static-scan");
  });

  it("preserves affectedFiles, recommendation, and an Android-specific validation command", () => {
    const issue = mapAndroidSecurityFindingToAuditIssue(finding, baseContext());
    expect(issue.affectedFiles).toEqual(["app/src/main/AndroidManifest.xml"]);
    expect(issue.recommendedAction).toBe("Set usesCleartextTraffic to false.");
    expect(issue.validationCommands).toContain("npm run security:validate -- --profile android");
  });

  it("falls back to a conservative recommendation when the finding omits one", () => {
    const noRecFinding = makeAndroidFinding({
      ruleId: "android-backup-allow-backup",
      title: "t",
      severity: "minor",
      confidence: "medium",
      description: "d",
      manifestPath: "app/src/main/AndroidManifest.xml",
    });
    const issue = mapAndroidSecurityFindingToAuditIssue(noRecFinding, baseContext());
    expect(issue.recommendedAction).toMatch(/android security validation report/i);
  });

  it("preserves external-tool provenance in the evidence message when present", () => {
    const semgrepFinding = makeAndroidFinding({
      ruleId: "android-external-tool-semgrep-finding",
      title: "Semgrep rule match",
      severity: "major",
      confidence: "medium",
      description: "d",
      manifestPath: "app/src/main/kotlin/Sample.kt",
    });
    const issue = mapAndroidSecurityFindingToAuditIssue(
      semgrepFinding,
      baseContext({ checkId: "android-semgrep-audit", checkCategory: "android-semgrep", externalToolId: "semgrep" })
    );
    expect(issue.evidence[0].message).toContain("tool=semgrep");
    expect(issue.evidence[0].source).toBe("android-security-validation:android-semgrep-audit");
  });

  it("includes an Android report reference evidence entry only when one is supplied", () => {
    const withoutReport = mapAndroidSecurityFindingToAuditIssue(finding, baseContext());
    expect(withoutReport.evidence.some((e) => e.kind === "reference")).toBe(false);

    const withReport = mapAndroidSecurityFindingToAuditIssue(
      finding,
      baseContext({ reportReference: { text: "reports/security/app-android-security-validation.txt", json: "reports/security/app-android-security-validation.json" } })
    );
    const reference = withReport.evidence.find((e) => e.kind === "reference");
    expect(reference).toBeDefined();
    expect(reference?.filePath).toBe("reports/security/app-android-security-validation.json");
  });
});

describe("mapAndroidSecurityFindingToAuditIssue — deterministic identity and deduplication", () => {
  it("produces identical output for equivalent input across repeated calls (no timestamp/random/iteration-order dependency)", () => {
    const finding = makeAndroidFinding({
      ruleId: "android-backup-allow-backup",
      title: "t",
      severity: "minor",
      confidence: "medium",
      description: "d",
      manifestPath: "app/src/main/AndroidManifest.xml",
      location: { line: 6 },
    });
    const context = baseContext();
    const a = mapAndroidSecurityFindingToAuditIssue(finding, context);
    const b = mapAndroidSecurityFindingToAuditIssue(finding, context);
    expect(a).toEqual(b);
  });

  it("does not mutate the input finding", () => {
    const finding = makeAndroidFinding({
      ruleId: "android-backup-allow-backup",
      title: "t",
      severity: "minor",
      confidence: "medium",
      description: "d",
      manifestPath: "app/src/main/AndroidManifest.xml",
    });
    const snapshot = JSON.parse(JSON.stringify(finding));
    mapAndroidSecurityFindingToAuditIssue(finding, baseContext());
    expect(finding).toEqual(snapshot);
  });

  it("keeps distinct findings distinct when only the check id differs", () => {
    const finding = makeAndroidFinding({
      ruleId: "android-shared-rule",
      title: "t",
      severity: "minor",
      confidence: "medium",
      description: "d",
      manifestPath: "app/src/main/AndroidManifest.xml",
    });
    const a = mapAndroidSecurityFindingToAuditIssue(finding, baseContext({ checkId: "check-a" }));
    const b = mapAndroidSecurityFindingToAuditIssue(finding, baseContext({ checkId: "check-b" }));
    expect(a.id).not.toBe(b.id);
  });

  it("keeps distinct findings distinct when only the module (relative file) differs", () => {
    const a = mapAndroidSecurityFindingToAuditIssue(
      makeAndroidFinding({ ruleId: "r", title: "t", severity: "minor", confidence: "medium", description: "d", manifestPath: "app/src/main/AndroidManifest.xml" }),
      baseContext()
    );
    const b = mapAndroidSecurityFindingToAuditIssue(
      makeAndroidFinding({ ruleId: "r", title: "t", severity: "minor", confidence: "medium", description: "d", manifestPath: "library/src/main/AndroidManifest.xml" }),
      baseContext()
    );
    expect(a.id).not.toBe(b.id);
  });

  it("keeps distinct findings distinct when only external-tool provenance differs", () => {
    const finding = makeAndroidFinding({ ruleId: "r", title: "t", severity: "minor", confidence: "medium", description: "d", manifestPath: "app/build.gradle.kts" });
    const semgrep = mapAndroidSecurityFindingToAuditIssue(finding, baseContext({ externalToolId: "semgrep" }));
    const osv = mapAndroidSecurityFindingToAuditIssue(finding, baseContext({ externalToolId: "osv" }));
    expect(semgrep.evidence[0].message).not.toBe(osv.evidence[0].message);
  });

  it("produces an equivalent id for a repeated equivalent finding (exact-duplicate collapse upstream)", () => {
    const a = makeAndroidFinding({ ruleId: "r", title: "t", severity: "minor", confidence: "medium", description: "d", manifestPath: "app/src/main/AndroidManifest.xml", location: { line: 3 } });
    const b = makeAndroidFinding({ ruleId: "r", title: "t", severity: "minor", confidence: "medium", description: "d", manifestPath: "app/src/main/AndroidManifest.xml", location: { line: 3 } });
    const issueA = mapAndroidSecurityFindingToAuditIssue(a, baseContext());
    const issueB = mapAndroidSecurityFindingToAuditIssue(b, baseContext());
    expect(issueA.id).toBe(issueB.id);
  });
});

describe("mapAndroidSecurityFindingToAuditIssue — location matrix", () => {
  it("preserves relative path and line when both are present", () => {
    const finding = makeAndroidFinding({
      ruleId: "r",
      title: "t",
      severity: "minor",
      confidence: "medium",
      description: "d",
      manifestPath: "app/src/main/AndroidManifest.xml",
      location: { line: 42 },
    });
    const issue = mapAndroidSecurityFindingToAuditIssue(finding, baseContext());
    expect(issue.evidence[0].filePath).toBe("app/src/main/AndroidManifest.xml");
    expect(issue.evidence[0].line).toBe(42);
  });

  it("preserves relative path without a line when the finding has no location", () => {
    const finding = makeAndroidFinding({
      ruleId: "r",
      title: "t",
      severity: "minor",
      confidence: "medium",
      description: "d",
      manifestPath: "app/build.gradle.kts",
    });
    const issue = mapAndroidSecurityFindingToAuditIssue(finding, baseContext());
    expect(issue.evidence[0].filePath).toBe("app/build.gradle.kts");
    expect(issue.evidence[0].line).toBeUndefined();
  });

  it("remains valid for a finding without an affected file at all", () => {
    const finding: SecurityFinding = {
      id: "android-module-level-finding",
      title: "Module-level finding",
      severity: "minor",
      category: "static-scan",
      description: "d",
      releaseImpact: "Review recommended before release",
    };
    const issue = mapAndroidSecurityFindingToAuditIssue(finding, baseContext());
    expect(issue.affectedFiles).toEqual([]);
    expect(issue.evidence).toEqual([]);
  });

  it("does not fabricate a line when the evidence text's location path does not match affectedFiles[0]", () => {
    const finding: SecurityFinding = {
      id: "android-mismatched-location",
      title: "t",
      severity: "minor",
      category: "static-scan",
      description: "d",
      evidence: "confidence=medium | location=some/other/file.xml:9",
      affectedFiles: ["app/src/main/AndroidManifest.xml"],
      releaseImpact: "Review recommended before release",
    };
    const issue = mapAndroidSecurityFindingToAuditIssue(finding, baseContext());
    expect(issue.evidence[0].filePath).toBe("app/src/main/AndroidManifest.xml");
    expect(issue.evidence[0].line).toBeUndefined();
  });

  it("never exposes an absolute workstation path", () => {
    const finding: SecurityFinding = {
      id: "android-absolute-path-input",
      title: "t",
      severity: "minor",
      category: "static-scan",
      description: "d",
      evidence: "confidence=medium | location=C:\\Users\\someone\\project\\app\\src\\main\\AndroidManifest.xml:6",
      affectedFiles: ["app/src/main/AndroidManifest.xml"],
      releaseImpact: "Review recommended before release",
    };
    const issue = mapAndroidSecurityFindingToAuditIssue(finding, baseContext());
    expect(issue.evidence[0].filePath).not.toMatch(/^[A-Za-z]:\\/);
    expect(issue.evidence[0].filePath).toBe("app/src/main/AndroidManifest.xml");
  });
});

describe("mapAndroidSecurityFindingToAuditIssue — confidence", () => {
  it("uses the supplied check confidence when it is a valid AuditConfidence value", () => {
    const finding = makeAndroidFinding({ ruleId: "r", title: "t", severity: "minor", confidence: "high", description: "d", manifestPath: "app/src/main/AndroidManifest.xml" });
    const issue = mapAndroidSecurityFindingToAuditIssue(finding, baseContext({ checkConfidence: "high" }));
    expect(issue.confidence).toBe("high");
  });

  it("falls back to a conservative medium confidence for 'unknown' or an absent check confidence", () => {
    const finding = makeAndroidFinding({ ruleId: "r", title: "t", severity: "minor", confidence: "medium", description: "d", manifestPath: "app/src/main/AndroidManifest.xml" });
    expect(mapAndroidSecurityFindingToAuditIssue(finding, baseContext({ checkConfidence: "unknown" })).confidence).toBe("medium");
    expect(mapAndroidSecurityFindingToAuditIssue(finding, baseContext()).confidence).toBe("medium");
  });
});

describe("mapAndroidSecurityFindingToAuditIssue — redaction and bounds", () => {
  it("bounds a long evidence excerpt", () => {
    const longDetail = "x".repeat(2000);
    const finding = makeAndroidFinding({
      ruleId: "r",
      title: "t",
      severity: "minor",
      confidence: "medium",
      description: "d",
      manifestPath: "app/src/main/AndroidManifest.xml",
      evidenceDetails: [longDetail],
    });
    const issue = mapAndroidSecurityFindingToAuditIssue(finding, baseContext());
    expect(issue.evidence[0].excerpt!.length).toBeLessThan(finding.evidence!.length);
    expect(issue.evidence[0].excerpt).toContain("truncated");
  });

  it("carries through only the finding's own evidence text (already redacted by the Android detector) without adding raw secret material", () => {
    const finding = makeAndroidFinding({
      ruleId: "android-secret-hardcoded",
      title: "Hardcoded secret candidate",
      severity: "blocker",
      confidence: "high",
      description: "d",
      manifestPath: "app/src/main/kotlin/Sample.kt",
      evidenceDetails: ["preview=SECR***[REDACTED]", "fingerprint=abc123"],
    });
    const issue = mapAndroidSecurityFindingToAuditIssue(finding, baseContext({ checkId: "android-secret-candidates-audit" }));
    expect(issue.evidence[0].excerpt).toContain("[REDACTED]");
    expect(issue.evidence[0].excerpt).not.toContain("hunter2");
  });
});

describe("mapAndroidSecurityFindingToAuditIssue — CandidateEvidence boundary", () => {
  it("maps only entries from an AndroidCheckResult-shaped findings array, never from candidateEvidence", () => {
    // Mirrors the real AndroidCheckResult shape: findings (confirmed,
    // SecurityFinding[]) and candidateEvidence (review-only, a structurally
    // distinct type) are separate arrays. A caller iterating .findings simply
    // has no CandidateEvidence values to pass — the function's parameter
    // type is SecurityFinding, so a CandidateEvidence object could not be
    // passed to it even if a caller tried.
    const checkResult = {
      findings: [
        makeAndroidFinding({ ruleId: "r", title: "confirmed", severity: "minor", confidence: "medium", description: "d", manifestPath: "app/src/main/AndroidManifest.xml" }),
      ] as SecurityFinding[],
      candidateEvidence: [
        {
          id: "candidate-1",
          ruleId: "android-secret-hardcoded",
          category: "android-secret-candidates",
          confidence: "medium",
          location: { relativePath: "app/src/main/kotlin/Sample.kt" },
          summary: "Unresolved candidate",
          redactedPreview: "S***",
          fingerprint: "fp-1",
          resolutionState: "unresolved",
          staticAnalysisLimitations: [],
        },
      ],
    };

    const mapped = checkResult.findings.map((finding) => mapAndroidSecurityFindingToAuditIssue(finding, baseContext()));

    expect(mapped).toHaveLength(1);
    expect(mapped[0].title).toBe("confirmed");
    for (const issue of mapped) {
      expect(JSON.stringify(issue)).not.toContain("resolutionState");
      expect(JSON.stringify(issue)).not.toContain("fp-1");
    }
  });

  it("does not map a skipped check's absence of findings as any kind of issue", () => {
    const skippedCheckFindings: SecurityFinding[] = [];
    const mapped = skippedCheckFindings.map((finding) => mapAndroidSecurityFindingToAuditIssue(finding, baseContext()));
    expect(mapped).toEqual([]);
  });
});

describe("mapAndroidSecurityFindingToAuditIssue — backward compatibility", () => {
  it("is a distinct detector id from the existing non-Android security mapper", () => {
    expect(ANDROID_SECURITY_AUDIT_DETECTOR_ID).not.toBe("security-validation-adapter");
  });
});
