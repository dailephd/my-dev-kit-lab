import { describe, expect, it } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { scanProjectInventory } from "../../../src/audits/core/projectInventory.js";
import { collectSourceOfTruth } from "../../../src/audits/core/sourceOfTruth.js";
import { resolveAuditTarget } from "../../../src/audits/core/auditTarget.js";
import { normalizeAuditConfig } from "../../../src/audits/core/auditConfig.js";
import { DOCS_CODE_MISMATCH_DETECTOR } from "../../../src/audits/codeRot/detectors/docsCodeMismatchDetector.js";
import type { AuditDetectorContext } from "../../../src/audits/core/auditRegistry.js";

function makeTempDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "docs-mismatch-test-"));
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

function buildContext(root: string): AuditDetectorContext {
  const inventory = scanProjectInventory(root);
  const sourceOfTruth = collectSourceOfTruth(root, inventory);
  const target = resolveAuditTarget(undefined, root);
  const config = normalizeAuditConfig({}, root);
  return { target, config, inventory, sourceOfTruth };
}

async function run(root: string) {
  const ctx = buildContext(root);
  return DOCS_CODE_MISMATCH_DETECTOR.run(ctx);
}

function writeFixturePackage(root: string, overrides: Record<string, unknown> = {}): void {
  writeFile(
    root,
    "package.json",
    JSON.stringify({
      name: "fixture",
      version: "1.0.0",
      scripts: {},
      ...overrides,
    })
  );
}

describe("DOCS_CODE_MISMATCH_DETECTOR — feature claims", () => {
  it("flags docs saying a feature is implemented/current when source-of-truth shows it is missing", async () => {
    const root = makeTempDir();
    try {
      writeFixturePackage(root);
      writeFile(root, "README.md", "Security validation is implemented in this project.\n");
      const issues = await run(root);
      expect(issues.some((i) => i.category === "docs-feature-mismatch" && i.title.includes("security validation"))).toBe(true);
    } finally {
      cleanup(root);
    }
  });

  it("flags docs saying a feature is planned/future when it is already implemented", async () => {
    const root = makeTempDir();
    try {
      writeFixturePackage(root, { scripts: { "security:validate": "tsx scripts/security/validate.ts" } });
      writeFile(root, "src/securityValidation/index.ts", "export {};\n");
      writeFile(root, "README.md", "Security validation is planned for a future release.\n");
      const issues = await run(root);
      expect(
        issues.some((i) => i.title.includes("planned/future") && i.title.includes("security validation"))
      ).toBe(true);
    } finally {
      cleanup(root);
    }
  });

  it("does not flag a correct claim (feature is implemented and actually is)", async () => {
    const root = makeTempDir();
    try {
      writeFixturePackage(root, { scripts: { "security:validate": "tsx scripts/security/validate.ts" } });
      writeFile(root, "src/securityValidation/index.ts", "export {};\n");
      writeFile(root, "README.md", "Security validation is implemented in this project.\n");
      const issues = await run(root);
      expect(issues.some((i) => i.category === "docs-feature-mismatch" && i.title.includes("security validation"))).toBe(false);
    } finally {
      cleanup(root);
    }
  });
});

describe("DOCS_CODE_MISMATCH_DETECTOR — full-release-gate scoped claim", () => {
  it("flags a scoped run described as a full release gate", async () => {
    const root = makeTempDir();
    try {
      writeFixturePackage(root);
      writeFile(root, "README.md", "A scoped run should be treated as a full release gate.\n");
      const issues = await run(root);
      expect(issues.some((i) => i.title.includes("full release gate"))).toBe(true);
    } finally {
      cleanup(root);
    }
  });

  it("does not flag a correctly-hedged denial of the full-release-gate claim", async () => {
    const root = makeTempDir();
    try {
      writeFixturePackage(root);
      writeFile(root, "README.md", "A scoped run is not the same as a full release gate.\n");
      const issues = await run(root);
      expect(issues.some((i) => i.title.includes("full release gate"))).toBe(false);
    } finally {
      cleanup(root);
    }
  });
});

describe("DOCS_CODE_MISMATCH_DETECTOR — ambiguous prose", () => {
  it("reports a genuinely ambiguous same-line claim as low-confidence info, not skipped silently", async () => {
    const root = makeTempDir();
    try {
      writeFixturePackage(root);
      writeFile(root, "README.md", "Security validation is implemented, but security validation is planned.\n");
      const issues = await run(root);
      const ambiguous = issues.find((i) => i.category === "docs-feature-mismatch-ambiguous");
      expect(ambiguous).toBeDefined();
      expect(ambiguous?.severity).toBe("info");
      expect(ambiguous?.confidence).toBe("low");
    } finally {
      cleanup(root);
    }
  });

  it("does not treat the standard 'planned but not implemented' hedge phrase as ambiguous noise", async () => {
    const root = makeTempDir();
    try {
      writeFixturePackage(root);
      writeFile(
        root,
        "ROADMAP.md",
        "This roadmap separates the implemented baseline from planned work.\n"
      );
      const issues = await run(root);
      expect(issues.some((i) => i.category === "docs-feature-mismatch-ambiguous")).toBe(false);
    } finally {
      cleanup(root);
    }
  });
});

describe("DOCS_CODE_MISMATCH_DETECTOR — evidence and de-duplication", () => {
  it("issues include confidence and falsePositiveRisk", async () => {
    const root = makeTempDir();
    try {
      writeFixturePackage(root);
      writeFile(root, "README.md", "Security validation is implemented in this project.\n");
      const issues = await run(root);
      for (const issue of issues) {
        expect(issue.confidence).toBeDefined();
        expect(issue.falsePositiveRisk).toBeDefined();
      }
    } finally {
      cleanup(root);
    }
  });

  it("de-duplicates the same claim repeated in one file", async () => {
    const root = makeTempDir();
    try {
      writeFixturePackage(root);
      writeFile(
        root,
        "README.md",
        "Security validation is implemented here.\nSecurity validation is implemented here too.\n"
      );
      const issues = await run(root);
      const matches = issues.filter((i) => i.category === "docs-feature-mismatch" && i.title.includes("security validation"));
      expect(matches).toHaveLength(1);
    } finally {
      cleanup(root);
    }
  });
});
