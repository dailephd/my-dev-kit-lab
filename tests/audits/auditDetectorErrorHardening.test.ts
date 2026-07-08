import path from "node:path";
import { describe, expect, it } from "vitest";
import { normalizeAuditConfig } from "../../src/audits/core/auditConfig.js";
import { runAudit } from "../../src/audits/core/auditRunner.js";
import type { AuditDetector } from "../../src/audits/core/auditRegistry.js";
import type { AuditIssue } from "../../src/audits/core/auditIssue.js";
import type { AuditTarget } from "../../src/audits/core/auditTarget.js";
import { buildAuditReportModel, categorizeDetectorError } from "../../src/audits/report/auditReportModel.js";
import { renderAuditJsonReport } from "../../src/audits/report/renderAuditJsonReport.js";
import { renderAuditTextReport } from "../../src/audits/report/renderAuditTextReport.js";

// ---------------------------------------------------------------------------
// v0.3.0 Batch 6 — hardening/regression coverage for detector-error handling.
//
// auditRunner.ts's existing try/catch around detector.run()/shouldSkip()
// already normalizes any thrown value via
// `err instanceof Error ? err.message : String(err)` (confirmed by reading
// the source before writing this file) -- these tests prove that behavior
// end-to-end through the report model/renderers rather than re-asserting it
// as an assumption, and lock in that no .stack content ever reaches a
// rendered report (grep of src/audits/report/ and auditRunner.ts confirmed
// no `.stack` read anywhere before this batch).
// ---------------------------------------------------------------------------

const toolRoot = process.cwd();

function makeIssue(overrides: Partial<AuditIssue> = {}): AuditIssue {
  return {
    id: "issue-1",
    auditType: "code-rot",
    detectorId: "ok-detector",
    title: "Test issue",
    description: "Test description",
    severity: "medium",
    confidence: "medium",
    falsePositiveRisk: "low",
    category: "test",
    evidence: [],
    affectedFiles: [],
    recommendedAction: "Fix it.",
    suggestedFixStrategy: "n/a",
    validationCommands: [],
    releaseBlocking: false,
    implementationBlocking: false,
    autoFixEligible: false,
    ...overrides,
  };
}

function fakeTarget(): AuditTarget {
  return {
    rootPath: toolRoot,
    displayName: "fake",
    exists: true,
    isDirectory: true,
    packageJsonPath: path.join(toolRoot, "package.json"),
    gitRoot: toolRoot,
    isSelf: true,
    safeReportOutputRoot: path.join(toolRoot, "reports", "audits"),
  };
}

function throwingDetector(id: string, thrown: unknown): AuditDetector {
  return {
    id,
    auditType: "code-rot",
    title: `Throwing detector (${id})`,
    description: "Synthetic detector that always throws, for error-hardening tests.",
    supportedIncludeAreas: ["docs"],
    run: () => {
      throw thrown;
    },
  };
}

function okDetector(id: string): AuditDetector {
  return {
    id,
    auditType: "code-rot",
    title: `OK detector (${id})`,
    description: "Synthetic detector that always succeeds.",
    supportedIncludeAreas: ["docs"],
    run: () => [makeIssue({ id: `${id}-issue`, detectorId: id })],
  };
}

async function runWithRegistry(registry: readonly AuditDetector[]) {
  const config = normalizeAuditConfig({}, toolRoot);
  const result = await runAudit({ config, toolRoot, target: fakeTarget(), registry });
  const model = buildAuditReportModel(result, { target: fakeTarget(), registry });
  return { result, model, json: renderAuditJsonReport(model), text: renderAuditTextReport(model) };
}

describe("detector error hardening — thrown value normalization", () => {
  it("a thrown Error object is captured as a stable {id, message} shape", async () => {
    const { result } = await runWithRegistry([throwingDetector("d-error", new Error("boom from real Error"))]);
    expect(result.detectorErrors).toHaveLength(1);
    expect(result.detectorErrors[0]).toEqual({ id: "d-error", message: "boom from real Error" });
  });

  it("a thrown plain string is captured without crashing the runner", async () => {
    const { result } = await runWithRegistry([throwingDetector("d-string", "boom from string")]);
    expect(result.detectorErrors).toHaveLength(1);
    expect(result.detectorErrors[0].id).toBe("d-string");
    expect(result.detectorErrors[0].message).toBe("boom from string");
  });

  it("a thrown number is captured without crashing the runner", async () => {
    const { result } = await runWithRegistry([throwingDetector("d-number", 42)]);
    expect(result.detectorErrors).toHaveLength(1);
    expect(result.detectorErrors[0].message).toBe("42");
  });

  it("a thrown plain object is captured without crashing the runner", async () => {
    const { result } = await runWithRegistry([throwingDetector("d-object", { reason: "weird" })]);
    expect(result.detectorErrors).toHaveLength(1);
    expect(typeof result.detectorErrors[0].message).toBe("string");
  });

  it("a thrown undefined is captured without crashing the runner", async () => {
    const { result } = await runWithRegistry([throwingDetector("d-undefined", undefined)]);
    expect(result.detectorErrors).toHaveLength(1);
    expect(result.detectorErrors[0].message).toBe("undefined");
  });

  it("categorizeDetectorError never throws for any of the above normalized messages", () => {
    for (const message of ["boom from real Error", "boom from string", "42", "[object Object]", "undefined", ""]) {
      expect(() => categorizeDetectorError(message)).not.toThrow();
      expect(["filesystem", "parse", "unknown"]).toContain(categorizeDetectorError(message));
    }
  });
});

describe("detector error hardening — no stack-trace leakage", () => {
  it("a thrown real Error's .stack never appears in the JSON or text report", async () => {
    const err = new Error("boom with a real stack");
    const { json, text } = await runWithRegistry([throwingDetector("d-stack", err)]);
    expect(err.stack).toBeDefined();
    // Stack traces contain "    at " (Node) frames -- neither report format
    // should ever surface that shape for a detector error, only the bare
    // message.
    expect(json).not.toMatch(/\bat Object\.<anonymous>/);
    expect(text).not.toMatch(/\bat Object\.<anonymous>/);
    expect(text).not.toMatch(/\n\s+at /);
  });
});

describe("detector error hardening — hostile message sanitization", () => {
  const hostileMessage =
    "\x1b[31mFAKE RED\x1b[0m\n=== FAKE SECTION DIVIDER ===\n[BLOCKER] fake injected issue\x07";

  it("the JSON report preserves the hostile message content (JSON.stringify escapes control chars safely)", async () => {
    const { json } = await runWithRegistry([throwingDetector("d-hostile", new Error(hostileMessage))]);
    const parsed = JSON.parse(json) as { detectorErrors: { id: string; message: string }[] };
    const entry = parsed.detectorErrors.find((e) => e.id === "d-hostile");
    expect(entry).toBeDefined();
    expect(entry!.message).toContain("FAKE RED");
    expect(entry!.message).toContain("FAKE SECTION DIVIDER");
  });

  it("the text report sanitizes the hostile message (no raw ANSI escape, no bare injected divider line)", async () => {
    const { text } = await runWithRegistry([throwingDetector("d-hostile", new Error(hostileMessage))]);
    // eslint-disable-next-line no-control-regex
    expect(text).not.toMatch(/\x1b\[/);
    // The sanitized line collapses embedded newlines to spaces, so the fake
    // "===" divider and fake "[BLOCKER]" line can never appear as their own
    // bare, unindented report line.
    const lines = text.split("\n");
    expect(lines).not.toContain("=== FAKE SECTION DIVIDER ===");
    expect(lines).not.toContain("[BLOCKER] fake injected issue");
    expect(text).toContain("FAKE RED");
    expect(text).toContain("FAKE SECTION DIVIDER");
  });
});

describe("detector error hardening — isolation from other detectors", () => {
  it("one detector throwing does not prevent the other detectors from producing their normal results", async () => {
    const registry = [okDetector("first-ok"), throwingDetector("middle-throws", new Error("middle blew up")), okDetector("last-ok")];
    const { result } = await runWithRegistry(registry);

    expect(result.detectorErrors).toHaveLength(1);
    expect(result.detectorErrors[0].id).toBe("middle-throws");

    const issueDetectorIds = result.issues.map((i) => i.detectorId);
    expect(issueDetectorIds).toContain("first-ok");
    expect(issueDetectorIds).toContain("last-ok");
    expect(result.issues).toHaveLength(2);
  });
});
