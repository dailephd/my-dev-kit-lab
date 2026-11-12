import fs from "node:fs";
import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { resolveCommand } from "../../src/core/resolveCommand.js";
// Same controlled dependency seam as auditRunnerKitBridge.test.ts. Only explicit
// in-process negative scenarios override managed package resolution; real CLI
// subprocesses below continue to exercise the installed provider unchanged.
const providerOverride = vi.hoisted(() => ({ root: undefined as string | undefined }));
vi.mock("../../src/audits/core/auditRunner.js", async () => {
  const actual = await vi.importActual<typeof import("../../src/audits/core/auditRunner.js")>("../../src/audits/core/auditRunner.js");
  return { ...actual, runAudit: (options: Parameters<typeof actual.runAudit>[0]) => actual.runAudit(
    providerOverride.root === undefined ? options : { ...options, kitSourceProviderDependencies: { installedPackageRoot: providerOverride.root } }
  ) };
});
import { resolveInstalledKitPackage } from "../../src/audits/core/kitSourceProvider.js";
import { runAuditCommandFromArgs } from "../../src/commands/runAuditCommand.js";

async function runAuditWithProvider(args: string[], root: string) {
  providerOverride.root = root;
  const log = vi.spyOn(console, "log").mockImplementation(() => {});
  const error = vi.spyOn(console, "error").mockImplementation(() => {});
  try {
    const status = await runAuditCommandFromArgs(args);
    return { status, stderr: error.mock.calls.map(parts => parts.join(" ")).join("\n") };
  } finally { providerOverride.root = undefined; log.mockRestore(); error.mockRestore(); }
}


// ---------------------------------------------------------------------------
// v0.3.0 Batch 1 — real `npm run audit` CLI smoke tests.
//
// scripts/audits/runAudit.ts is a top-level entrypoint script (same
// convention as scripts/security/validate.ts) rather than an exported,
// directly-testable function, so exit-code behavior for config/target
// errors (which only happens at the script's own try/catch boundary) is
// verified here via real subprocess invocations, mirroring the CLI-smoke
// pattern in tests/security/securityReportSchemaStability.test.ts.
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

describe("npm run audit — defaults", () => {
  it("default source audit fails closed when the qualified producer is deliberately unavailable", async () => {
    const target = boundedCliTarget();
    const outDir = path.join(target, "audit-out");
    const result = await runAuditWithProvider(["--target", target, "--out", outDir], path.join(target, "missing-kit"));
    expect(result.status).toBe(2);
    expect(result.stderr).toContain("package-missing");
    expect(existsSync(path.join(outDir, "code-rot-audit.json"))).toBe(false);
  });

  it("--fail-on none cannot mask deliberately unavailable required evidence", async () => {
    const target = boundedCliTarget(); const outDir = path.join(target, "audit-out");
    const result = await runAuditWithProvider(["--target", target, "--types", "code-rot", "--fail-on", "none", "--out", outDir], path.join(target, "missing-kit"));
    expect(result.status).toBe(2); expect(result.stderr).toContain("package-missing");
    expect(existsSync(outDir)).toBe(false);
  });

  it("rejects an explicitly incompatible provider without a legacy fallback", async () => {
    const target = boundedCliTarget(); const root = path.join(target, "incompatible-kit");
    fs.mkdirSync(root); fs.writeFileSync(path.join(root, "package.json"), JSON.stringify({ name: "@dailephd/my-dev-kit", version: "1.14.0" }));
    const outDir = path.join(target, "audit-out");
    const result = await runAuditWithProvider(["--target", target, "--fail-on", "none", "--out", outDir], root);
    expect(result.status).toBe(2); expect(result.stderr).toContain("package-identity");
    expect(existsSync(outDir)).toBe(false);
    expect(existsSync(path.join(toolRoot, "src/audits/core/collectSourceFacts.ts"))).toBe(false);
  });

  it("accepts the authenticated managed published provider through the real CLI", () => {
    const target = boundedCliTarget(); const outDir = path.join(target, "audit-out");
    const result = runAuditCli(["--target", target, "--include", "package,cli", "--fail-on", "none", "--format", "json", "--out", outDir]);
    expect(result.status, result.stderr).toBe(0);
    expect(existsSync(path.join(outDir, "code-rot-audit.json"))).toBe(true);
    const report = JSON.parse(readFileSync(path.join(outDir, "code-rot-audit.json"), "utf8"));
    expect(resolveInstalledKitPackage().packageVersion).toBe("1.15.0");
    expect(report.sourceFacts.totalFilesAnalyzed).toBeGreaterThan(0);
    expect(report.sourceFacts.filesByParseStatus.parsed).toBeGreaterThan(0);
    expect(readFileSync(path.join(target, "src/index.ts"), "utf8")).toBe("export const value = 1;\n");
  }, 30_000);

  it("a non-source CLI selection preserves JSON/text report output", () => {
    const outDir = mkdtempSync(path.join(os.tmpdir(), "audit-smoke-full-"));
    cleanupDirs.push(outDir);
    const result = runAuditCli([
      "--target", boundedCliTarget(),
      "--types",
      "code-rot",
      "--include",
      "docs",
      "--format",
      "text,json",
      "--out",
      outDir,
    ]);
    expect(result.status).toBe(0);
    expect(existsSync(path.join(outDir, "code-rot-audit.json"))).toBe(true);
    expect(existsSync(path.join(outDir, "code-rot-audit.txt"))).toBe(true);

    // v0.3.0 Batch 2 restructured the JSON report into
    // { target, config, summary, issues, ... } per spec (see
    // tests/audits/auditReportInventoryOutput.test.ts for full Batch 2
    // report-shape coverage, including inventory/sourceOfTruth). Batch 5
    // further formalizes the schema: the authoritative exit code now lives
    // at top-level `exit.code` (with `summary.finalExitCode` mirroring the
    // same value) rather than `summary.exitCode` -- intentional Batch 5
    // schema maturation, not a regression.
    const parsed = JSON.parse(readFileSync(path.join(outDir, "code-rot-audit.json"), "utf8")) as {
      issues: unknown[];
      summary: { finalExitCode: number };
      exit: { code: number };
    };
    expect(Array.isArray(parsed.issues)).toBe(true);
    expect(parsed.summary.finalExitCode).toBe(0);
    expect(parsed.exit.code).toBe(0);
  }, 30_000);
});

describe("npm run audit — planned-but-not-implemented types fail cleanly", () => {
  function expectImplementedTypesListed(combined: string): void {
    expect(combined).toContain("Implemented audit types: code-rot, security.");
    expect(combined).not.toMatch(/Only "code-rot" is implemented/i);
  }

  it("--types quality exits 2 with a clear planned-but-not-implemented message", () => {
    const result = runAuditCli(["--types", "quality"]);
    expect(result.status).toBe(2);
    const combined = result.stdout + result.stderr;
    expect(combined).toMatch(/planned but not implemented/i);
    expectImplementedTypesListed(combined);
    expect(combined).not.toMatch(/at Object\.|at Module\._compile|node:internal/);
  }, 15_000);

  // v0.3.0 Batch 6 — spec 3.10 extends coverage to the other not-yet-
  // implemented audit types (only "quality" was covered before this batch).
  // v0.3.2 Batch 4 removes "security" from this list -- it is now a real,
  // implemented type via the security-validation audit adapter (see
  // tests/audits/security/auditSecurityIntegration.test.ts for its own
  // coverage) and must no longer be rejected here. The remaining types share
  // the same config-parse-time rejection path in
  // src/audits/core/auditConfig.ts's parseTypesOption(), so each gets the
  // same 3 assertions: exit 2, no raw Node stack trace on stderr, and no
  // report file written to a temp --out dir passed alongside the invalid
  // --types value (these are config-parse-time failures, before any
  // AuditResult/report model exists).
  for (const plannedType of ["project", "all"]) {
    it(`--types ${plannedType} exits 2 with a clear planned-but-not-implemented message and writes no report file`, () => {
      const outDir = mkdtempSync(path.join(os.tmpdir(), `audit-smoke-planned-${plannedType}-`));
      cleanupDirs.push(outDir);
      const result = runAuditCli(["--types", plannedType, "--out", outDir]);
      expect(result.status).toBe(2);
      const combined = result.stdout + result.stderr;
      expect(combined).toMatch(/planned but not implemented/i);
      expectImplementedTypesListed(combined);
      expect(combined).not.toMatch(/at Object\.|at Module\._compile|node:internal/);
      expect(existsSync(path.join(outDir, "code-rot-audit.json"))).toBe(false);
      expect(existsSync(path.join(outDir, "code-rot-audit.txt"))).toBe(false);
    }, 15_000);
  }
});

describe("npm run audit — invalid config/target exit code 2", () => {
  it("invalid --fail-on value exits 2", () => {
    const result = runAuditCli(["--fail-on", "critical"]);
    expect(result.status).toBe(2);
    expect(result.stdout + result.stderr).toMatch(/Invalid --fail-on value/);
  }, 15_000);

  it("invalid --target path exits 2", () => {
    const missing = path.join(os.tmpdir(), "audit-cli-missing-target-" + Date.now());
    const result = runAuditCli(["--target", missing]);
    expect(result.status).toBe(2);
    expect(result.stdout + result.stderr).toMatch(/does not exist/);
  }, 15_000);
});

describe("npm run audit — regression: existing commands still work", () => {
  it("npm run security:validate still works (scoped command smoke; full coverage lives in tests/security/)", () => {
    const resolved = resolveCommand("npx", { cwd: toolRoot });
    const needsResolvedPathArg =
      resolved.resolutionKind === "windows-cmd-shim" || resolved.resolutionKind === "windows-powershell-shim";
    const reportPrefix = "audit-regression-secval";
    const fullArgs = [
      ...resolved.argsPrefix,
      ...(needsResolvedPathArg && resolved.resolvedPath ? [resolved.resolvedPath] : []),
      "tsx",
      "scripts/security/validate.ts",
      "--checks",
      "boundary",
      "--format",
      "json",
      "--report-prefix",
      reportPrefix,
    ];
    const outDir = mkdtempSync(path.join(os.tmpdir(), "audit-regression-secval-"));
    cleanupDirs.push(outDir);
    let status = 0;
    try {
      execFileSync(resolved.command, [...fullArgs, "--out", outDir], { cwd: toolRoot, encoding: "utf8", timeout: 25_000 });
    } catch (err) {
      status = (err as { status?: number }).status ?? 1;
    }
    // security:validate exits 0/1/2 depending on verdict; only a genuine
    // crash (an unrecognized exit code) should fail this regression check.
    expect([0, 1, 2]).toContain(status);

    const jsonReportPath = path.join(outDir, `${reportPrefix}-security-validation.json`);
    expect(existsSync(jsonReportPath)).toBe(true);

    const jsonReport = JSON.parse(readFileSync(jsonReportPath, "utf8")) as {
      metadata?: { selectedChecks?: string[] };
    };
    expect(jsonReport.metadata?.selectedChecks).toEqual(["boundary"]);
  }, 35_000);
});

function boundedCliTarget(): string {
 const root = mkdtempSync(path.join(os.tmpdir(), "audit-cli-bounded-")); cleanupDirs.push(root);
 fs.writeFileSync(path.join(root, "package.json"), JSON.stringify({name:"@dailephd/my-dev-kit-lab",version:"1.0.0",scripts:{}}));
 fs.writeFileSync(path.join(root,"README.md"),"# Bounded audit fixture\n");
 fs.mkdirSync(path.join(root,"src")); fs.writeFileSync(path.join(root,"src/index.ts"),"export const value = 1;\n");
 return root;
}
