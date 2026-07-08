import { describe, expect, it } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { normalizeAuditConfig } from "../../src/audits/core/auditConfig.js";
import { runAudit } from "../../src/audits/core/auditRunner.js";
import type { AuditDetector } from "../../src/audits/core/auditRegistry.js";
import type { AuditIssue } from "../../src/audits/core/auditIssue.js";

function makeTempDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "audit-runner-inventory-"));
}

function cleanup(...dirs: string[]): void {
  for (const d of dirs) {
    try {
      fs.rmSync(d, { recursive: true, force: true });
    } catch {
      // best-effort
    }
  }
}

function writeFile(root: string, relativePath: string, content = ""): void {
  const fullPath = path.join(root, relativePath);
  fs.mkdirSync(path.dirname(fullPath), { recursive: true });
  fs.writeFileSync(fullPath, content, "utf8");
}

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

describe("runAudit — inventory/source-of-truth integration", () => {
  it("includes an inventory snapshot", async () => {
    const root = makeTempDir();
    try {
      writeFile(root, "package.json", JSON.stringify({ name: "fixture", version: "1.0.0" }));
      writeFile(root, "src/index.ts", "export const x = 1;\n");
      const config = normalizeAuditConfig({}, root);
      const result = await runAudit({ config, toolRoot: root, registry: [] });
      expect(result.inventory).toBeDefined();
      expect(result.inventory.sourceFiles.map((f) => f.relativePath)).toContain("src/index.ts");
    } finally {
      cleanup(root);
    }
  });

  it("includes a source-of-truth snapshot", async () => {
    const root = makeTempDir();
    try {
      writeFile(root, "package.json", JSON.stringify({ name: "fixture", version: "1.0.0" }));
      const config = normalizeAuditConfig({}, root);
      const result = await runAudit({ config, toolRoot: root, registry: [] });
      expect(result.sourceOfTruth).toBeDefined();
      expect(result.sourceOfTruth.package?.name).toBe("fixture");
    } finally {
      cleanup(root);
    }
  });

  it("empty registry still returns 0 issues alongside inventory/source-of-truth data", async () => {
    const root = makeTempDir();
    try {
      writeFile(root, "package.json", JSON.stringify({ name: "fixture", version: "1.0.0" }));
      const config = normalizeAuditConfig({}, root);
      const result = await runAudit({ config, toolRoot: root, registry: [] });
      expect(result.issues).toEqual([]);
      expect(result.exitCode).toBe(0);
    } finally {
      cleanup(root);
    }
  });

  it("empty registry sets noDetectorsRegistered — does not claim code-rot coverage", async () => {
    const root = makeTempDir();
    try {
      writeFile(root, "package.json", JSON.stringify({ name: "fixture", version: "1.0.0" }));
      const config = normalizeAuditConfig({}, root);
      const result = await runAudit({ config, toolRoot: root, registry: [] });
      expect(result.noDetectorsRegistered).toBe(true);
    } finally {
      cleanup(root);
    }
  });

  it("a non-empty, matching registry sets noDetectorsRegistered to false", async () => {
    const root = makeTempDir();
    try {
      writeFile(root, "package.json", JSON.stringify({ name: "fixture", version: "1.0.0" }));
      const config = normalizeAuditConfig({}, root);
      const detector: AuditDetector = {
        id: "fixture-detector",
        auditType: "code-rot",
        title: "Fixture detector",
        description: "test",
        supportedIncludeAreas: config.include,
        run: () => [makeIssue()],
      };
      const result = await runAudit({ config, toolRoot: root, registry: [detector] });
      expect(result.noDetectorsRegistered).toBe(false);
      expect(result.issues).toHaveLength(1);
    } finally {
      cleanup(root);
    }
  });

  it("preserves existing skipped-detector behavior alongside inventory collection", async () => {
    const root = makeTempDir();
    try {
      writeFile(root, "package.json", JSON.stringify({ name: "fixture", version: "1.0.0" }));
      const config = normalizeAuditConfig({}, root);
      const detector: AuditDetector = {
        id: "skipper",
        auditType: "code-rot",
        title: "Skipper",
        description: "test",
        supportedIncludeAreas: config.include,
        shouldSkip: () => ({ skip: true, reason: "unavailable" }),
        run: () => [makeIssue()],
      };
      const result = await runAudit({ config, toolRoot: root, registry: [detector] });
      expect(result.skippedDetectors).toEqual([{ id: "skipper", reason: "unavailable" }]);
      expect(result.issues).toEqual([]);
      expect(result.inventory).toBeDefined();
    } finally {
      cleanup(root);
    }
  });

  it("inventory warnings (e.g. an unreadable file) do not crash the run", async () => {
    const root = makeTempDir();
    try {
      writeFile(root, "package.json", JSON.stringify({ name: "fixture", version: "1.0.0" }));
      writeFile(root, "src/normal.ts", "export const x = 1;\n");
      const config = normalizeAuditConfig({}, root);
      // A clean fixture won't naturally produce warnings, but this confirms
      // the warnings array is always present and well-formed, and that a
      // normal run completes without throwing.
      const result = await runAudit({ config, toolRoot: root, registry: [] });
      expect(Array.isArray(result.inventory.warnings)).toBe(true);
      expect(Array.isArray(result.sourceOfTruth.warnings)).toBe(true);
    } finally {
      cleanup(root);
    }
  });

  it("fails cleanly (rejects) for an invalid target — no pre-resolved target and no target on disk", async () => {
    const missing = path.join(os.tmpdir(), "audit-runner-missing-target-" + Date.now());
    const config = normalizeAuditConfig({ target: missing }, process.cwd());
    await expect(runAudit({ config, toolRoot: process.cwd() })).rejects.toThrow(/does not exist/);
  });
});
