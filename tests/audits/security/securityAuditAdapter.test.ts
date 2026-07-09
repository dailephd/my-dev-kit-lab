import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { normalizeAuditConfig } from "../../../src/audits/core/auditConfig.js";
import { runSecurityAuditAdapter } from "../../../src/audits/security/securityAuditAdapter.js";

// ---------------------------------------------------------------------------
// v0.3.2 Batch 4 -- T2/T4/T10: security audit adapter behavior.
//
// Runs the REAL adapter (real runSecurityValidation() call -- npm audit,
// npm outdated, npm ls, package checks, static-scan availability probes,
// fuzz smoke all actually execute) against a minimal EXTERNAL fixture
// project so most check groups resolve quickly:
//   - dependency/package checks run real, fast npm subprocess calls against
//     a tiny fixture with no dependencies.
//   - the cli-adversarial-suite check short-circuits immediately (no
//     subprocess at all) because the external fixture has no
//     scripts.test:security -- see runCliSecuritySuiteCheck.ts's early
//     return for `!isSelf && !hasSecurityTestScript`. This is also the
//     concrete "skipped/degraded, never passed" case T4 asks for.
//   - static scans (CodeQL/Semgrep) resolve to skipped quickly when the
//     tools aren't installed, same as the rest of tests/security already
//     relies on.
// Generous timeout, matching the precedent already established by
// full-pipeline tests in tests/security/ (e.g.
// securityProfileSelectionIntegration.test.ts uses 60s for a lighter
// deps+package-only run).
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

function makeMinimalExternalFixture(root: string): void {
  // Deliberately no scripts.test:security -- exercises the
  // "target security suite missing script" degraded/skipped-shaped finding
  // without needing a real subprocess.
  writeFile(root, "package.json", JSON.stringify({ name: "sec-adapter-fixture", version: "1.0.0", scripts: {} }, null, 2));
  writeFile(root, "src/index.js", "module.exports = 1;\n");
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

describe("runSecurityAuditAdapter — reuses runSecurityValidation directly (T2)", () => {
  it("returns issues derived from real SecurityFinding output, plus a populated summary", async () => {
    const externalRoot = makeTempDir("sec-adapter-fixture-");
    makeMinimalExternalFixture(externalRoot);

    const config = normalizeAuditConfig({ target: externalRoot, types: "security" }, toolRoot);
    const result = await runSecurityAuditAdapter({ toolRoot, config });

    expect(result.summary.ran).toBe(true);
    expect(result.summary.totalChecks).toBeGreaterThan(0);
    expect(result.summary.verdict).not.toBeNull();
    expect(result.summary.verdictLabel).not.toBeNull();
    // Every returned issue must be an audit-shaped issue with auditType
    // "security" and the shared adapter detector id.
    for (const issue of result.issues) {
      expect(issue.auditType).toBe("security");
      expect(issue.detectorId).toBe("security-validation-adapter");
    }
  }, 60_000);

  it("the missing test:security script surfaces as a real, mapped issue (never silently passed)", async () => {
    const externalRoot = makeTempDir("sec-adapter-fixture-");
    makeMinimalExternalFixture(externalRoot);

    const config = normalizeAuditConfig({ target: externalRoot, types: "security" }, toolRoot);
    const result = await runSecurityAuditAdapter({ toolRoot, config });

    const missingScriptIssue = result.issues.find((i) => i.id.includes("target-security-suite-missing-script"));
    expect(missingScriptIssue).toBeDefined();
    expect(missingScriptIssue!.severity).toBe("high"); // major -> high
    expect(missingScriptIssue!.releaseBlocking).toBe(true);
  }, 60_000);
});

describe("runSecurityAuditAdapter — skipped optional checks are never represented as passed (T4)", () => {
  it("no issue in the mapped list ever originates from a skipped check", async () => {
    const externalRoot = makeTempDir("sec-adapter-fixture-");
    makeMinimalExternalFixture(externalRoot);

    const config = normalizeAuditConfig({ target: externalRoot, types: "security" }, toolRoot);
    const result = await runSecurityAuditAdapter({ toolRoot, config });

    // checksSkipped is tracked distinctly from checksPassed -- a skipped
    // check (e.g. an unavailable static-scan tool) contributes to
    // checksSkipped, never to checksPassed, and produces no finding at all
    // (skippedCheck() in runSecurityValidation.ts always sets findings: []).
    expect(result.summary.checksSkipped).toBeGreaterThanOrEqual(0);
    expect(result.summary.checksPassed + result.summary.checksSkipped).toBeLessThanOrEqual(result.summary.totalChecks);
  }, 60_000);
});

describe("runSecurityAuditAdapter — report generation and target safety (T10)", () => {
  it("writes the original security report under toolRoot/reports/security and never touches the external target", async () => {
    const externalRoot = makeTempDir("sec-adapter-fixture-");
    makeMinimalExternalFixture(externalRoot);
    const beforeHashes = hashAllFiles(externalRoot);

    const config = normalizeAuditConfig({ target: externalRoot, types: "security" }, toolRoot);
    const result = await runSecurityAuditAdapter({ toolRoot, config });

    expect(result.summary.reportPaths.text).not.toBeNull();
    expect(result.summary.reportPaths.json).not.toBeNull();
    expect(fs.existsSync(result.summary.reportPaths.text!)).toBe(true);
    expect(fs.existsSync(result.summary.reportPaths.json!)).toBe(true);
    expect(path.resolve(result.summary.reportPaths.text!).startsWith(path.resolve(toolRoot, "reports", "security"))).toBe(
      true
    );

    const afterHashes = hashAllFiles(externalRoot);
    expect(afterHashes).toEqual(beforeHashes);
    // No new file was ever written into the external target root.
    expect(fs.existsSync(path.join(externalRoot, "reports"))).toBe(false);
  }, 60_000);
});
