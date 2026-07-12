import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  aggregateAndroidIssues,
  buildCandidateSummary,
  runAndroidAuditIntegration,
} from "../../../src/audits/security/androidAuditIntegration.js";
import { ANDROID_SECURITY_AUDIT_DETECTOR_ID } from "../../../src/audits/security/mapAndroidSecurityFindingToAuditIssue.js";
import { makeAndroidFinding } from "../../../src/mobile/android/audit/androidFinding.js";
import { makeCandidateEvidence } from "../../../src/mobile/android/advancedSecurity/candidateEvidence.js";
import { validateAndroidTarget } from "../../../src/mobile/android/validate/validateAndroidTarget.js";
import type { AndroidCheckResult } from "../../../src/mobile/android/validation/checkResult.js";

// ---------------------------------------------------------------------------
// v0.4.2 Batch 2 -- programmatic Android integration for the security audit
// adapter. Two layers of test: pure aggregation/candidate-summary logic
// against small literal AndroidCheckResult fixtures (fast, precise), and a
// real end-to-end call through runAndroidAuditIntegration against the
// existing tests/fixtures/android/compose-app fixture (proves the real
// validateAndroidTarget wiring, report writing, and status/verdict
// integration all work together, not just the pure logic in isolation).
// ---------------------------------------------------------------------------

function makeCheck(overrides: Partial<AndroidCheckResult> = {}): AndroidCheckResult {
  return {
    id: "android-backup-configuration-audit",
    category: "android-backup-configuration",
    title: "Android backup configuration audit",
    status: "passed",
    requirementLevel: "required",
    ran: true,
    skipped: false,
    evidence: [],
    findings: [],
    warnings: [],
    errors: [],
    sourcePaths: [],
    confidence: "medium",
    environmentRequirements: [],
    ...overrides,
  };
}

const cleanupDirs: string[] = [];
afterEach(async () => {
  for (const dir of cleanupDirs.splice(0)) {
    await fs.promises.rm(dir, { recursive: true, force: true });
  }
});

function makeTempToolRoot(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "android-audit-tool-"));
  cleanupDirs.push(dir);
  fs.writeFileSync(path.join(dir, "package.json"), JSON.stringify({ name: "@dailephd/my-dev-kit-lab", version: "0.4.1" }, null, 2), "utf8");
  return dir;
}

describe("aggregateAndroidIssues — finding aggregation", () => {
  it("maps one check with one finding", () => {
    const check = makeCheck({
      findings: [makeAndroidFinding({ ruleId: "r", title: "t", severity: "minor", confidence: "medium", description: "d", manifestPath: "app/src/main/AndroidManifest.xml" })],
    });
    const issues = aggregateAndroidIssues([check], { text: null, json: null });
    expect(issues).toHaveLength(1);
    expect(issues[0].detectorId).toBe(ANDROID_SECURITY_AUDIT_DETECTOR_ID);
  });

  it("preserves check order and finding order within each check", () => {
    const checkA = makeCheck({
      id: "android-network-security-audit",
      findings: [
        makeAndroidFinding({ ruleId: "r1", title: "first", severity: "minor", confidence: "medium", description: "d", manifestPath: "app/a.xml" }),
        makeAndroidFinding({ ruleId: "r2", title: "second", severity: "minor", confidence: "medium", description: "d", manifestPath: "app/b.xml" }),
      ],
    });
    const checkB = makeCheck({
      id: "android-webview-security-audit",
      findings: [makeAndroidFinding({ ruleId: "r3", title: "third", severity: "minor", confidence: "medium", description: "d", manifestPath: "app/c.kt" })],
    });
    const issues = aggregateAndroidIssues([checkA, checkB], { text: null, json: null });
    expect(issues.map((i) => i.title)).toEqual(["first", "second", "third"]);
  });

  it("maps multiple findings within one check in their own order", () => {
    const check = makeCheck({
      findings: [
        makeAndroidFinding({ ruleId: "r1", title: "alpha", severity: "minor", confidence: "medium", description: "d", manifestPath: "app/a.xml" }),
        makeAndroidFinding({ ruleId: "r2", title: "beta", severity: "minor", confidence: "medium", description: "d", manifestPath: "app/b.xml" }),
      ],
    });
    const issues = aggregateAndroidIssues([check], { text: null, json: null });
    expect(issues.map((i) => i.title)).toEqual(["alpha", "beta"]);
  });

  it("collapses an exact duplicate mapped issue (identical finding under the same check) to one entry", () => {
    const finding = makeAndroidFinding({ ruleId: "r", title: "t", severity: "minor", confidence: "medium", description: "d", manifestPath: "app/a.xml" });
    const check = makeCheck({ findings: [finding, { ...finding }] });
    const issues = aggregateAndroidIssues([check], { text: null, json: null });
    expect(issues).toHaveLength(1);
  });

  it("keeps the same finding identity distinct when it appears under two different check IDs", () => {
    const finding = makeAndroidFinding({ ruleId: "r", title: "t", severity: "minor", confidence: "medium", description: "d", manifestPath: "app/a.xml" });
    const checkA = makeCheck({ id: "check-a", findings: [finding] });
    const checkB = makeCheck({ id: "check-b", findings: [{ ...finding }] });
    const issues = aggregateAndroidIssues([checkA, checkB], { text: null, json: null });
    expect(issues).toHaveLength(2);
    expect(issues[0].id).not.toBe(issues[1].id);
  });

  it("preserves report-reference provenance across every mapped issue", () => {
    const check = makeCheck({
      findings: [makeAndroidFinding({ ruleId: "r", title: "t", severity: "minor", confidence: "medium", description: "d", manifestPath: "app/a.xml" })],
    });
    const reportReference = { text: "reports/security/android/app-android-security-validation.txt", json: "reports/security/android/app-android-security-validation.json" };
    const issues = aggregateAndroidIssues([check], reportReference);
    const reference = issues[0].evidence.find((e) => e.kind === "reference");
    expect(reference?.filePath).toBe(reportReference.json);
  });

  it("maps a finding without a source location without fabricating one", () => {
    const check = makeCheck({
      findings: [{ id: "module-level", title: "t", severity: "minor", category: "static-scan", description: "d", releaseImpact: "Review recommended before release" }],
    });
    const issues = aggregateAndroidIssues([check], { text: null, json: null });
    expect(issues).toHaveLength(1);
    expect(issues[0].affectedFiles).toEqual([]);
  });

  it("excludes checks with only candidate evidence and no confirmed findings", () => {
    const check = makeCheck({
      findings: [],
      candidateEvidence: [
        makeCandidateEvidence({
          ruleId: "android-secret-hardcoded-candidate",
          category: "android-secret-candidates",
          confidence: "medium",
          location: { path: "app/src/main/kotlin/Sample.kt" },
          summary: "Unresolved candidate",
          rawValue: "hunter2-fake",
          resolutionState: "unresolved",
        }),
      ],
    });
    const issues = aggregateAndroidIssues([check], { text: null, json: null });
    expect(issues).toEqual([]);
  });
});

describe("buildCandidateSummary — candidate summary", () => {
  it("returns an empty, zeroed summary when no checks have candidates", () => {
    const summary = buildCandidateSummary([makeCheck()]);
    expect(summary.totalCount).toBe(0);
    expect(summary.checksWithCandidates).toBe(0);
    expect(summary.byConfidence).toEqual({ unknown: 0, low: 0, medium: 0, high: 0 });
  });

  it("counts candidates across multiple checks by confidence, resolution state, and category", () => {
    const checkA = makeCheck({
      id: "android-secret-candidates-audit",
      candidateEvidence: [
        makeCandidateEvidence({
          ruleId: "android-secret-hardcoded-candidate",
          category: "android-secret-candidates",
          confidence: "high",
          location: { path: "app/src/main/kotlin/Sample.kt" },
          summary: "s1",
          rawValue: "hunter2-fake",
          resolutionState: "unresolved",
        }),
      ],
    });
    const checkB = makeCheck({
      id: "android-signing-configuration-audit",
      candidateEvidence: [
        makeCandidateEvidence({
          ruleId: "android-signing-password-literal",
          category: "android-signing-configuration",
          confidence: "medium",
          location: { path: "app/build.gradle.kts" },
          summary: "s2",
          rawValue: "fake-store-password",
          resolutionState: "resolved",
        }),
        makeCandidateEvidence({
          ruleId: "android-signing-password-literal",
          category: "android-signing-configuration",
          confidence: "medium",
          location: { path: "app/build.gradle.kts" },
          summary: "s3",
          rawValue: undefined,
          resolutionState: "missing",
        }),
      ],
    });

    const summary = buildCandidateSummary([checkA, checkB]);
    expect(summary.totalCount).toBe(3);
    expect(summary.checksWithCandidates).toBe(2);
    expect(summary.byConfidence).toEqual({ unknown: 0, low: 0, medium: 2, high: 1 });
    expect(summary.byResolutionState).toEqual({ resolved: 1, unresolved: 1, missing: 1, malformed: 0, unsupported: 0, "not-applicable": 0 });
    expect(summary.byCategory).toEqual({ "android-secret-candidates": 1, "android-signing-configuration": 2 });
  });

  it("orders byCategory keys deterministically regardless of check traversal order", () => {
    const zCheck = makeCheck({
      id: "z-check",
      candidateEvidence: [
        makeCandidateEvidence({ ruleId: "android-webview-javascript-enabled", category: "android-webview", confidence: "low", location: { path: "a" }, summary: "s", rawValue: undefined, resolutionState: "not-applicable" }),
      ],
    });
    const aCheck = makeCheck({
      id: "a-check",
      candidateEvidence: [
        makeCandidateEvidence({ ruleId: "android-sensitive-clipboard-write", category: "android-clipboard", confidence: "low", location: { path: "b" }, summary: "s", rawValue: undefined, resolutionState: "not-applicable" }),
      ],
    });
    const summary = buildCandidateSummary([zCheck, aCheck]);
    expect(Object.keys(summary.byCategory)).toEqual(["android-clipboard", "android-webview"]);
  });

  it("never exposes a raw candidate value in the summary", () => {
    const check = makeCheck({
      candidateEvidence: [
        makeCandidateEvidence({
          ruleId: "android-secret-hardcoded-candidate",
          category: "android-secret-candidates",
          confidence: "high",
          location: { path: "app/src/main/kotlin/Sample.kt" },
          summary: "s",
          rawValue: "hunter2-fake-super-secret",
          resolutionState: "unresolved",
        }),
      ],
    });
    const summary = buildCandidateSummary([check]);
    expect(JSON.stringify(summary)).not.toContain("hunter2-fake-super-secret");
  });
});

describe("runAndroidAuditIntegration — failure isolation", () => {
  it("isolates a thrown Android validation error, returns a failed status, and maps no issues", async () => {
    const toolRoot = makeTempToolRoot();
    const runAndroidValidation = vi.fn().mockRejectedValue(new Error("boom: unexpected Android validator crash"));

    const result = await runAndroidAuditIntegration({ toolRoot, request: { enabled: true }, runAndroidValidation });

    expect(result.issues).toEqual([]);
    expect(result.summary.status).toBe("failed");
    expect(result.summary.requested).toBe(true);
    expect(result.summary.applicable).toBeNull();
    expect(result.summary.errors).toHaveLength(1);
    expect(result.summary.errors[0]).toContain("boom: unexpected Android validator crash");
  });

  it("bounds a very long thrown error message and never includes a stack trace", async () => {
    const toolRoot = makeTempToolRoot();
    const longMessage = "x".repeat(5000);
    const runAndroidValidation = vi.fn().mockRejectedValue(new Error(longMessage));

    const result = await runAndroidAuditIntegration({ toolRoot, request: { enabled: true }, runAndroidValidation });

    expect(result.summary.errors[0].length).toBeLessThan(longMessage.length);
    expect(result.summary.errors[0]).toContain("truncated");
    expect(result.summary.errors[0]).not.toContain(" at ");
  });
});

describe("runAndroidAuditIntegration — real Android validator end-to-end", () => {
  it("invokes the real Android validator exactly once against the compose-app fixture and aggregates real results", async () => {
    const toolRoot = makeTempToolRoot();
    const targetPathArg = path.resolve("tests/fixtures/android/compose-app");
    const runAndroidValidationSpy = vi.fn(validateAndroidTarget);

    const result = await runAndroidAuditIntegration({
      toolRoot,
      targetPathArg,
      request: { enabled: true },
      runAndroidValidation: runAndroidValidationSpy,
    });

    expect(runAndroidValidationSpy).toHaveBeenCalledTimes(1);
    expect(runAndroidValidationSpy).toHaveBeenCalledWith(
      expect.objectContaining({ toolRoot, targetPath: targetPathArg })
    );
    expect(result.summary.requested).toBe(true);
    expect(result.summary.applicable).toBe(true);
    expect(result.summary.status).toBe("completed");
    expect(result.summary.totalChecks).toBe(19);
    expect(result.summary.mappedIssueCount).toBe(result.issues.length);
    expect(result.summary.confirmedFindingCount).toBeGreaterThanOrEqual(result.issues.length);
    for (const issue of result.issues) {
      expect(issue.detectorId).toBe(ANDROID_SECURITY_AUDIT_DETECTOR_ID);
    }
  });

  it("starts zero Gradle processes and zero external tools by default", async () => {
    const toolRoot = makeTempToolRoot();
    const gradleExecutorSpy = vi.fn();
    const runAndroidValidationSpy = vi.fn((opts) => validateAndroidTarget({ ...opts, gradleExecutor: gradleExecutorSpy }));

    await runAndroidAuditIntegration({
      toolRoot,
      targetPathArg: path.resolve("tests/fixtures/android/compose-app"),
      request: { enabled: true },
      runAndroidValidation: runAndroidValidationSpy,
    });

    expect(gradleExecutorSpy).not.toHaveBeenCalled();
  });

  it("writes Android reports under a contained reports/security/android child directory, never overwriting the generic report family", async () => {
    const toolRoot = makeTempToolRoot();
    const result = await runAndroidAuditIntegration({
      toolRoot,
      targetPathArg: path.resolve("tests/fixtures/android/compose-app"),
      request: { enabled: true },
    });

    expect(result.summary.reportPaths.text).not.toBeNull();
    expect(result.summary.reportPaths.json).not.toBeNull();
    const containedDir = path.join(toolRoot, "reports", "security", "android");
    expect(path.resolve(result.summary.reportPaths.text!).startsWith(path.resolve(containedDir))).toBe(true);
    expect(path.basename(result.summary.reportPaths.text!)).toMatch(/-android-security-validation\.txt$/);
    expect(fs.existsSync(result.summary.reportPaths.text!)).toBe(true);
    expect(fs.existsSync(result.summary.reportPaths.json!)).toBe(true);
  });

  it("marks a non-Android target as not applicable without a false clean-complete state", async () => {
    const toolRoot = makeTempToolRoot();
    const nonAndroidTarget = fs.mkdtempSync(path.join(os.tmpdir(), "non-android-target-"));
    cleanupDirs.push(nonAndroidTarget);
    fs.writeFileSync(path.join(nonAndroidTarget, "package.json"), JSON.stringify({ name: "not-android", version: "1.0.0" }, null, 2), "utf8");

    const result = await runAndroidAuditIntegration({
      toolRoot,
      targetPathArg: nonAndroidTarget,
      request: { enabled: true },
    });

    expect(result.summary.status).toBe("completed");
    expect(result.summary.applicable).toBe(false);
    expect(result.issues).toEqual([]);
  });

  it("does not modify the real compose-app fixture", async () => {
    const toolRoot = makeTempToolRoot();
    const targetPathArg = path.resolve("tests/fixtures/android/compose-app");
    const before = fs.readdirSync(path.join(targetPathArg, "app", "src", "main"));

    await runAndroidAuditIntegration({ toolRoot, targetPathArg, request: { enabled: true } });

    const after = fs.readdirSync(path.join(targetPathArg, "app", "src", "main"));
    expect(after).toEqual(before);
  });
});
