import { describe, expect, it } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { DEFAULT_AUDIT_REGISTRY } from "../../../src/audits/core/auditRegistry.js";
import { normalizeAuditConfig } from "../../../src/audits/core/auditConfig.js";
import { runAudit } from "../../../src/audits/core/auditRunner.js";

function makeTempDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "code-rot-registry-test-"));
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

describe("DEFAULT_AUDIT_REGISTRY — Batch 3 detectors", () => {
  it("contains the 3 Batch 3 code-rot detectors", () => {
    const ids = DEFAULT_AUDIT_REGISTRY.map((d) => d.id);
    expect(ids).toContain("stale-command-reference");
    expect(ids).toContain("docs-code-mismatch");
    expect(ids).toContain("package-release-rot");
  });

  it("is no longer empty", () => {
    expect(DEFAULT_AUDIT_REGISTRY.length).toBeGreaterThan(0);
  });

  it("every registered detector has auditType code-rot", () => {
    for (const detector of DEFAULT_AUDIT_REGISTRY) {
      expect(detector.auditType).toBe("code-rot");
    }
  });

  it("every registered detector has a unique id", () => {
    const ids = DEFAULT_AUDIT_REGISTRY.map((d) => d.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
});

describe("DEFAULT_AUDIT_REGISTRY — Batch 3+4 detectors", () => {
  it("contains the 10 Batch 3+4 code-rot detectors", () => {
    const ids = DEFAULT_AUDIT_REGISTRY.map((d) => d.id);
    expect(ids).toContain("stale-command-reference");
    expect(ids).toContain("docs-code-mismatch");
    expect(ids).toContain("package-release-rot");
    expect(ids).toContain("duplicate-implementation-candidate");
    expect(ids).toContain("dead-code-candidate");
    expect(ids).toContain("test-rot");
    expect(ids).toContain("architecture-drift");
    expect(ids).toContain("dependency-environment-rot");
    expect(ids).toContain("cross-platform-rot");
    expect(ids).toContain("security-validation-assumption-rot");
    expect(ids.length).toBe(10);
  });

  it("every registered detector has auditType code-rot (Batch 4)", () => {
    for (const detector of DEFAULT_AUDIT_REGISTRY) {
      expect(detector.auditType).toBe("code-rot");
    }
  });
});

describe("runAudit — Batch 3 default registry behavior", () => {
  it("noDetectorsRegistered is false for a default code-rot audit", async () => {
    const root = makeTempDir();
    try {
      writeFile(root, "package.json", JSON.stringify({ name: "fixture", version: "1.0.0" }));
      const config = normalizeAuditConfig({}, root);
      const result = await runAudit({ config, toolRoot: root });
      expect(result.noDetectorsRegistered).toBe(false);
    } finally {
      cleanup(root);
    }
  });

  it("produces real issues against a fixture with a stale doc command reference", async () => {
    const root = makeTempDir();
    try {
      writeFile(root, "package.json", JSON.stringify({ name: "fixture", version: "1.0.0", scripts: {} }));
      writeFile(root, "README.md", "Run `npm run totally-fake-command` to get started.\n");
      const config = normalizeAuditConfig({ failOn: "none" }, root);
      const result = await runAudit({ config, toolRoot: root });
      expect(result.issues.length).toBeGreaterThan(0);
    } finally {
      cleanup(root);
    }
  });

  it("--fail-on none exits 0 even with issues present", async () => {
    const root = makeTempDir();
    try {
      writeFile(root, "package.json", JSON.stringify({ name: "fixture", version: "1.0.0", scripts: {} }));
      writeFile(root, "README.md", "Run `npm run totally-fake-command` to get started.\n");
      const config = normalizeAuditConfig({ failOn: "none" }, root);
      const result = await runAudit({ config, toolRoot: root });
      expect(result.issues.length).toBeGreaterThan(0);
      expect(result.exitCode).toBe(0);
    } finally {
      cleanup(root);
    }
  });

  it("--fail-on high exits 1 when a high-severity issue exists", async () => {
    const root = makeTempDir();
    try {
      writeFile(root, "package.json", JSON.stringify({ name: "fixture", version: "1.0.0", scripts: {} }));
      writeFile(root, "README.md", "Run `npm run totally-fake-command` to get started.\n");
      const config = normalizeAuditConfig({ failOn: "high" }, root);
      const result = await runAudit({ config, toolRoot: root });
      expect(result.issues.some((i) => i.severity === "high")).toBe(true);
      expect(result.exitCode).toBe(1);
    } finally {
      cleanup(root);
    }
  });

  it("a clean fixture (no stale references, matching versions, hedged docs) exits 0", async () => {
    const root = makeTempDir();
    try {
      writeFile(root, "package.json", JSON.stringify({ name: "fixture", version: "1.0.0", scripts: {} }));
      writeFile(root, "package-lock.json", JSON.stringify({ name: "fixture", version: "1.0.0", lockfileVersion: 3 }));
      writeFile(root, "CHANGELOG.md", "# Changelog\n\n## [1.0.0] - 2024-01-01\n\nInitial.\n");
      writeFile(root, "README.md", "This is a clean fixture project with no stale references.\n");
      const config = normalizeAuditConfig({}, root);
      const result = await runAudit({ config, toolRoot: root });
      expect(result.issues).toEqual([]);
      expect(result.exitCode).toBe(0);
    } finally {
      cleanup(root);
    }
  });

  it("scoped include selection (package only) skips docs-only detectors clearly (via skippedDetectors)", async () => {
    const root = makeTempDir();
    try {
      writeFile(root, "package.json", JSON.stringify({ name: "fixture", version: "1.0.0", scripts: {} }));
      const config = normalizeAuditConfig({ include: "package" }, root);
      const result = await runAudit({ config, toolRoot: root });
      const skippedIds = result.skippedDetectors.map((d) => d.id);
      expect(skippedIds).toContain("stale-command-reference");
      expect(skippedIds).toContain("docs-code-mismatch");
    } finally {
      cleanup(root);
    }
  });
});
