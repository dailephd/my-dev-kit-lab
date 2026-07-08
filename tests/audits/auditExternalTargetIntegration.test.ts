import { execFileSync } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { resolveCommand } from "../../src/core/resolveCommand.js";

// ---------------------------------------------------------------------------
// v0.3.0 Batch 6 — external target regression guard (spec 3.9).
//
// Runs the real CLI against a temp "external" fixture project (distinct from
// this tool's own repo) and confirms: it runs successfully, reports land
// under the tool's own output root (or an explicit --out), the external
// target's files are byte-for-byte unmodified, inventory/sourceOfTruth
// populate correctly, a deliberately-seeded real finding shows up, and a
// variant with a space in the external target's directory name also works.
// ---------------------------------------------------------------------------

const toolRoot = process.cwd();
const cleanupDirs: string[] = [];

afterEach(() => {
  for (const dir of cleanupDirs.splice(0)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

function makeTempDir(prefix: string): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  cleanupDirs.push(dir);
  return dir;
}

function writeFile(root: string, relativePath: string, content: string): void {
  const fullPath = path.join(root, relativePath);
  fs.mkdirSync(path.dirname(fullPath), { recursive: true });
  fs.writeFileSync(fullPath, content, "utf8");
}

function makeExternalFixture(root: string): void {
  writeFile(root, "package.json", JSON.stringify({ name: "external-fixture", version: "1.0.0", scripts: { build: "tsc" } }, null, 2));
  // A real, deliberately-triggerable finding: a stale doc command reference
  // (staleCommandReferenceDetector.ts's core signal).
  writeFile(root, "README.md", "Run `npm run totally-fake-external-command` to get started.\n");
  writeFile(root, "src/index.ts", "export const value = 1;\n");
}

function sha256OfFile(filePath: string): string {
  return crypto.createHash("sha256").update(fs.readFileSync(filePath)).digest("hex");
}

function hashAllFiles(root: string): Map<string, string> {
  const hashes = new Map<string, string>();
  const walk = (dir: string): void => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        walk(full);
      } else if (entry.isFile()) {
        hashes.set(path.relative(root, full), sha256OfFile(full));
      }
    }
  };
  walk(root);
  return hashes;
}

function runAuditCli(args: string[]): { stdout: string; stderr: string; status: number } {
  const resolved = resolveCommand("npx", { cwd: toolRoot });
  const needsResolvedPathArg =
    resolved.resolutionKind === "windows-cmd-shim" || resolved.resolutionKind === "windows-powershell-shim";
  const fullArgs = [
    ...resolved.argsPrefix,
    ...(needsResolvedPathArg && resolved.resolvedPath ? [resolved.resolvedPath] : []),
    "tsx",
    "scripts/audits/runAudit.ts",
    ...args,
  ];
  try {
    const stdout = execFileSync(resolved.command, fullArgs, { cwd: toolRoot, encoding: "utf8" });
    return { stdout, stderr: "", status: 0 };
  } catch (err) {
    const e = err as { stdout?: string; stderr?: string; status?: number };
    return { stdout: e.stdout ?? "", stderr: e.stderr ?? "", status: e.status ?? 1 };
  }
}

describe("audit --target <external-dir> — end-to-end regression guard", () => {
  it("runs successfully, writes reports only under --out, leaves the external target byte-for-byte unmodified", () => {
    const externalRoot = makeTempDir("audit-external-target-");
    makeExternalFixture(externalRoot);
    const beforeHashes = hashAllFiles(externalRoot);

    const outDir = makeTempDir("audit-external-out-");
    const result = runAuditCli([
      "--target",
      externalRoot,
      "--types",
      "code-rot",
      "--fail-on",
      "none",
      "--format",
      "json",
      "--out",
      outDir,
    ]);
    expect(result.status).toBe(0);

    const jsonPath = path.join(outDir, "code-rot-audit.json");
    expect(fs.existsSync(jsonPath)).toBe(true);
    const parsed = JSON.parse(fs.readFileSync(jsonPath, "utf8")) as {
      target: { targetKind: string; rootPath: string };
      inventory: { totalFileCount: number };
      sourceOfTruth: { packageName: string | null };
      issues: { detectorId: string; title: string }[];
    };

    // Target metadata.
    expect(parsed.target.targetKind).toBe("external");
    expect(path.resolve(parsed.target.rootPath)).toBe(path.resolve(externalRoot));

    // Inventory/sourceOfTruth populated correctly.
    expect(parsed.inventory.totalFileCount).toBeGreaterThan(0);
    expect(parsed.sourceOfTruth.packageName).toBe("external-fixture");

    // The deliberately-seeded stale command reference triggers a real
    // finding.
    expect(parsed.issues.some((i) => i.detectorId === "stale-command-reference")).toBe(true);

    // Reports never land under the external target.
    const externalFileList = fs.readdirSync(externalRoot).sort();
    expect(externalFileList).toEqual(["README.md", "package.json", "src"].sort());
    expect(fs.existsSync(path.join(externalRoot, "reports"))).toBe(false);
    expect(fs.existsSync(path.join(externalRoot, "code-rot-audit.json"))).toBe(false);

    // Byte-for-byte unmodified.
    const afterHashes = hashAllFiles(externalRoot);
    expect(afterHashes).toEqual(beforeHashes);
  }, 30_000);

  it("also works when the external target's directory name contains a space", () => {
    const parent = makeTempDir("audit-external-space-parent-");
    const externalRoot = path.join(parent, "external target with spaces");
    fs.mkdirSync(externalRoot, { recursive: true });
    makeExternalFixture(externalRoot);

    const outDir = makeTempDir("audit-external-space-out-");
    const result = runAuditCli([
      "--target",
      externalRoot,
      "--types",
      "code-rot",
      "--fail-on",
      "none",
      "--format",
      "json",
      "--out",
      outDir,
    ]);
    expect(result.status).toBe(0);
    const jsonPath = path.join(outDir, "code-rot-audit.json");
    expect(fs.existsSync(jsonPath)).toBe(true);
    const parsed = JSON.parse(fs.readFileSync(jsonPath, "utf8")) as { sourceOfTruth: { packageName: string | null } };
    expect(parsed.sourceOfTruth.packageName).toBe("external-fixture");
  }, 30_000);

  it("default --out (omitted) still resolves under the tool's own reports/ tree, never the external target", () => {
    const externalRoot = makeTempDir("audit-external-default-out-");
    makeExternalFixture(externalRoot);

    const result = runAuditCli(["--target", externalRoot, "--types", "code-rot", "--fail-on", "none"]);
    expect(result.status).toBe(0);
    expect(fs.existsSync(path.join(externalRoot, "reports"))).toBe(false);
    // Default --out target is reports/audits/code-rot under the tool root --
    // clean up whatever it wrote there so this test doesn't leave repo
    // state behind (this directory is git-ignored generated output, not a
    // tracked file, but leaving it around is still untidy for local runs).
    const defaultOut = path.join(path.resolve(toolRoot), "reports", "audits", "code-rot");
    try {
      expect(fs.existsSync(defaultOut)).toBe(true);
    } finally {
      fs.rmSync(defaultOut, { recursive: true, force: true });
    }
  }, 30_000);
});
