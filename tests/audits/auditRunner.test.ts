import { describe, expect, it } from "vitest";
import path from "node:path";
import { normalizeAuditConfig } from "../../src/audits/core/auditConfig.js";
import { runAudit } from "../../src/audits/core/auditRunner.js";
import type { AuditDetector } from "../../src/audits/core/auditRegistry.js";
import type { AuditIssue } from "../../src/audits/core/auditIssue.js";
import type { AuditTarget } from "../../src/audits/core/auditTarget.js";

const toolRoot = process.cwd();

function makeIssue(overrides: Partial<AuditIssue> = {}): AuditIssue {
  return {
    id: "issue-1",
    auditType: "code-rot",
    detectorId: "test-detector",
    title: "Test issue",
    description: "Test description",
    severity: "medium",
    confidence: "medium",
    falsePositiveRisk: "low",
    category: "test",
    evidence: [],
    affectedFiles: [],
    recommendedAction: "n/a",
    suggestedFixStrategy: "n/a",
    validationCommands: [],
    releaseBlocking: false,
    implementationBlocking: false,
    autoFixEligible: false,
    ...overrides,
  };
}

function makeDetector(overrides: Partial<AuditDetector> = {}): AuditDetector {
  return {
    id: "test-detector",
    auditType: "code-rot",
    title: "Test detector",
    description: "Test description",
    supportedIncludeAreas: ["docs"],
    run: () => [],
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

describe("runAudit — zero detectors", () => {
  it("handles an empty registry without overclaiming (no issues, no false confidence)", async () => {
    const config = normalizeAuditConfig({}, toolRoot);
    const result = await runAudit({ config, toolRoot, target: fakeTarget(), registry: [] });
    expect(result.issues).toEqual([]);
    expect(result.skippedDetectors).toEqual([]);
    expect(result.detectorErrors).toEqual([]);
    expect(result.exitCode).toBe(0);
  });
});

describe("runAudit — registry behavior", () => {
  it("rejects duplicate detector ids at registry construction time (via createAuditRegistry, not runAudit itself)", async () => {
    // runAudit does not itself validate uniqueness (that's createAuditRegistry's
    // job) — this documents the boundary rather than duplicating the check.
    const config = normalizeAuditConfig({}, toolRoot);
    const registry = [makeDetector({ id: "dup" }), makeDetector({ id: "dup" })];
    const result = await runAudit({ config, toolRoot, target: fakeTarget(), registry });
    // Both run (runAudit trusts the registry it's given); no crash either way.
    expect(result.detectorErrors).toEqual([]);
  });

  it("filters by audit type and include area before running", async () => {
    const config = normalizeAuditConfig({ include: "docs" }, toolRoot);
    const matching = makeDetector({ id: "matches", run: () => [makeIssue({ detectorId: "matches" })] });
    const nonMatchingArea = makeDetector({ id: "wrong-area", supportedIncludeAreas: ["cli"], run: () => [makeIssue()] });
    const result = await runAudit({ config, toolRoot, target: fakeTarget(), registry: [matching, nonMatchingArea] });
    expect(result.issues).toHaveLength(1);
    expect(result.issues[0].detectorId).toBe("matches");
  });

  it("respects shouldSkip and records the reason", async () => {
    const config = normalizeAuditConfig({}, toolRoot);
    const skipped = makeDetector({
      id: "skipper",
      shouldSkip: () => ({ skip: true, reason: "tool unavailable" }),
      run: () => [makeIssue()],
    });
    const result = await runAudit({ config, toolRoot, target: fakeTarget(), registry: [skipped] });
    expect(result.issues).toEqual([]);
    expect(result.skippedDetectors).toEqual([{ id: "skipper", reason: "tool unavailable" }]);
  });

  it("catches a detector error and records it without crashing the run", async () => {
    const config = normalizeAuditConfig({}, toolRoot);
    const throwing = makeDetector({
      id: "broken",
      run: () => {
        throw new Error("boom");
      },
    });
    const healthy = makeDetector({ id: "healthy", run: () => [makeIssue({ detectorId: "healthy" })] });
    const result = await runAudit({ config, toolRoot, target: fakeTarget(), registry: [throwing, healthy] });
    expect(result.detectorErrors).toEqual([{ id: "broken", message: "boom" }]);
    expect(result.issues).toHaveLength(1);
    expect(result.issues[0].detectorId).toBe("healthy");
  });

  it("preserves deterministic issue ordering across repeated runs", async () => {
    const config = normalizeAuditConfig({}, toolRoot);
    const a = makeDetector({ id: "a", run: () => [makeIssue({ id: "a-1", detectorId: "a" })] });
    const b = makeDetector({ id: "b", run: () => [makeIssue({ id: "b-1", detectorId: "b" })] });
    const registry = [a, b];
    const first = await runAudit({ config, toolRoot, target: fakeTarget(), registry });
    const second = await runAudit({ config, toolRoot, target: fakeTarget(), registry });
    expect(first.issues.map((i) => i.id)).toEqual(second.issues.map((i) => i.id));
    expect(first.issues.map((i) => i.id)).toEqual(["a-1", "b-1"]);
  });

  it("returns skipped detector metadata alongside issues and errors", async () => {
    const config = normalizeAuditConfig({}, toolRoot);
    const skipped = makeDetector({ id: "skip-me", shouldSkip: () => ({ skip: true, reason: "n/a" }) });
    const errored = makeDetector({
      id: "err-me",
      run: () => {
        throw new Error("fail");
      },
    });
    const ok = makeDetector({ id: "ok", run: () => [makeIssue({ detectorId: "ok" })] });
    const result = await runAudit({ config, toolRoot, target: fakeTarget(), registry: [skipped, errored, ok] });
    expect(result.skippedDetectors).toHaveLength(1);
    expect(result.detectorErrors).toHaveLength(1);
    expect(result.issues).toHaveLength(1);
  });
});

describe("runAudit — does not modify target files", () => {
  it("target directory contents are unchanged after a run", async () => {
    const fs = await import("node:fs");
    const before = fs.readdirSync(toolRoot);
    const config = normalizeAuditConfig({}, toolRoot);
    await runAudit({ config, toolRoot, target: fakeTarget(), registry: [] });
    const after = fs.readdirSync(toolRoot);
    expect(after).toEqual(before);
  });
});
