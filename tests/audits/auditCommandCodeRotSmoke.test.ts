import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { resolveCommand } from "../../src/core/resolveCommand.js";

// ---------------------------------------------------------------------------
// v0.3.0 Batch 3 — real `npm run audit` code-rot smoke tests.
//
// Mirrors the resolveCommand()-based real-subprocess pattern from
// tests/audits/auditCommandSmoke.test.ts and
// tests/audits/auditReportInventoryOutput.test.ts. Confirms the Batch 3
// registry-integration behavior (no-detectors note gone, real issues
// reachable) against this repo itself.
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

describe("npm run audit — Batch 3 default smoke (real repo, --fail-on none)", () => {
  it("npm run audit -- --fail-on none exits 0", () => {
    const result = runAuditCli(["--fail-on", "none"]);
    expect(result.status).toBe(0);
  }, 30_000);

  it("npm run audit -- --types code-rot --fail-on none exits 0", () => {
    const result = runAuditCli(["--types", "code-rot", "--fail-on", "none"]);
    expect(result.status).toBe(0);
  }, 30_000);

  it("npm run audit -- --types code-rot --include docs,tests,package,architecture,cli --format text,json --fail-on none succeeds and writes both formats", () => {
    const outDir = mkdtempSync(path.join(os.tmpdir(), "audit-coderot-smoke-"));
    cleanupDirs.push(outDir);
    const result = runAuditCli([
      "--types",
      "code-rot",
      "--include",
      "docs,tests,package,architecture,cli",
      "--format",
      "text,json",
      "--fail-on",
      "none",
      "--out",
      outDir,
    ]);
    expect(result.status).toBe(0);

    const parsed = JSON.parse(readFileSync(path.join(outDir, "code-rot-audit.json"), "utf8")) as {
      issues: { detectorId: string }[];
      summary: { noDetectorsRegistered: boolean; detectorErrorCount: number };
    };
    expect(Array.isArray(parsed.issues)).toBe(true);
    // Batch 3 registers real detectors -- the no-detectors note must be gone
    // for a default/full-include run.
    expect(parsed.summary.noDetectorsRegistered).toBe(false);
    // Batch 4: none of the 10 registered detectors should ever throw when
    // run against this repo itself.
    expect(parsed.summary.detectorErrorCount).toBe(0);

    const text = readFileSync(path.join(outDir, "code-rot-audit.txt"), "utf8");
    expect(text).not.toMatch(/no code-rot detectors are registered yet/i);
  }, 30_000);

  it("all 10 Batch 3+4 detectors run without error against this repo (real CLI)", () => {
    const outDir = mkdtempSync(path.join(os.tmpdir(), "audit-batch4-smoke-"));
    cleanupDirs.push(outDir);
    const result = runAuditCli(["--types", "code-rot", "--format", "json", "--fail-on", "none", "--out", outDir]);
    expect(result.status).toBe(0);

    const parsed = JSON.parse(readFileSync(path.join(outDir, "code-rot-audit.json"), "utf8")) as {
      summary: { detectorErrorCount: number };
      skippedDetectors: { id: string }[];
    };
    expect(parsed.summary.detectorErrorCount).toBe(0);
  }, 30_000);

  it("npm run audit -- --target . --types code-rot --fail-on none exits 0", () => {
    const result = runAuditCli(["--target", ".", "--types", "code-rot", "--fail-on", "none"]);
    expect(result.status).toBe(0);
  }, 30_000);

  it("npm run audit -- --types quality still fails cleanly as planned but not implemented", () => {
    const result = runAuditCli(["--types", "quality"]);
    expect(result.status).toBe(2);
    expect(result.stdout + result.stderr).toMatch(/planned but not implemented/i);
  }, 15_000);
});

describe("npm run audit — text report includes an issue summary", () => {
  it("text report always shows an issue count line, even when 0", () => {
    const outDir = mkdtempSync(path.join(os.tmpdir(), "audit-coderot-textsummary-"));
    cleanupDirs.push(outDir);
    runAuditCli(["--format", "text", "--fail-on", "none", "--out", outDir]);
    const text = readFileSync(path.join(outDir, "code-rot-audit.txt"), "utf8");
    // v0.3.0 Batch 5 renders this as "Total issues: N" under the "Issue
    // summary" section header -- intentional Batch 5 report-format
    // maturation, not a regression.
    expect(text).toMatch(/Total issues: \d+/);
  }, 30_000);
});
