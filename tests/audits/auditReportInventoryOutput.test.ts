import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { resolveCommand } from "../../src/core/resolveCommand.js";

// ---------------------------------------------------------------------------
// v0.3.0 Batch 2 — real `npm run audit` report-output smoke tests.
//
// Mirrors tests/audits/auditCommandSmoke.test.ts's real-subprocess CLI
// pattern (resolveCommand() for Windows .cmd-shim safety). Confirms the
// Batch 2 inventory/source-of-truth summary integration in the actual
// written JSON/text reports, run against this repo itself.
// ---------------------------------------------------------------------------

const toolRoot = process.cwd();
const cleanupDirs: string[] = [];

afterEach(() => {
  for (const dir of cleanupDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

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

describe("npm run audit — JSON report inventory/source-of-truth integration", () => {
  it("writes JSON with inventory and sourceOfTruth summaries", () => {
    const outDir = mkdtempSync(path.join(os.tmpdir(), "audit-report-json-"));
    cleanupDirs.push(outDir);
    const result = runAuditCli(["--format", "json", "--out", outDir]);
    expect(result.status).toBe(0);

    const parsed = JSON.parse(readFileSync(path.join(outDir, "code-rot-audit.json"), "utf8")) as {
      target: unknown;
      config: unknown;
      summary: { noDetectorsRegistered: boolean };
      issues: unknown[];
      skippedDetectors: unknown[];
      detectorErrors: unknown[];
      inventory: { totalScannedFileCount: number; filesByCategory: Record<string, number> };
      sourceOfTruth: { packageName: string | null; hasReadme: boolean };
    };

    expect(parsed.target).toBeDefined();
    expect(parsed.config).toBeDefined();
    expect(Array.isArray(parsed.issues)).toBe(true);
    expect(Array.isArray(parsed.skippedDetectors)).toBe(true);
    expect(Array.isArray(parsed.detectorErrors)).toBe(true);
    // Was true in Batch 1/2 (empty registry); Batch 3 registers real
    // code-rot detectors, which are selected by a default (no --types/
    // --include override) run -- see
    // tests/audits/auditCommandCodeRotSmoke.test.ts for the full Batch 3
    // no-detectors-note assertions.
    expect(parsed.summary.noDetectorsRegistered).toBe(false);

    expect(parsed.inventory).toBeDefined();
    expect(parsed.inventory.totalScannedFileCount).toBeGreaterThan(0);
    expect(parsed.inventory.filesByCategory.source).toBeGreaterThan(0);

    expect(parsed.sourceOfTruth).toBeDefined();
    expect(parsed.sourceOfTruth.packageName).toBe("@dailephd/my-dev-kit-lab");
    expect(parsed.sourceOfTruth.hasReadme).toBe(true);
  }, 30_000);

  it("JSON report does not include full file contents (inventory summary only, no raw file list)", () => {
    const outDir = mkdtempSync(path.join(os.tmpdir(), "audit-report-json-nocontent-"));
    cleanupDirs.push(outDir);
    runAuditCli(["--format", "json", "--out", outDir]);
    const raw = readFileSync(path.join(outDir, "code-rot-audit.json"), "utf8");
    const parsed = JSON.parse(raw) as { inventory: Record<string, unknown> };
    // The condensed report inventory summary must not carry the raw
    // per-file "files" array (which would embed the full project file
    // listing) -- only counts/summaries.
    expect("files" in parsed.inventory).toBe(false);
    expect("sourceFiles" in parsed.inventory).toBe(false);
  }, 30_000);
});

describe("npm run audit — text report inventory/source-of-truth integration", () => {
  it("writes text report with inventory and source-of-truth sections", () => {
    const outDir = mkdtempSync(path.join(os.tmpdir(), "audit-report-text-"));
    cleanupDirs.push(outDir);
    const result = runAuditCli(["--format", "text", "--out", outDir]);
    expect(result.status).toBe(0);
    const text = readFileSync(path.join(outDir, "code-rot-audit.txt"), "utf8");
    // v0.3.0 Batch 5 renders these as section headers without a trailing
    // colon ("Inventory summary" / "Source-of-truth summary", each followed
    // by its own "---" divider line) -- intentional Batch 5 report-format
    // maturation, not a regression; the underlying inventory/sourceOfTruth
    // condensed data these sections describe is unchanged.
    expect(text).toContain("Inventory summary");
    expect(text).toContain("Source-of-truth summary");
    expect(text).toContain("@dailephd/my-dev-kit-lab");
  }, 30_000);

  it("text report no longer states 'no detectors registered' now that Batch 3 detectors exist", () => {
    // Was the opposite assertion in Batch 1/2, when DEFAULT_AUDIT_REGISTRY
    // was intentionally empty. Batch 3 registers real detectors, so a
    // default run must no longer claim zero coverage.
    const outDir = mkdtempSync(path.join(os.tmpdir(), "audit-report-text-nodetectors-"));
    cleanupDirs.push(outDir);
    runAuditCli(["--format", "text", "--out", outDir]);
    const text = readFileSync(path.join(outDir, "code-rot-audit.txt"), "utf8");
    expect(text).not.toMatch(/no code-rot detectors are registered yet/i);
  }, 30_000);
});
