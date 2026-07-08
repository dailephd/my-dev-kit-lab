import { describe, expect, it } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { normalizeAuditConfig } from "../../src/audits/core/auditConfig.js";
import { runAudit } from "../../src/audits/core/auditRunner.js";
import type { AuditDetector, AuditDetectorContext } from "../../src/audits/core/auditRegistry.js";
import type { AuditIssue } from "../../src/audits/core/auditIssue.js";

function makeTempDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "detector-context-test-"));
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

describe("AuditDetectorContext — Batch 3 extension", () => {
  it("a detector receives the inventory snapshot", async () => {
    const root = makeTempDir();
    try {
      writeFile(root, "package.json", JSON.stringify({ name: "fixture", version: "1.0.0" }));
      writeFile(root, "src/index.ts", "export const x = 1;\n");
      const config = normalizeAuditConfig({}, root);

      let capturedCtx: AuditDetectorContext | undefined;
      const detector: AuditDetector = {
        id: "context-capture",
        auditType: "code-rot",
        title: "Context capture",
        description: "test",
        supportedIncludeAreas: config.include,
        run: (ctx) => {
          capturedCtx = ctx;
          return [];
        },
      };

      await runAudit({ config, toolRoot: root, registry: [detector] });
      expect(capturedCtx?.inventory).toBeDefined();
      expect(capturedCtx?.inventory.sourceFiles.map((f) => f.relativePath)).toContain("src/index.ts");
    } finally {
      cleanup(root);
    }
  });

  it("a detector receives the sourceOfTruth snapshot", async () => {
    const root = makeTempDir();
    try {
      writeFile(root, "package.json", JSON.stringify({ name: "fixture", version: "1.0.0" }));
      const config = normalizeAuditConfig({}, root);

      let capturedCtx: AuditDetectorContext | undefined;
      const detector: AuditDetector = {
        id: "context-capture",
        auditType: "code-rot",
        title: "Context capture",
        description: "test",
        supportedIncludeAreas: config.include,
        run: (ctx) => {
          capturedCtx = ctx;
          return [];
        },
      };

      await runAudit({ config, toolRoot: root, registry: [detector] });
      expect(capturedCtx?.sourceOfTruth).toBeDefined();
      expect(capturedCtx?.sourceOfTruth.package?.name).toBe("fixture");
    } finally {
      cleanup(root);
    }
  });

  it("a detector receives config", async () => {
    const root = makeTempDir();
    try {
      writeFile(root, "package.json", JSON.stringify({ name: "fixture", version: "1.0.0" }));
      const config = normalizeAuditConfig({ failOn: "high" }, root);

      let capturedCtx: AuditDetectorContext | undefined;
      const detector: AuditDetector = {
        id: "context-capture",
        auditType: "code-rot",
        title: "Context capture",
        description: "test",
        supportedIncludeAreas: config.include,
        run: (ctx) => {
          capturedCtx = ctx;
          return [];
        },
      };

      await runAudit({ config, toolRoot: root, registry: [detector] });
      expect(capturedCtx?.config.failOn).toBe("high");
    } finally {
      cleanup(root);
    }
  });

  it("a detector receives target", async () => {
    const root = makeTempDir();
    try {
      writeFile(root, "package.json", JSON.stringify({ name: "fixture", version: "1.0.0" }));
      const config = normalizeAuditConfig({}, root);

      let capturedCtx: AuditDetectorContext | undefined;
      const detector: AuditDetector = {
        id: "context-capture",
        auditType: "code-rot",
        title: "Context capture",
        description: "test",
        supportedIncludeAreas: config.include,
        run: (ctx) => {
          capturedCtx = ctx;
          return [];
        },
      };

      await runAudit({ config, toolRoot: root, registry: [detector] });
      expect(path.resolve(capturedCtx?.target.rootPath ?? "")).toBe(path.resolve(root));
    } finally {
      cleanup(root);
    }
  });

  it("does not recompute inventory/sourceOfTruth per detector — same object reference across detectors in one run", async () => {
    const root = makeTempDir();
    try {
      writeFile(root, "package.json", JSON.stringify({ name: "fixture", version: "1.0.0" }));
      const config = normalizeAuditConfig({}, root);

      const capturedInventories: unknown[] = [];
      const capturedSourceOfTruths: unknown[] = [];
      const makeCapturingDetector = (id: string): AuditDetector => ({
        id,
        auditType: "code-rot",
        title: id,
        description: "test",
        supportedIncludeAreas: config.include,
        run: (ctx) => {
          capturedInventories.push(ctx.inventory);
          capturedSourceOfTruths.push(ctx.sourceOfTruth);
          return [];
        },
      });

      await runAudit({
        config,
        toolRoot: root,
        registry: [makeCapturingDetector("a"), makeCapturingDetector("b")],
      });

      expect(capturedInventories[0]).toBe(capturedInventories[1]);
      expect(capturedSourceOfTruths[0]).toBe(capturedSourceOfTruths[1]);
    } finally {
      cleanup(root);
    }
  });

  it("detector errors are still isolated by the runner when a detector uses the extended context", async () => {
    const root = makeTempDir();
    try {
      writeFile(root, "package.json", JSON.stringify({ name: "fixture", version: "1.0.0" }));
      const config = normalizeAuditConfig({}, root);

      const throwing: AuditDetector = {
        id: "throws",
        auditType: "code-rot",
        title: "Throws",
        description: "test",
        supportedIncludeAreas: config.include,
        run: (ctx) => {
          // Touches the extended context fields before throwing -- proves
          // the error isolation still works even when a detector reads
          // inventory/sourceOfTruth.
          void ctx.inventory.totalFileCount;
          void ctx.sourceOfTruth.package?.name;
          throw new Error("boom");
        },
      };
      const healthy: AuditDetector = {
        id: "healthy",
        auditType: "code-rot",
        title: "Healthy",
        description: "test",
        supportedIncludeAreas: config.include,
        run: (): AuditIssue[] => [],
      };

      const result = await runAudit({ config, toolRoot: root, registry: [throwing, healthy] });
      expect(result.detectorErrors).toEqual([{ id: "throws", message: "boom" }]);
    } finally {
      cleanup(root);
    }
  });
});
