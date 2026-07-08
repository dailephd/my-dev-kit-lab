import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { resolveCommand } from "../../src/core/resolveCommand.js";

// ---------------------------------------------------------------------------
// v0.3.0 Batch 6 — real CLI, real fixture, low-severity-only --fail-on
// boundary coverage.
//
// tests/audits/auditFailOnIntegration.test.ts (Batch 5) covers
// blocker/high/medium via packageReleaseRotDetector's tiers, but documented
// that no easy real "low"-only CLI fixture existed at the time and
// substituted a unit-level test instead. Batch 6 spec 3.4 asks for a real
// one. Grepping all 10 detector files for `severity: "low"` found 5
// candidates (deadCodeCandidateDetector x2, dependencyEnvironmentRotDetector,
// duplicateImplementationDetector, testRotDetector). The cheapest one to
// isolate cleanly is dependencyEnvironmentRotDetector.ts's
// findUndocumentedOptionalTools(): a package.json script that mentions an
// "optional tool" name (codeql/semgrep/osv-scanner) with zero doc files
// present triggers exactly one low-severity issue and nothing else --
// confirmed by reading every other detector's supportedIncludeAreas/
// shouldSkip/trigger logic (see fixture comment below) before writing this
// test, not by trial and error against the real CLI alone.
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

// Deliberately minimal: only package.json, no README/docs, no
// package-lock.json, no CI workflow, no src/scripts/test files. With
// --include package,docs:
//  - dependency-environment-rot: package included -> runs;
//    findUndocumentedOptionalTools sees "codeql" in a script command with no
//    doc content anywhere -> exactly one low-severity issue.
//    findPackageManagerMismatch/findNodePolicyClaimMismatch produce nothing
//    (no lockfile, no CI workflow, no docs).
//    findNodeEngineCiMismatch produces nothing (no engines.node field).
//  - package-release-rot: no lockfile, no "files" entries, no self-referencing
//    self-referencing script commands (an "npm run" invocation of another
//    script name) -> nothing.
//  - cross-platform-rot: script command has no POSIX-only binary pattern,
//    cli not included so scanSourceFiles doesn't run -> nothing.
//  - dead-code-candidate: no scripts/ files, no old/deprecated dirs, no
//    generated-looking files, no fixtures -> nothing.
//  - duplicate-implementation-candidate: single script, no "scripts/*.ts"
//    target reference, no detector-registry-shaped source files -> nothing.
//  - stale-command-reference / docs-code-mismatch / architecture-drift /
//    security-validation-assumption-rot: all require docsFiles to find
//    anything, and this fixture has zero doc files -> nothing.
function lowSeverityOnlyFixture(): string {
  const root = makeTempDir("audit-lowseverity-");
  writeFile(
    root,
    "package.json",
    JSON.stringify(
      { name: "fixture-low-severity", version: "1.0.0", scripts: { "check-codeql": "codeql --version" } },
      null,
      2
    )
  );
  return root;
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

const BASE_ARGS = ["--types", "code-rot", "--include", "package,docs"];

describe("audit --fail-on integration — real low-severity-only fixture", () => {
  it("fixture produces exactly one low-severity issue and nothing at higher severity", () => {
    const target = lowSeverityOnlyFixture();
    const outDir = makeTempDir("audit-lowseverity-shape-");
    const result = runAuditCli([...BASE_ARGS, "--target", target, "--fail-on", "none", "--format", "json", "--out", outDir]);
    expect(result.status).toBe(0);
    const parsed = JSON.parse(fs.readFileSync(path.join(outDir, "code-rot-audit.json"), "utf8")) as {
      issues: { severity: string; detectorId: string }[];
      summary: { issuesBySeverity: Record<string, number> };
    };
    expect(parsed.issues).toHaveLength(1);
    expect(parsed.issues[0].severity).toBe("low");
    expect(parsed.issues[0].detectorId).toBe("dependency-environment-rot");
    expect(parsed.summary.issuesBySeverity).toEqual({ blocker: 0, high: 0, medium: 0, low: 1, info: 0 });
  }, 30_000);

  it("--fail-on low exits 1", () => {
    const target = lowSeverityOnlyFixture();
    const result = runAuditCli([...BASE_ARGS, "--target", target, "--fail-on", "low"]);
    expect(result.status).toBe(1);
  }, 30_000);

  it("--fail-on medium exits 0 (low does not breach medium threshold)", () => {
    const target = lowSeverityOnlyFixture();
    const result = runAuditCli([...BASE_ARGS, "--target", target, "--fail-on", "medium"]);
    expect(result.status).toBe(0);
  }, 30_000);

  it("--fail-on high exits 0", () => {
    const target = lowSeverityOnlyFixture();
    const result = runAuditCli([...BASE_ARGS, "--target", target, "--fail-on", "high"]);
    expect(result.status).toBe(0);
  }, 30_000);

  it("--fail-on blocker exits 0", () => {
    const target = lowSeverityOnlyFixture();
    const result = runAuditCli([...BASE_ARGS, "--target", target, "--fail-on", "blocker"]);
    expect(result.status).toBe(0);
  }, 30_000);

  it("--fail-on none exits 0", () => {
    const target = lowSeverityOnlyFixture();
    const result = runAuditCli([...BASE_ARGS, "--target", target, "--fail-on", "none"]);
    expect(result.status).toBe(0);
  }, 30_000);

  it("JSON exit.code matches the actual process exit status at the low/medium boundary", () => {
    const target = lowSeverityOnlyFixture();
    const outDir = makeTempDir("audit-lowseverity-jsoncheck-");
    const lowResult = runAuditCli([...BASE_ARGS, "--target", target, "--fail-on", "low", "--format", "json", "--out", outDir]);
    const parsed = JSON.parse(fs.readFileSync(path.join(outDir, "code-rot-audit.json"), "utf8")) as {
      exit: { code: number; breached: boolean };
    };
    expect(parsed.exit.code).toBe(lowResult.status);
    expect(parsed.exit.breached).toBe(true);
    expect(lowResult.status).toBe(1);
  }, 30_000);

  it("text report's exit section matches the actual exit status at the low/medium boundary", () => {
    const target = lowSeverityOnlyFixture();
    const outDir = makeTempDir("audit-lowseverity-textcheck-");
    const result = runAuditCli([...BASE_ARGS, "--target", target, "--fail-on", "low", "--format", "text", "--out", outDir]);
    const text = fs.readFileSync(path.join(outDir, "code-rot-audit.txt"), "utf8");
    expect(text).toContain(`code=${result.status}`);
    expect(text).toContain("breached=true");
  }, 30_000);
});
