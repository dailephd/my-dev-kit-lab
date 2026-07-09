import { describe, expect, it } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { normalizeAuditConfig } from "../../src/audits/core/auditConfig.js";
import { runAudit } from "../../src/audits/core/auditRunner.js";
import type { AuditDetector } from "../../src/audits/core/auditRegistry.js";
import type { AuditIssue } from "../../src/audits/core/auditIssue.js";

// ---------------------------------------------------------------------------
// v0.3.1 Batch 2 -- confirms runAudit() populates AuditResult.sourceFacts
// (and passes it through AuditDetectorContext) without breaking existing
// detector behavior. sourceFacts is optional on AuditDetectorContext (see
// auditRegistry.ts) precisely so a detector that ignores it entirely keeps
// working unchanged -- this test proves both halves of that contract.
// ---------------------------------------------------------------------------

function makeTempDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "audit-runner-source-facts-"));
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

describe("runAudit — source facts integration", () => {
  it("includes a sourceFacts snapshot alongside inventory/source-of-truth", async () => {
    const root = makeTempDir();
    try {
      writeFile(root, "package.json", JSON.stringify({ name: "fixture", version: "1.0.0" }));
      writeFile(root, "src/index.ts", "export const x = 1;\n");
      const config = normalizeAuditConfig({}, root);
      const result = await runAudit({ config, toolRoot: root, registry: [] });
      expect(result.sourceFacts).toBeDefined();
      const entry = result.sourceFacts.files.find((f) => f.relativePath === "src/index.ts");
      // v0.3.1 Batch 3 -- runAudit() uses collectSourceFacts()'s default
      // registry, which now includes the TypeScript/JavaScript analyzer, so
      // this file is actually parsed rather than falling back.
      expect(entry?.parseStatus).toBe("parsed");
      expect(entry?.analyzerId).toBe("typescript-javascript-analyzer");
      expect(entry?.exports.some((e) => e.name === "x")).toBe(true);
    } finally {
      cleanup(root);
    }
  });

  it("a detector that ignores ctx.sourceFacts still runs and produces issues normally", async () => {
    const root = makeTempDir();
    try {
      writeFile(root, "package.json", JSON.stringify({ name: "fixture", version: "1.0.0" }));
      writeFile(root, "src/index.ts", "export const x = 1;\n");
      const config = normalizeAuditConfig({}, root);
      const detector: AuditDetector = {
        id: "ignores-source-facts",
        auditType: "code-rot",
        title: "Ignores source facts",
        description: "test",
        supportedIncludeAreas: config.include,
        run: (ctx) => {
          // Deliberately does not touch ctx.sourceFacts -- proves existing
          // detectors keep working unchanged even though the field exists.
          expect(ctx.inventory).toBeDefined();
          return [makeIssue()];
        },
      };
      const result = await runAudit({ config, toolRoot: root, registry: [detector] });
      expect(result.issues).toHaveLength(1);
      expect(result.detectorErrors).toEqual([]);
    } finally {
      cleanup(root);
    }
  });

  it("a detector that does read ctx.sourceFacts can see the collected snapshot", async () => {
    const root = makeTempDir();
    try {
      writeFile(root, "package.json", JSON.stringify({ name: "fixture", version: "1.0.0" }));
      writeFile(root, "src/index.ts", "export const x = 1;\n");
      const config = normalizeAuditConfig({}, root);
      let seenFileCount = -1;
      const detector: AuditDetector = {
        id: "reads-source-facts",
        auditType: "code-rot",
        title: "Reads source facts",
        description: "test",
        supportedIncludeAreas: config.include,
        run: (ctx) => {
          seenFileCount = ctx.sourceFacts?.files.length ?? -1;
          return [];
        },
      };
      await runAudit({ config, toolRoot: root, registry: [detector] });
      expect(seenFileCount).toBeGreaterThan(0);
    } finally {
      cleanup(root);
    }
  });
});
