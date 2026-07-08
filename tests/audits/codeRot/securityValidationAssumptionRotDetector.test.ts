import { describe, expect, it } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { scanProjectInventory } from "../../../src/audits/core/projectInventory.js";
import { collectSourceOfTruth } from "../../../src/audits/core/sourceOfTruth.js";
import { resolveAuditTarget } from "../../../src/audits/core/auditTarget.js";
import { normalizeAuditConfig } from "../../../src/audits/core/auditConfig.js";
import { SECURITY_VALIDATION_ASSUMPTION_ROT_DETECTOR } from "../../../src/audits/codeRot/detectors/securityValidationAssumptionRotDetector.js";
import type { AuditDetectorContext } from "../../../src/audits/core/auditRegistry.js";

function makeTempDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "sec-assumption-rot-test-"));
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
  const config = normalizeAuditConfig({ include: "docs,tests,package,architecture,cli" }, root);
  return { target, config, inventory, sourceOfTruth };
}

async function run(root: string) {
  const ctx = buildContext(root);
  return SECURITY_VALIDATION_ASSUMPTION_ROT_DETECTOR.run(ctx);
}

describe("SECURITY_VALIDATION_ASSUMPTION_ROT_DETECTOR — optional tool passed without hedge", () => {
  it("flags an unhedged 'semgrep passed' claim", async () => {
    const root = makeTempDir();
    try {
      writeFile(root, "package.json", JSON.stringify({ name: "fixture", version: "1.0.0", scripts: {} }));
      writeFile(root, "README.md", "Semgrep always passed during our last release check.\n");
      const issues = await run(root);
      expect(issues.some((i) => i.title.includes("passed"))).toBe(true);
    } finally {
      cleanup(root);
    }
  });

  it("does not flag a hedged 'semgrep passed' claim (optional/skipped nearby)", async () => {
    const root = makeTempDir();
    try {
      writeFile(root, "package.json", JSON.stringify({ name: "fixture", version: "1.0.0", scripts: {} }));
      writeFile(root, "README.md", "Semgrep is optional; when available it passed on the last release check.\n");
      const issues = await run(root);
      expect(issues.some((i) => i.title.includes("passed"))).toBe(false);
    } finally {
      cleanup(root);
    }
  });
});

describe("SECURITY_VALIDATION_ASSUMPTION_ROT_DETECTOR — exhaustive secret claim", () => {
  it("flags an unhedged exhaustive-secret-detection claim", async () => {
    const root = makeTempDir();
    try {
      writeFile(root, "package.json", JSON.stringify({ name: "fixture", version: "1.0.0", scripts: {} }));
      writeFile(root, "README.md", "This tool performs exhaustive secret scanning across all files.\n");
      const issues = await run(root);
      expect(issues.some((i) => i.title.includes("exhaustive"))).toBe(true);
    } finally {
      cleanup(root);
    }
  });

  it("does not flag a correctly-hedged 'cannot prove exhaustive secret absence' statement", async () => {
    const root = makeTempDir();
    try {
      writeFile(root, "package.json", JSON.stringify({ name: "fixture", version: "1.0.0", scripts: {} }));
      writeFile(root, "README.md", "Secret scanning is bounded and cannot prove exhaustive secret absence across every file.\n");
      const issues = await run(root);
      expect(issues.some((i) => i.title.includes("exhaustive"))).toBe(false);
    } finally {
      cleanup(root);
    }
  });
});

describe("SECURITY_VALIDATION_ASSUMPTION_ROT_DETECTOR — complete network isolation claim", () => {
  it("flags an unhedged complete network isolation claim", async () => {
    const root = makeTempDir();
    try {
      writeFile(root, "package.json", JSON.stringify({ name: "fixture", version: "1.0.0", scripts: {} }));
      writeFile(root, "README.md", "This tool guarantees complete network isolation at all times.\n");
      const issues = await run(root);
      expect(issues.some((i) => i.title.includes("network isolation"))).toBe(true);
    } finally {
      cleanup(root);
    }
  });
});

describe("SECURITY_VALIDATION_ASSUMPTION_ROT_DETECTOR — v0.2.1 stale security mention", () => {
  it("flags a v0.2.1 security-context mention with no historical framing when current version is 0.2.2+", async () => {
    const root = makeTempDir();
    try {
      writeFile(root, "package.json", JSON.stringify({ name: "fixture", version: "0.2.2", scripts: {} }));
      writeFile(root, "docs/SOMETHING.md", "The security validation in v0.2.1 is the current behavior for this tool.\n");
      const issues = await run(root);
      expect(issues.some((i) => i.title.includes("v0.2.1"))).toBe(true);
    } finally {
      cleanup(root);
    }
  });

  it("does not flag a v0.2.1 mention in CHANGELOG.md (definitionally historical)", async () => {
    const root = makeTempDir();
    try {
      writeFile(root, "package.json", JSON.stringify({ name: "fixture", version: "0.2.2", scripts: {} }));
      writeFile(root, "CHANGELOG.md", "## [0.2.1]\n\n- Fixed a security validation bug.\n");
      const issues = await run(root);
      expect(issues.some((i) => i.title.includes("v0.2.1"))).toBe(false);
    } finally {
      cleanup(root);
    }
  });

  it("does not flag a v0.2.1 mention framed as 'previous baseline'", async () => {
    const root = makeTempDir();
    try {
      writeFile(root, "package.json", JSON.stringify({ name: "fixture", version: "0.2.2", scripts: {} }));
      writeFile(root, "docs/SOMETHING.md", "### v0.2.1 — previous package baseline\n\nSecurity validation improvements landed here.\n");
      const issues = await run(root);
      expect(issues.some((i) => i.title.includes("v0.2.1"))).toBe(false);
    } finally {
      cleanup(root);
    }
  });
});

describe("SECURITY_VALIDATION_ASSUMPTION_ROT_DETECTOR — Android/mobile regex grouping guard", () => {
  it("does not flag a bare 'Android validation' mention with no implementation claim (regression guard for the alternation-grouping bug)", async () => {
    const root = makeTempDir();
    try {
      writeFile(root, "package.json", JSON.stringify({ name: "fixture", version: "1.0.0", scripts: {} }));
      writeFile(root, "docs/SOMETHING.md", "Android validation profiles are planned for a future release.\n");
      const issues = await run(root);
      expect(issues.some((i) => i.title.includes("Android"))).toBe(false);
    } finally {
      cleanup(root);
    }
  });
});

describe("SECURITY_VALIDATION_ASSUMPTION_ROT_DETECTOR — real self-scan regression guard", () => {
  it("produces no findings against this repo's own current, hedged security docs", async () => {
    const issues = await run(process.cwd());
    expect(issues).toEqual([]);
  });
});
