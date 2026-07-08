import { describe, expect, it } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { scanProjectInventory } from "../../../src/audits/core/projectInventory.js";
import { collectSourceOfTruth } from "../../../src/audits/core/sourceOfTruth.js";
import { resolveAuditTarget } from "../../../src/audits/core/auditTarget.js";
import { normalizeAuditConfig } from "../../../src/audits/core/auditConfig.js";
import { STALE_COMMAND_REFERENCE_DETECTOR } from "../../../src/audits/codeRot/detectors/staleCommandReferenceDetector.js";
import type { AuditDetectorContext } from "../../../src/audits/core/auditRegistry.js";

function makeTempDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "stale-cmd-test-"));
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

function buildContext(root: string, includeOverride?: string): AuditDetectorContext {
  const inventory = scanProjectInventory(root);
  const sourceOfTruth = collectSourceOfTruth(root, inventory);
  const target = resolveAuditTarget(undefined, root);
  const config = normalizeAuditConfig(includeOverride !== undefined ? { include: includeOverride } : {}, root);
  return { target, config, inventory, sourceOfTruth };
}

async function run(root: string, includeOverride?: string) {
  const ctx = buildContext(root, includeOverride);
  return STALE_COMMAND_REFERENCE_DETECTOR.run(ctx);
}

describe("STALE_COMMAND_REFERENCE_DETECTOR", () => {
  it("flags a current-docs command missing from package.json", async () => {
    const root = makeTempDir();
    try {
      writeFile(root, "package.json", JSON.stringify({ name: "fixture", version: "1.0.0", scripts: {} }));
      writeFile(root, "README.md", "Run it with `npm run does-not-exist`.\n");
      const issues = await run(root);
      expect(issues.some((i) => i.title.includes("does-not-exist"))).toBe(true);
    } finally {
      cleanup(root);
    }
  });

  it("does not flag a planned/future command missing from package.json", async () => {
    const root = makeTempDir();
    try {
      writeFile(root, "package.json", JSON.stringify({ name: "fixture", version: "1.0.0", scripts: {} }));
      writeFile(root, "README.md", "## Planned\n\nA future command: `npm run future-thing`.\n");
      const issues = await run(root);
      expect(issues.some((i) => i.title.includes("future-thing"))).toBe(false);
    } finally {
      cleanup(root);
    }
  });

  it("flags an implemented important public script missing from docs/COMMANDS.md", async () => {
    const root = makeTempDir();
    try {
      writeFile(
        root,
        "package.json",
        JSON.stringify({ name: "fixture", version: "1.0.0", scripts: { audit: "tsx scripts/audits/runAudit.ts" } })
      );
      writeFile(root, "docs/COMMANDS.md", "# Commands\n\nThis file does not mention the important script.\n");
      const issues = await run(root);
      expect(issues.some((i) => i.title.includes('"audit"') && i.category === "undocumented-command")).toBe(true);
    } finally {
      cleanup(root);
    }
  });

  it("does not flag an internal helper script missing from docs", async () => {
    const root = makeTempDir();
    try {
      writeFile(
        root,
        "package.json",
        JSON.stringify({ name: "fixture", version: "1.0.0", scripts: { "internal-helper": "node helper.js" } })
      );
      writeFile(root, "docs/COMMANDS.md", "# Commands\n\nNo mention of the helper.\n");
      const issues = await run(root);
      expect(issues.some((i) => i.title.includes("internal-helper"))).toBe(false);
    } finally {
      cleanup(root);
    }
  });

  it("stale command issue includes file path, command, excerpt, and recommendation", async () => {
    const root = makeTempDir();
    try {
      writeFile(root, "package.json", JSON.stringify({ name: "fixture", version: "1.0.0", scripts: {} }));
      writeFile(root, "README.md", "Try `npm run ghost-command` today.\n");
      const issues = await run(root);
      const issue = issues.find((i) => i.title.includes("ghost-command"));
      expect(issue).toBeDefined();
      expect(issue?.affectedFiles).toContain("README.md");
      expect(issue?.evidence[0].filePath).toBe("README.md");
      expect(issue?.evidence[0].excerpt).toContain("ghost-command");
      expect(issue?.recommendedAction.length).toBeGreaterThan(0);
    } finally {
      cleanup(root);
    }
  });

  it("de-duplicates repeated stale command references", async () => {
    const root = makeTempDir();
    try {
      writeFile(root, "package.json", JSON.stringify({ name: "fixture", version: "1.0.0", scripts: {} }));
      writeFile(
        root,
        "README.md",
        "First mention: `npm run repeated-ghost`.\n\nSecond mention: `npm run repeated-ghost`.\n"
      );
      const issues = await run(root);
      const matches = issues.filter((i) => i.title.includes("repeated-ghost"));
      expect(matches).toHaveLength(1);
    } finally {
      cleanup(root);
    }
  });

  it("--include without docs skips this detector (shouldSkip)", async () => {
    const root = makeTempDir();
    try {
      writeFile(root, "package.json", JSON.stringify({ name: "fixture", version: "1.0.0", scripts: {} }));
      writeFile(root, "README.md", "Try `npm run ghost-command` today.\n");
      const ctx = buildContext(root, "package");
      const skip = STALE_COMMAND_REFERENCE_DETECTOR.shouldSkip?.(ctx);
      expect(skip?.skip).toBe(true);
    } finally {
      cleanup(root);
    }
  });

  it("--include docs allows this detector to run", async () => {
    const root = makeTempDir();
    try {
      writeFile(root, "package.json", JSON.stringify({ name: "fixture", version: "1.0.0", scripts: {} }));
      writeFile(root, "README.md", "Try `npm run ghost-command` today.\n");
      const ctx = buildContext(root, "docs");
      const skip = STALE_COMMAND_REFERENCE_DETECTOR.shouldSkip?.(ctx);
      expect(skip?.skip).toBe(false);
    } finally {
      cleanup(root);
    }
  });
});
