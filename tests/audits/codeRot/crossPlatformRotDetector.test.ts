import { describe, expect, it } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { scanProjectInventory } from "../../../src/audits/core/projectInventory.js";
import { collectSourceOfTruth } from "../../../src/audits/core/sourceOfTruth.js";
import { resolveAuditTarget } from "../../../src/audits/core/auditTarget.js";
import { normalizeAuditConfig } from "../../../src/audits/core/auditConfig.js";
import { CROSS_PLATFORM_ROT_DETECTOR } from "../../../src/audits/codeRot/detectors/crossPlatformRotDetector.js";
import type { AuditDetectorContext } from "../../../src/audits/core/auditRegistry.js";

function makeTempDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "cross-platform-rot-test-"));
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
  return CROSS_PLATFORM_ROT_DETECTOR.run(ctx);
}

describe("CROSS_PLATFORM_ROT_DETECTOR — POSIX-only script syntax", () => {
  it("flags a bare rm -rf script segment as high severity when docs claim Windows support", async () => {
    const root = makeTempDir();
    try {
      writeFile(root, "package.json", JSON.stringify({ name: "fixture", version: "1.0.0", scripts: { clean: "rm -rf dist" } }));
      writeFile(root, "README.md", "This tool supports Windows, macOS, and Linux.\n");
      const issues = await run(root);
      const issue = issues.find((i) => i.title.includes("POSIX-only shell syntax"));
      expect(issue).toBeDefined();
      expect(issue?.severity).toBe("high");
    } finally {
      cleanup(root);
    }
  });

  it("does not flag a node-wrapped script with no bare POSIX binaries", async () => {
    const root = makeTempDir();
    try {
      writeFile(root, "package.json", JSON.stringify({ name: "fixture", version: "1.0.0", scripts: { clean: "node scripts/clean.mjs" } }));
      const issues = await run(root);
      expect(issues.some((i) => i.title.includes("POSIX-only shell syntax"))).toBe(false);
    } finally {
      cleanup(root);
    }
  });
});

describe("CROSS_PLATFORM_ROT_DETECTOR — raw split(\"\\n\") outside splitLines()", () => {
  it("flags a raw .split(\"\\n\") in a src/audits file", async () => {
    const root = makeTempDir();
    try {
      writeFile(root, "package.json", JSON.stringify({ name: "fixture", version: "1.0.0", scripts: {} }));
      writeFile(root, "src/audits/codeRot/detectors/exampleDetector.ts", 'const lines = content.split("\\n");\nexport { lines };\n');
      const issues = await run(root);
      expect(issues.some((i) => i.title.includes("splitLines()"))).toBe(true);
    } finally {
      cleanup(root);
    }
  });

  it("does not flag textLines.ts itself (the canonical implementation)", async () => {
    const root = makeTempDir();
    try {
      writeFile(root, "package.json", JSON.stringify({ name: "fixture", version: "1.0.0", scripts: {} }));
      writeFile(root, "src/audits/codeRot/utils/textLines.ts", 'export function splitLines(content) {\n  return content.split("\\n");\n}\n');
      const issues = await run(root);
      expect(issues.some((i) => i.title.includes("splitLines()"))).toBe(false);
    } finally {
      cleanup(root);
    }
  });
});

describe("CROSS_PLATFORM_ROT_DETECTOR — shell: true usage", () => {
  it("flags an exec/spawn call with shell: true nearby", async () => {
    const root = makeTempDir();
    try {
      writeFile(root, "package.json", JSON.stringify({ name: "fixture", version: "1.0.0", scripts: {} }));
      writeFile(root, "src/audits/codeRot/detectors/exampleDetector.ts", 'import { spawn } from "node:child_process";\nspawn("ls", [], { shell: true });\n');
      const issues = await run(root);
      expect(issues.some((i) => i.title.includes("shell: true"))).toBe(true);
    } finally {
      cleanup(root);
    }
  });

  it("does not flag a source file with no shell: true usage", async () => {
    const root = makeTempDir();
    try {
      writeFile(root, "package.json", JSON.stringify({ name: "fixture", version: "1.0.0", scripts: {} }));
      writeFile(root, "src/audits/codeRot/detectors/exampleDetector.ts", "export const x = 1;\n");
      const issues = await run(root);
      expect(issues.some((i) => i.title.includes("shell: true"))).toBe(false);
    } finally {
      cleanup(root);
    }
  });
});

describe("CROSS_PLATFORM_ROT_DETECTOR — real self-scan regression guard", () => {
  // v0.3.0 Batch 6 fixed the one known, genuine, pre-existing (Batch 2)
  // finding this test used to lock in -- src/audits/core/sourceOfTruth.ts's
  // parseNodeVersions() used to call a raw content.split("\n") instead of
  // the project's own splitLines() helper (Batch 4 was not permitted to fix
  // it; Batch 6's spec 3.1 explicitly is). sourceOfTruth.ts now imports
  // splitLines() from the new src/audits/core/textLines.ts, so this
  // detector no longer has any real finding against this repo's own source
  // -- verified via a real self-audit run (see the Batch 6 final report),
  // not just this unit-level check.
  it("finds nothing against this repo's own current source (the pre-existing raw-split finding is fixed)", async () => {
    const issues = await run(process.cwd());
    expect(issues).toEqual([]);
  });
});
