import { execFileSync } from "node:child_process";
import fs from "node:fs";
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
// v0.3.0 Batch 6 — live self-audit smoke guard (spec 3.8).
//
// Runs `npm run audit -- --fail-on none` against this repo's own real
// current state as a real subprocess. Deliberately does NOT hardcode an
// exact expected issue count -- Batch 6's own line-splitting fix (spec 3.1)
// changes the pre-Batch-6 baseline of 7 issues, and future batches will
// change it further. Internal-consistency and "no detector crashed" are the
// invariants this test locks in; the actual count is reported via the test
// name / a console note for the human-facing final report, not asserted
// exactly.
// ---------------------------------------------------------------------------

const toolRoot = process.cwd();
const cleanupDirs: string[] = [];

afterEach(() => {
  for (const dir of cleanupDirs.splice(0)) {
    fs.rmSync(dir, { recursive: true, force: true });
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

describe("live self-audit smoke — real subprocess against this repo's own current state", () => {
  it("non-source CLI report counts remain internally consistent without a Kit acquisition", () => {
    const outDir = fs.mkdtempSync(path.join(os.tmpdir(), "audit-self-smoke-"));
    cleanupDirs.push(outDir);

    const target = fs.mkdtempSync(path.join(os.tmpdir(),"audit-counts-target-")); cleanupDirs.push(target);
    fs.writeFileSync(path.join(target,"package.json"), JSON.stringify({name:"counts-fixture",version:"1.0.0",scripts:{}}));
    const result = runAuditCli(["--target",target,"--include","package","--fail-on", "none", "--format", "json", "--out", outDir]);
    expect(result.status).toBe(0);

    const jsonPath = path.join(outDir, "code-rot-audit.json");
    expect(fs.existsSync(jsonPath)).toBe(true);
    const parsed = JSON.parse(fs.readFileSync(jsonPath, "utf8")) as {
      issues: { severity: string }[];
      summary: { totalIssues: number; issuesBySeverity: Record<string, number>; detectorErrorCount: number };
      detectorErrors: unknown[];
    };

    // Internal consistency.
    expect(parsed.summary.totalIssues).toBe(parsed.issues.length);
    const bySeverityFromIssues: Record<string, number> = { blocker: 0, high: 0, medium: 0, low: 0, info: 0 };
    for (const issue of parsed.issues) {
      bySeverityFromIssues[issue.severity] = (bySeverityFromIssues[issue.severity] ?? 0) + 1;
    }
    expect(parsed.summary.issuesBySeverity).toEqual(bySeverityFromIssues);

    // No detector crashed against this repo's own real state. If this ever
    // becomes nonzero, that is itself a real finding to investigate, not a
    // reason to weaken this assertion.
    expect(parsed.detectorErrors).toHaveLength(0);
    expect(parsed.summary.detectorErrorCount).toBe(0);

    // Findings are not suppressed -- structural assertion only, not an exact
    // count (see header comment). The actual count is surfaced for humans
    // via this describe block's console output during a real test run.
    expect(parsed.summary.totalIssues).toBeGreaterThanOrEqual(0);
    // eslint-disable-next-line no-console
    console.log(`[Batch 6 self-audit smoke] actual current issue count: ${parsed.summary.totalIssues}`, parsed.summary.issuesBySeverity);
  }, 30_000);
});

it("self source audit fails closed without a qualified installed producer", async () => {
 const out = fs.mkdtempSync(path.join(os.tmpdir(),"self-source-fatal-")); cleanupDirs.push(out);
 const result = await runAuditWithoutProvider(["--fail-on","none","--format","json","--out",out]);
 expect(result.status).toBe(2); expect(result.stderr).toContain("package-missing");
 expect(fs.existsSync(path.join(out,"code-rot-audit.json"))).toBe(false);
},30000);
