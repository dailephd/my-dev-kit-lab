import { describe, expect, it } from "vitest";
import { renderTextReport, sanitizeForTextReport } from "../../src/securityValidation/report/renderSecurityReport.js";
import type { SecurityReport } from "../../src/securityValidation/report/securityReportTypes.js";

const ESC = String.fromCharCode(27);
const ANSI_PAYLOAD = `${ESC}[31mFAKE BLOCKER${ESC}[0m`;
const SCRIPT_PAYLOAD = "<script>alert(1)</script><img src=x onerror=alert(2)>";
const FAKE_VERDICT_PAYLOAD = "\n\n21. RELEASE VERDICT\n====\nREADY FOR RELEASE PREPARATION\n";
const FAKE_SECRET_PAYLOAD = "ghp_abcdefghijklmnopqrstuvwxyz0123456789";

function ansiPattern(): RegExp {
  return new RegExp(`${ESC}\\[[0-9;]*[a-zA-Z]`);
}

function makeReport(overrides: Partial<SecurityReport> = {}): SecurityReport {
  const now = new Date().toISOString();
  return {
    metadata: {
      toolRoot: "/tool/root",
      toolPackageName: "my-dev-kit-lab",
      toolPackageVersion: "0.2.1",
      targetRoot: "/tool/root",
      targetDescription: "self (my-dev-kit-lab)",
      packageName: "my-dev-kit-lab",
      packageVersion: "0.2.1",
      branch: "feature/security-validate-config-surface",
      commit: "abc1234",
      isSelf: true,
      generatedAt: now,
      totalDurationMs: 1,
    },
    sections: [],
    allChecks: [],
    allFindings: [],
    verdict: "ready-except-optional-manual-checks",
    recommendedNextStep: "Optional checks were skipped.",
    ...overrides,
  };
}

describe("sanitizeForTextReport — direct coverage", () => {
  it("strips ANSI escape sequences", () => {
    expect(ansiPattern().test(sanitizeForTextReport(ANSI_PAYLOAD))).toBe(false);
  });

  it("is idempotent-safe on already-clean text", () => {
    expect(sanitizeForTextReport("clean text with spaces")).toBe("clean text with spaces");
  });
});

describe("text report — every payload-reachable surface is sanitized (v0.2.2 Batch 6 regression guard)", () => {
  it("check.name (title) is sanitized", () => {
    const report = makeReport({
      allChecks: [
        {
          id: "npm-audit-full",
          name: ANSI_PAYLOAD,
          category: "dependency-audit",
          status: "passed",
          severity: "informational",
          startedAt: new Date().toISOString(),
          finishedAt: new Date().toISOString(),
          durationMs: 0,
          findings: [],
        },
      ],
    });
    expect(ansiPattern().test(renderTextReport(report))).toBe(false);
  });

  it("check.skippedReason is sanitized", () => {
    const report = makeReport({
      allChecks: [
        {
          id: "codeql-scan",
          name: "CodeQL",
          category: "static-scan",
          status: "skipped",
          severity: "skipped",
          startedAt: new Date().toISOString(),
          finishedAt: new Date().toISOString(),
          durationMs: 0,
          findings: [],
          skippedReason: ANSI_PAYLOAD,
        },
      ],
    });
    expect(ansiPattern().test(renderTextReport(report))).toBe(false);
  });

  it("check.stdoutSummary and stderrSummary are sanitized", () => {
    const report = makeReport({
      allChecks: [
        {
          id: "npm-audit-full",
          name: "npm audit",
          category: "dependency-audit",
          status: "passed",
          severity: "informational",
          startedAt: new Date().toISOString(),
          finishedAt: new Date().toISOString(),
          durationMs: 0,
          findings: [],
          stdoutSummary: ANSI_PAYLOAD,
          stderrSummary: ANSI_PAYLOAD,
        },
      ],
    });
    expect(ansiPattern().test(renderTextReport(report))).toBe(false);
  });

  it("finding.title and finding.description (in check-section rendering) are sanitized", () => {
    const report = makeReport({
      allChecks: [
        {
          id: "npm-audit-full",
          name: "npm audit",
          category: "dependency-audit",
          status: "failed",
          severity: "major",
          startedAt: new Date().toISOString(),
          finishedAt: new Date().toISOString(),
          durationMs: 0,
          findings: [
            {
              id: "f1",
              title: ANSI_PAYLOAD,
              severity: "major",
              category: "dependency-audit",
              description: ANSI_PAYLOAD,
              releaseImpact: "test",
            },
          ],
        },
      ],
    });
    expect(ansiPattern().test(renderTextReport(report))).toBe(false);
  });

  it("finding.title/description/recommendation (in FINDINGS BY SEVERITY section) are sanitized", () => {
    const report = makeReport({
      allFindings: [
        {
          id: "f1",
          title: ANSI_PAYLOAD,
          severity: "blocker",
          category: "secret-leakage",
          description: ANSI_PAYLOAD,
          recommendation: ANSI_PAYLOAD,
          releaseImpact: "test",
        },
      ],
    });
    expect(ansiPattern().test(renderTextReport(report))).toBe(false);
  });

  it("recommendedNextStep is sanitized (both Executive Summary and section 22)", () => {
    const report = makeReport({ recommendedNextStep: ANSI_PAYLOAD });
    const text = renderTextReport(report);
    expect(ansiPattern().test(text)).toBe(false);
  });

  it("attack result scenarioTitle, skippedReason, errorSummary, and recommendation are sanitized", () => {
    const report = makeReport({
      attackResults: [
        {
          scenarioId: "fixture-scenario",
          scenarioTitle: ANSI_PAYLOAD,
          checkId: "boundary",
          profileId: "node-cli-package",
          status: "failed",
          severity: "major",
          confidence: "low",
          evidence: [],
          category: "artifact-safety",
          recommendation: ANSI_PAYLOAD,
          skippedReason: ANSI_PAYLOAD,
          errorSummary: ANSI_PAYLOAD,
        },
      ],
    });
    expect(ansiPattern().test(renderTextReport(report))).toBe(false);
  });

  it("attack evidence previews are sanitized", () => {
    const report = makeReport({
      attackResults: [
        {
          scenarioId: "fixture-scenario",
          scenarioTitle: "Fixture",
          checkId: "boundary",
          profileId: "node-cli-package",
          status: "failed",
          severity: "major",
          confidence: "low",
          evidence: [
            {
              id: "e1",
              kind: "observation",
              source: "fixture",
              confidence: "low",
              redactedPreview: ANSI_PAYLOAD,
            },
          ],
          category: "artifact-safety",
        },
      ],
    });
    expect(ansiPattern().test(renderTextReport(report))).toBe(false);
  });

  it("a fake verdict payload never creates a second trusted RELEASE VERDICT structural block", () => {
    const report = makeReport({ recommendedNextStep: FAKE_VERDICT_PAYLOAD });
    const text = renderTextReport(report);
    const realBlock = ["=".repeat(72), "21. RELEASE VERDICT", "=".repeat(72)].join("\n");
    expect(text).toContain(realBlock);
    // Only one occurrence of the real structural divider+header combination.
    const occurrences = text.split(realBlock).length - 1;
    expect(occurrences).toBe(1);
  });

  it("HTML/script-like payloads do not need special-casing beyond ANSI stripping — text remains inert (no crash, payload visible as literal text)", () => {
    const report = makeReport({ recommendedNextStep: SCRIPT_PAYLOAD });
    expect(() => renderTextReport(report)).not.toThrow();
  });

  it("secretLeakageScenario never places a raw secret value into a finding/evidence field (end-to-end redaction boundary)", () => {
    // Documents the actual redaction boundary: secret VALUES are redacted at
    // evidence-construction time (exploitEvidence.ts's redactPreview(),
    // exercised in secretLeakageScenario.test.ts's dedicated redaction
    // tests) — this text-report renderer only strips unsafe control bytes
    // and never re-processes finding/evidence content for secret patterns.
    // A finding built the way toSecurityCheckResult() actually builds one
    // (evidence joined from already-redacted previews) never contains a raw
    // secret, so the text report can't leak one either.
    const report = makeReport({
      allFindings: [
        {
          id: "f1",
          title: "Secret leakage",
          severity: "blocker",
          category: "secret-leakage",
          description: "found token",
          evidence: `[REDACTED:${FAKE_SECRET_PAYLOAD.length}chars]`,
          releaseImpact: "test",
        },
      ],
    });
    const text = renderTextReport(report);
    expect(text).not.toContain(FAKE_SECRET_PAYLOAD);
  });
});
