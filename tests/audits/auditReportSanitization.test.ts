import path from "node:path";
import { describe, expect, it } from "vitest";
import { normalizeAuditConfig } from "../../src/audits/core/auditConfig.js";
import { runAudit } from "../../src/audits/core/auditRunner.js";
import type { AuditDetector } from "../../src/audits/core/auditRegistry.js";
import type { AuditIssue } from "../../src/audits/core/auditIssue.js";
import type { AuditTarget } from "../../src/audits/core/auditTarget.js";
import { buildAuditReportModel } from "../../src/audits/report/auditReportModel.js";
import { renderAuditJsonReport } from "../../src/audits/report/renderAuditJsonReport.js";
import { renderAuditTextReport } from "../../src/audits/report/renderAuditTextReport.js";

// ---------------------------------------------------------------------------
// v0.3.0 Batch 5 — sanitization tests for hostile evidence content.
// ---------------------------------------------------------------------------

const toolRoot = process.cwd();

const ANSI_PAYLOAD = "\x1b[31mFAKE\x1b[0m";
const CONTROL_CHAR_PAYLOAD = "line-one\x00\x07-embedded-control-chars";
const FAKE_DIVIDER = "=".repeat(72);
const FAKE_HEADER_LINE = "[BLOCKER] Fake injected issue header pretending to be real";
const HUGE_EXCERPT = "X".repeat(10_000);

function hostileIssue(): AuditIssue {
  return {
    id: "hostile-issue",
    auditType: "code-rot",
    detectorId: "hostile-detector",
    title: `Hostile title ${ANSI_PAYLOAD} ${CONTROL_CHAR_PAYLOAD}`,
    description: "Hostile description",
    severity: "high",
    confidence: "medium",
    falsePositiveRisk: "medium",
    category: "test",
    evidence: [
      {
        kind: "observation",
        message: "hostile evidence message",
        excerpt: `${FAKE_DIVIDER}\n${FAKE_HEADER_LINE}\n${ANSI_PAYLOAD}${CONTROL_CHAR_PAYLOAD}${HUGE_EXCERPT}`,
        source: "hostile-detector",
        confidence: "medium",
      },
    ],
    affectedFiles: ["some/file.ts"],
    recommendedAction: `Fix it ${ANSI_PAYLOAD}`,
    suggestedFixStrategy: "n/a",
    validationCommands: [],
    releaseBlocking: false,
    implementationBlocking: false,
    autoFixEligible: false,
  };
}

function hostileDetector(): AuditDetector {
  return {
    id: "hostile-detector",
    auditType: "code-rot",
    title: "Hostile detector",
    description: "test",
    supportedIncludeAreas: ["docs"],
    run: () => [hostileIssue()],
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

async function buildHostileModel() {
  const config = normalizeAuditConfig({ failOn: "none" }, toolRoot);
  const detector = hostileDetector();
  const result = await runAudit({ config, toolRoot, target: fakeTarget(), registry: [detector] });
  return buildAuditReportModel(result, { target: fakeTarget(), registry: [detector] });
}

describe("audit report sanitization — text renderer", () => {
  it("strips ANSI escape sequences and control characters", async () => {
    const model = await buildHostileModel();
    const text = renderAuditTextReport(model);
    expect(text).not.toContain("\x1b[31m");
    expect(text).not.toContain("\x1b[0m");
    expect(text).not.toContain("\x00");
    expect(text).not.toContain("\x07");
  });

  it("bounds excerpt length in text output", async () => {
    const model = await buildHostileModel();
    const text = renderAuditTextReport(model);
    // The 10,000-char excerpt must never appear verbatim/unbounded.
    expect(text).not.toContain(HUGE_EXCERPT);
    expect(text).toContain("truncated");
  });

  it("fake divider/header content in evidence is attributed as quoted evidence, not a bare structural line", async () => {
    const model = await buildHostileModel();
    const text = renderAuditTextReport(model);
    // The evidence excerpt line is quote-prefixed ("> ") rather than
    // appearing as an unindented, bare line that could be mistaken for a
    // real section divider or a real "[BLOCKER]"-style heading.
    const lines = text.split("\n");
    const fakeHeaderLine = lines.find((l) => l.includes("Fake injected issue header"));
    expect(fakeHeaderLine).toBeDefined();
    expect(fakeHeaderLine!.trim().startsWith(">")).toBe(true);
  });

  it("remains readable (non-empty, structured) despite hostile content", async () => {
    const model = await buildHostileModel();
    const text = renderAuditTextReport(model);
    expect(text.length).toBeGreaterThan(0);
    expect(text).toContain("Issues (grouped by severity)");
    expect(text).toContain("Exit result");
  });
});

describe("audit report sanitization — JSON renderer", () => {
  it("JSON remains valid/parseable with hostile content", async () => {
    const model = await buildHostileModel();
    const json = renderAuditJsonReport(model);
    expect(() => JSON.parse(json)).not.toThrow();
  });

  it("JSON evidence field content is present, not silently dropped", async () => {
    const model = await buildHostileModel();
    const parsed = JSON.parse(renderAuditJsonReport(model));
    const issue = parsed.issues.find((i: { id: string }) => i.id === "hostile-issue");
    expect(issue).toBeDefined();
    expect(issue.evidence[0].excerpt).toBeTruthy();
    // JSON.stringify safely escapes control chars into \u00XX sequences by
    // spec -- round-tripping through JSON.parse recovers the raw characters,
    // proving they were preserved (escaped), not stripped.
    expect(issue.evidence[0].excerpt).toContain(FAKE_HEADER_LINE);
  });
});
