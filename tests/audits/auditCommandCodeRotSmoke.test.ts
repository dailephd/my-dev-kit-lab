import fs from "node:fs";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { resolveCommand } from "../../src/core/resolveCommand.js";
// Explicit unavailable-provider scenarios reuse the existing test-only runner
// dependency seam. Other cases below retain real CLI subprocess execution.
const missingProvider = vi.hoisted(() => ({ root: undefined as string | undefined }));
vi.mock("../../src/audits/core/auditRunner.js", async () => {
  const actual = await vi.importActual<typeof import("../../src/audits/core/auditRunner.js")>("../../src/audits/core/auditRunner.js");
  return { ...actual, runAudit: (options: Parameters<typeof actual.runAudit>[0]) => actual.runAudit(
    missingProvider.root === undefined ? options : { ...options, kitSourceProviderDependencies: { installedPackageRoot: missingProvider.root } }
  ) };
});
import { runAuditCommandFromArgs } from "../../src/commands/runAuditCommand.js";
async function runAuditWithoutProvider(args: string[]) {
  const owned = fs.mkdtempSync(path.join(os.tmpdir(), "audit-missing-provider-")); cleanupDirs.push(owned);
  missingProvider.root = path.join(owned, "missing-kit");
  const error = vi.spyOn(console, "error").mockImplementation(() => {});
  const log = vi.spyOn(console, "log").mockImplementation(() => {});
  try {
    const status = await runAuditCommandFromArgs(["--out", path.join(owned, "out"), ...args]);
    return { status, stderr: error.mock.calls.map(parts => parts.join(" ")).join("\n"), stdout: log.mock.calls.map(parts => parts.join(" ")).join("\n") };
  } finally { missingProvider.root = undefined; error.mockRestore(); log.mockRestore(); }
}


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
  const fullArgs = [path.join(toolRoot, "node_modules/tsx/dist/cli.mjs"), path.join(toolRoot, "scripts/audits/runAudit.ts"), ...args];
  try {
    const stdout = execFileSync(process.execPath, fullArgs, { cwd: toolRoot, encoding: "utf8", windowsHide: true });
    return { stdout, stderr: "", status: 0 };
  } catch (err) {
    const e = err as { stdout?: string; stderr?: string; status?: number };
    return { stdout: e.stdout ?? "", stderr: e.stderr ?? "", status: e.status ?? 1 };
  }
}

describe("npm run audit — Batch 3 default smoke (real repo, --fail-on none)", () => {
  it("default source audit exits 2 without a qualified producer even with fail-on none", async () => {
    const result = await runAuditWithoutProvider(["--fail-on", "none"]);
    expect(result.status).toBe(2); expect(result.stderr).toContain("package-missing");
  }, 30_000);

  it("explicit code-rot selection retains fatal missing-producer behavior", async () => {
    const result = await runAuditWithoutProvider(["--types", "code-rot", "--fail-on", "none"]);
    expect(result.status).toBe(2); expect(result.stderr).toContain("Required source evidence");
  }, 30_000);

  it("npm run audit -- --types code-rot --include docs,tests,package,architecture,cli --format text,json --fail-on none succeeds and writes both formats", () => {
    const outDir = mkdtempSync(path.join(os.tmpdir(), "audit-coderot-smoke-"));
    cleanupDirs.push(outDir);
    const result = runAuditCli([
      "--target", boundedCliTarget(),
      "--types",
      "code-rot",
      "--include",
      "docs",
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

  it("registered detector selection runs without error on a bounded non-source CLI target", () => {
    const outDir = mkdtempSync(path.join(os.tmpdir(), "audit-batch4-smoke-"));
    cleanupDirs.push(outDir);
    const result = runAuditCli(["--target", boundedCliTarget(), "--include", "docs", "--types", "code-rot", "--format", "json", "--fail-on", "none", "--out", outDir]);
    expect(result.status).toBe(0);

    const parsed = JSON.parse(readFileSync(path.join(outDir, "code-rot-audit.json"), "utf8")) as {
      summary: { detectorErrorCount: number };
      skippedDetectors: { id: string }[];
    };
    expect(parsed.summary.detectorErrorCount).toBe(0);
  }, 30_000);

  it("explicit self target retains fatal missing-producer behavior", async () => {
    const result = await runAuditWithoutProvider(["--target", ".", "--types", "code-rot", "--fail-on", "none"]);
    expect(result.status).toBe(2); expect(result.stderr).toContain("package-missing");
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
    runAuditCli(["--target", boundedCliTarget(), "--include", "docs", "--format", "text", "--fail-on", "none", "--out", outDir]);
    const text = readFileSync(path.join(outDir, "code-rot-audit.txt"), "utf8");
    // v0.3.0 Batch 5 renders this as "Total issues: N" under the "Issue
    // summary" section header -- intentional Batch 5 report-format
    // maturation, not a regression.
    expect(text).toMatch(/Total issues: \d+/);
  }, 30_000);
});

function boundedCliTarget(): string {
 const root = mkdtempSync(path.join(os.tmpdir(), "audit-cli-bounded-")); cleanupDirs.push(root);
 fs.writeFileSync(path.join(root, "package.json"), JSON.stringify({name:"@dailephd/my-dev-kit-lab",version:"1.0.0",scripts:{}}));
 fs.writeFileSync(path.join(root,"README.md"),"# Bounded audit fixture\n");
 fs.mkdirSync(path.join(root,"src")); fs.writeFileSync(path.join(root,"src/index.ts"),"export const value = 1;\n");
 return root;
}
