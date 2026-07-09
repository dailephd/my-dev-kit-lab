import { execFileSync } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { resolveCommand } from "../../../src/core/resolveCommand.js";

// ---------------------------------------------------------------------------
// v0.3.2 Batch 4 -- T1/T6/T7/T8/T9/T10: real CLI integration for
// `npm run audit -- --types security` (and combined `code-rot,security`).
//
// Real subprocess invocations of scripts/audits/runAudit.ts and
// scripts/security/validate.ts against a small external fixture project, so
// every check group actually executes (same generous-timeout precedent as
// tests/audits/security/securityAuditAdapter.test.ts and
// tests/security/securityProfileSelectionIntegration.test.ts).
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

function makeFixtureWithCodeRotAndSecurityFindings(root: string): void {
  writeFile(
    root,
    "package.json",
    JSON.stringify({ name: "audit-security-e2e-fixture", version: "1.0.0", scripts: {} }, null, 2)
  );
  // Triggers staleCommandReferenceDetector.ts (a real code-rot finding).
  writeFile(root, "README.md", "Run `npm run totally-fake-e2e-security-command` to get started.\n");
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

function runScriptCli(scriptRelativePath: string, args: string[]): { stdout: string; stderr: string; status: number } {
  const resolved = resolveCommand("npx", { cwd: toolRoot });
  const needsResolvedPathArg =
    resolved.resolutionKind === "windows-cmd-shim" || resolved.resolutionKind === "windows-powershell-shim";
  const fullArgs = [
    ...resolved.argsPrefix,
    ...(needsResolvedPathArg && resolved.resolvedPath ? [resolved.resolvedPath] : []),
    "tsx",
    scriptRelativePath,
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

function runAuditCli(args: string[]): { stdout: string; stderr: string; status: number } {
  return runScriptCli("scripts/audits/runAudit.ts", args);
}

function runSecurityValidateCli(args: string[]): { stdout: string; stderr: string; status: number } {
  return runScriptCli("scripts/security/validate.ts", args);
}

describe("audit --types security — real CLI integration (T1/T6/T10)", () => {
  it("accepts --types security, generates/references a security report, and never modifies the target", () => {
    const externalRoot = makeTempDir("audit-security-e2e-");
    makeFixtureWithCodeRotAndSecurityFindings(externalRoot);
    const beforeHashes = hashAllFiles(externalRoot);

    const outDir = makeTempDir("audit-security-e2e-out-");
    const result = runAuditCli([
      "--target",
      externalRoot,
      "--types",
      "security",
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
      securitySummary: {
        ran: boolean;
        verdict: string | null;
        totalChecks: number;
        reportPaths: { text: string | null; json: string | null };
      };
      issues: { auditType: string; category: string }[];
    };

    // 1. securitySummary is populated (T1 -- --types security was accepted
    // and actually executed, not rejected as "planned but not implemented").
    expect(parsed.securitySummary.ran).toBe(true);
    expect(parsed.securitySummary.totalChecks).toBeGreaterThan(0);
    expect(parsed.securitySummary.verdict).not.toBeNull();

    // 2. The original security report is referenced, not duplicated inline.
    expect(parsed.securitySummary.reportPaths.text).not.toBeNull();
    expect(fs.existsSync(parsed.securitySummary.reportPaths.text!)).toBe(true);
    expect(fs.existsSync(parsed.securitySummary.reportPaths.json!)).toBe(true);

    // 3. At least one mapped security issue is present.
    expect(parsed.issues.some((i) => i.auditType === "security")).toBe(true);

    // 4. Target safety (T10): reports never land under the external target,
    // and its files are byte-for-byte unmodified.
    expect(fs.existsSync(path.join(externalRoot, "reports"))).toBe(false);
    expect(hashAllFiles(externalRoot)).toEqual(beforeHashes);
  }, 90_000);
});

describe("audit --types code-rot,security — combined mode (T8/T9)", () => {
  it("carries both code-rot and security issues, deterministically ordered, with fail-on applied to the combined list", () => {
    const externalRoot = makeTempDir("audit-combined-e2e-");
    makeFixtureWithCodeRotAndSecurityFindings(externalRoot);

    const outDir = makeTempDir("audit-combined-e2e-out-");
    const result = runAuditCli([
      "--target",
      externalRoot,
      "--types",
      "code-rot,security",
      "--fail-on",
      "none",
      "--format",
      "json",
      "--out",
      outDir,
    ]);
    expect(result.status).toBe(0);

    const jsonPath = path.join(outDir, "code-rot-audit.json");
    const parsed = JSON.parse(fs.readFileSync(jsonPath, "utf8")) as {
      config: { types: string[] };
      issues: { auditType: string; detectorId: string }[];
    };

    expect(parsed.config.types).toEqual(["code-rot", "security"]);

    // T8: code-rot detectors still fire (the seeded stale command reference).
    const codeRotIssue = parsed.issues.find((i) => i.detectorId === "stale-command-reference");
    expect(codeRotIssue).toBeDefined();

    // T9: a security issue is also present in the same combined run.
    const securityIssue = parsed.issues.find((i) => i.auditType === "security");
    expect(securityIssue).toBeDefined();

    // Deterministic ordering: all code-rot issues precede all security
    // issues (registry-order code-rot loop runs before the security
    // adapter -- see auditRunner.ts).
    const firstSecurityIndex = parsed.issues.findIndex((i) => i.auditType === "security");
    const lastCodeRotIndex = parsed.issues.map((i) => i.auditType).lastIndexOf("code-rot");
    expect(lastCodeRotIndex).toBeLessThan(firstSecurityIndex);

    // Re-running with --fail-on high must apply to the combined list and
    // breach given the seeded high-severity mapped security issue (a
    // missing test:security script maps major -> high, releaseBlocking).
    const breachResult = runAuditCli([
      "--target",
      externalRoot,
      "--types",
      "code-rot,security",
      "--fail-on",
      "high",
      "--format",
      "json",
      "--out",
      outDir,
    ]);
    expect(breachResult.status).toBe(1);
  }, 120_000);
});

describe("security:validate backward compatibility (T7)", () => {
  it("still runs standalone against the same external target after the audit adapter is wired in", () => {
    const externalRoot = makeTempDir("security-validate-e2e-");
    makeFixtureWithCodeRotAndSecurityFindings(externalRoot);

    const outDir = makeTempDir("security-validate-e2e-out-");
    const result = runSecurityValidateCli(["--target", externalRoot, "--out", outDir, "--format", "json"]);

    // Exit 0/1/2 are all legitimate outcomes of security:validate depending
    // on verdict (blocker/inconclusive/ready) -- this test only proves the
    // standalone command still runs end-to-end and writes its own report,
    // not that this particular fixture yields a clean verdict.
    expect([0, 1, 2]).toContain(result.status);
    const jsonReportPath = fs
      .readdirSync(outDir)
      .find((f) => f.endsWith("-security-validation.json"));
    expect(jsonReportPath).toBeDefined();
    expect(fs.existsSync(path.join(outDir, jsonReportPath!))).toBe(true);
  }, 90_000);
});
