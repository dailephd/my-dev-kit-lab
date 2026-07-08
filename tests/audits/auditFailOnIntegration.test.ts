import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { resolveCommand } from "../../src/core/resolveCommand.js";

// ---------------------------------------------------------------------------
// v0.3.0 Batch 5 — real-subprocess --fail-on integration tests.
//
// Mirrors tests/audits/auditCommandSmoke.test.ts's real-subprocess CLI
// pattern and tests/audits/codeRot/packageReleaseRotDetector.test.ts's
// temp-fixture pattern. Uses PACKAGE_RELEASE_ROT_DETECTOR's real,
// already-tested severity tiers (blocker: version mismatch, high: name
// mismatch, medium: stale doc version) to construct fixtures at controlled
// severities, rather than inventing fake detectors.
//
// A real, easily-constructed "low" severity trigger does not exist among
// the current 10 code-rot detectors without building a test-file fixture
// with a version-mentioning test title (testRotDetector.ts's
// findStaleVersionMentions, the only "low" emitter) -- per spec 3.6's
// documented substitution allowance, the low-tier fail-on threshold
// boundary (low-severity issue vs. --fail-on medium/low) is instead covered
// as a report-model-level unit test in auditReportModel.test.ts / directly
// against auditExitCode.ts's already-existing, severity-generic
// issueBreachesFailOnThreshold() unit tests (tests/audits/auditExitCode.test.ts) --
// the exit-code logic does not care which detector produced the severity,
// only the severity itself, so this substitution has no coverage gap for
// the logic under test here (fail-on threshold application), only for "is
// there a real low-severity detector trigger fixture," which is a
// detector-content concern, not a report-infrastructure concern.
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

function noIssuesFixture(): string {
  const root = makeTempDir("audit-failon-none-");
  writeFile(root, "package.json", JSON.stringify({ name: "fixture-clean", version: "1.0.0", scripts: {} }, null, 2));
  return root;
}

function blockerFixture(): string {
  const root = makeTempDir("audit-failon-blocker-");
  writeFile(root, "package.json", JSON.stringify({ name: "fixture", version: "2.0.0", scripts: {} }, null, 2));
  writeFile(root, "package-lock.json", JSON.stringify({ name: "fixture", version: "1.0.0", lockfileVersion: 3 }, null, 2));
  return root;
}

function highFixture(): string {
  const root = makeTempDir("audit-failon-high-");
  writeFile(root, "package.json", JSON.stringify({ name: "fixture-a", version: "1.0.0", scripts: {} }, null, 2));
  writeFile(root, "package-lock.json", JSON.stringify({ name: "fixture-b", version: "1.0.0", lockfileVersion: 3 }, null, 2));
  return root;
}

function mediumFixture(): string {
  const root = makeTempDir("audit-failon-medium-");
  writeFile(root, "package.json", JSON.stringify({ name: "fixture-medium", version: "2.0.0", scripts: {} }, null, 2));
  writeFile(root, "README.md", "# Fixture\n\nThe current package is v1.0.0 for now.\n");
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

describe("audit --fail-on integration — real fixtures, real subprocess", () => {
  it("no issues: exits 0 regardless of --fail-on", () => {
    const target = noIssuesFixture();
    const result = runAuditCli(["--target", target, "--types", "code-rot", "--fail-on", "blocker"]);
    expect(result.status).toBe(0);
  }, 30_000);

  it("blocker fixture + --fail-on blocker exits 1", () => {
    const target = blockerFixture();
    const result = runAuditCli(["--target", target, "--types", "code-rot", "--fail-on", "blocker"]);
    expect(result.status).toBe(1);
  }, 30_000);

  it("high fixture + --fail-on blocker exits 0 (high does not breach blocker threshold)", () => {
    const target = highFixture();
    const result = runAuditCli(["--target", target, "--types", "code-rot", "--fail-on", "blocker"]);
    expect(result.status).toBe(0);
  }, 30_000);

  it("high fixture + --fail-on high exits 1", () => {
    const target = highFixture();
    const result = runAuditCli(["--target", target, "--types", "code-rot", "--fail-on", "high"]);
    expect(result.status).toBe(1);
  }, 30_000);

  it("medium fixture + --fail-on high exits 0 (medium does not breach high threshold)", () => {
    const target = mediumFixture();
    const result = runAuditCli(["--target", target, "--types", "code-rot", "--fail-on", "high"]);
    expect(result.status).toBe(0);
  }, 30_000);

  it("medium fixture + --fail-on medium exits 1", () => {
    const target = mediumFixture();
    const result = runAuditCli(["--target", target, "--types", "code-rot", "--fail-on", "medium"]);
    expect(result.status).toBe(1);
  }, 30_000);

  it("--fail-on none exits 0 even with real issues present", () => {
    const target = blockerFixture();
    const result = runAuditCli(["--target", target, "--types", "code-rot", "--fail-on", "none"]);
    expect(result.status).toBe(0);
  }, 30_000);

  it("invalid config exits 2", () => {
    const result = runAuditCli(["--fail-on", "not-a-real-threshold"]);
    expect(result.status).toBe(2);
  }, 15_000);

  it("JSON file's exit.code matches actual subprocess exit status (blocker scenario)", () => {
    const target = blockerFixture();
    const outDir = makeTempDir("audit-failon-jsoncheck-blocker-");
    const result = runAuditCli(["--target", target, "--types", "code-rot", "--fail-on", "blocker", "--format", "json", "--out", outDir]);
    const parsed = JSON.parse(fs.readFileSync(path.join(outDir, "code-rot-audit.json"), "utf8")) as { exit: { code: number; breached: boolean } };
    expect(parsed.exit.code).toBe(result.status);
    expect(parsed.exit.breached).toBe(true);
    expect(result.status).toBe(1);
  }, 30_000);

  it("JSON file's exit.code matches actual subprocess exit status (below-threshold scenario)", () => {
    const target = highFixture();
    const outDir = makeTempDir("audit-failon-jsoncheck-high-");
    const result = runAuditCli(["--target", target, "--types", "code-rot", "--fail-on", "blocker", "--format", "json", "--out", outDir]);
    const parsed = JSON.parse(fs.readFileSync(path.join(outDir, "code-rot-audit.json"), "utf8")) as { exit: { code: number; breached: boolean } };
    expect(parsed.exit.code).toBe(result.status);
    expect(parsed.exit.breached).toBe(false);
    expect(result.status).toBe(0);
  }, 30_000);

  it("text report's exit section matches the actual exit status", () => {
    const target = blockerFixture();
    const outDir = makeTempDir("audit-failon-textcheck-");
    const result = runAuditCli(["--target", target, "--types", "code-rot", "--fail-on", "blocker", "--format", "text", "--out", outDir]);
    const text = fs.readFileSync(path.join(outDir, "code-rot-audit.txt"), "utf8");
    expect(text).toContain(`code=${result.status}`);
    expect(text).toContain("breached=true");
  }, 30_000);
});
