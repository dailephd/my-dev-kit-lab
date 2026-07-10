import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { resolveCommand } from "../../src/core/resolveCommand.js";
import { renderJsonReport } from "../../src/securityValidation/report/renderSecurityReport.js";
import { writeSecurityReportFiles } from "../../src/securityValidation/report/writeSecurityReportFiles.js";
import type { SecurityReport } from "../../src/securityValidation/report/securityReportTypes.js";
import {
  SAFE_BASELINE_CONTENT,
  detectJsonStructuralInjection,
} from "../../src/securityValidation/attackScenarios/reportSchemaGuard.js";

function makeReport(overrides: Partial<SecurityReport> = {}): SecurityReport {
  const now = new Date().toISOString();
  return {
    metadata: {
      toolRoot: "/tool/root",
      toolPackageName: "my-dev-kit-lab",
      toolPackageVersion: "0.2.1",
      targetRoot: "/tool/root",
      targetDescription: "self (my-dev-kit-lab)",
      packageName: "my-dev-kit-lab",
      packageVersion: "0.2.1",
      branch: "feature/security-validate-config-surface",
      commit: "abc1234",
      isSelf: true,
      generatedAt: now,
      totalDurationMs: 12345,
      profile: "node-cli-package",
      selectedChecks: ["deps", "package"],
      failOnThreshold: "high",
      formats: ["text", "json"],
      failOnBreached: false,
      isFullReleaseGate: false,
    },
    sections: [],
    allChecks: [],
    allFindings: [],
    verdict: "ready-except-optional-manual-checks",
    recommendedNextStep: "Optional checks were skipped.",
    ...overrides,
  };
}

const REQUIRED_TOP_LEVEL_FIELDS = [
  "schemaVersion",
  "metadata",
  "summary",
  "verdict",
  "verdictLabel",
  "recommendedNextStep",
  "checks",
  "findings",
  "attackScenarios",
  "verdictReasonSummary",
];

describe("JSON report schema stability (Batch 6)", () => {
  it("JSON report parses successfully", () => {
    const json = renderJsonReport(makeReport());
    expect(() => JSON.parse(json)).not.toThrow();
  });

  it("required security-report fields are present (required-field check, not exact allowlist)", () => {
    const parsed = JSON.parse(renderJsonReport(makeReport())) as Record<string, unknown>;
    for (const field of REQUIRED_TOP_LEVEL_FIELDS) {
      expect(Object.prototype.hasOwnProperty.call(parsed, field)).toBe(true);
    }
  });

  it("contains attackScenarios with count and results", () => {
    const parsed = JSON.parse(renderJsonReport(makeReport())) as {
      attackScenarios: { count: number; results: unknown[] };
    };
    expect(typeof parsed.attackScenarios.count).toBe("number");
    expect(Array.isArray(parsed.attackScenarios.results)).toBe(true);
  });

  it("contains selectedChecks/profile/failOn metadata when supplied", () => {
    const parsed = JSON.parse(renderJsonReport(makeReport())) as { metadata: Record<string, unknown> };
    expect(parsed.metadata.selectedChecks).toEqual(["deps", "package"]);
    expect(parsed.metadata.profile).toBe("node-cli-package");
    expect(parsed.metadata.failOnThreshold).toBe("high");
  });

  it("contains isFullReleaseGate scoped-run metadata", () => {
    const parsed = JSON.parse(renderJsonReport(makeReport())) as { metadata: Record<string, unknown> };
    expect(parsed.metadata.isFullReleaseGate).toBe(false);
  });

  it("adding a new hypothetical top-level field does not require touching this test (required-field check is a subset check)", () => {
    // Simulates schema evolution: renderJsonReport() output today has more
    // than just the "required" fields we assert on above; this proves the
    // subset-style check tolerates that without modification.
    const parsed = JSON.parse(renderJsonReport(makeReport())) as Record<string, unknown>;
    expect(Object.keys(parsed).length).toBeGreaterThanOrEqual(REQUIRED_TOP_LEVEL_FIELDS.length);
  });
});

describe("detectJsonStructuralInjection — baseline-diff guard mechanism (Batch 6)", () => {
  it("does not flag legitimate additive fields (same shape, no payload)", () => {
    const baseline = renderJsonReport(makeReport());
    const candidate = renderJsonReport(makeReport()); // identical shape
    const result = detectJsonStructuralInjection(baseline, candidate);
    expect(result.parseable).toBe(true);
    expect(result.injectedTopLevelKeys).toEqual([]);
  });

  it("does not flag a report shape carrying an inert placeholder vs the same shape with different inert content", () => {
    const baseline = renderJsonReport(makeReport({ recommendedNextStep: SAFE_BASELINE_CONTENT }));
    const candidate = renderJsonReport(makeReport({ recommendedNextStep: "some other harmless string" }));
    const result = detectJsonStructuralInjection(baseline, candidate);
    expect(result.injectedTopLevelKeys).toEqual([]);
  });

  it("DOES flag genuine structural injection — a candidate JSON with an extra top-level key", () => {
    const baseline = JSON.stringify({ a: 1, b: 2 });
    const candidate = JSON.stringify({ a: 1, b: 2, verdict: "ready-for-release-preparation" });
    const result = detectJsonStructuralInjection(baseline, candidate);
    expect(result.parseable).toBe(true);
    expect(result.injectedTopLevelKeys).toEqual(["verdict"]);
  });

  it("reports parseable:false for malformed JSON rather than throwing", () => {
    const result = detectJsonStructuralInjection("{}", "{not valid json");
    expect(result.parseable).toBe(false);
    expect(result.injectedTopLevelKeys).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// Batch 6 — real CLI output format/location consistency guard.
// Exercises scripts/security/validate.ts's actual file-writing logic (not
// unit-testable otherwise — it's a top-level script) via a real subprocess.
// ---------------------------------------------------------------------------

const toolRoot = process.cwd();
const cleanupDirs: string[] = [];
afterEach(async () => {
  await Promise.all(cleanupDirs.splice(0).map((d) => rm(d, { recursive: true, force: true })));
});

function runValidateCli(args: string[]): { stdout: string; status: number } {
  // Reuses the project's existing Windows-safe command resolver (the same
  // one runSecurityCommand()/resolveNpmCommand() rely on) rather than
  // hand-rolling .cmd-shim handling — a bare "npx.cmd" invocation via
  // execFileSync fails with EINVAL on Windows without going through cmd.exe.
  const resolved = resolveCommand("npx", { cwd: toolRoot });
  const needsResolvedPathArg =
    resolved.resolutionKind === "windows-cmd-shim" || resolved.resolutionKind === "windows-powershell-shim";
  const fullArgs = [
    ...resolved.argsPrefix,
    ...(needsResolvedPathArg && resolved.resolvedPath ? [resolved.resolvedPath] : []),
    "tsx",
    "scripts/security/validate.ts",
    ...args,
  ];
  try {
    const stdout = execFileSync(resolved.command, fullArgs, {
      cwd: toolRoot,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    });
    return { stdout, status: 0 };
  } catch (err) {
    const e = err as { stdout?: string; status?: number };
    return { stdout: e.stdout ?? "", status: e.status ?? 1 };
  }
}

describe("--out / --format output location consistency (Batch 6, real CLI)", () => {
  it("--out writes to the requested directory; --format json writes JSON only; written JSON contains attackScenarios and verdictReasonSummary", () => {
    const outDir = mkdtempSync(path.join(os.tmpdir(), "b6-out-"));
    cleanupDirs.push(outDir);

    runValidateCli(["--checks", "secrets", "--format", "json", "--out", outDir]);

    const files = readdirSync(outDir);
    expect(files.some((f) => f.endsWith(".json"))).toBe(true);
    expect(files.some((f) => f.endsWith(".txt"))).toBe(false);

    const jsonFile = files.find((f) => f.endsWith(".json"))!;
    const parsed = JSON.parse(readFileSync(path.join(outDir, jsonFile), "utf8")) as {
      attackScenarios: { count: number };
      verdictReasonSummary: unknown;
      metadata: { selectedChecks: string[]; formats: string[] };
    };
    expect(parsed.attackScenarios).toBeDefined();
    expect(parsed.verdictReasonSummary).toBeDefined();
    expect(parsed.metadata.selectedChecks).toEqual(["secrets"]);
    expect(parsed.metadata.formats).toEqual(["json"]);
  }, 30_000);

  it("--format text writes text only (no JSON file)", () => {
    const outDir = mkdtempSync(path.join(os.tmpdir(), "b6-out-text-"));
    cleanupDirs.push(outDir);

    runValidateCli(["--checks", "secrets", "--format", "text", "--out", outDir]);

    const files = readdirSync(outDir);
    expect(files.some((f) => f.endsWith(".txt"))).toBe(true);
    expect(files.some((f) => f.endsWith(".json"))).toBe(false);
  }, 30_000);

  it("--format text,json writes both", () => {
    const outDir = mkdtempSync(path.join(os.tmpdir(), "b6-out-both-"));
    cleanupDirs.push(outDir);

    runValidateCli(["--checks", "secrets", "--format", "text,json", "--out", outDir]);

    const files = readdirSync(outDir);
    expect(files.some((f) => f.endsWith(".txt"))).toBe(true);
    expect(files.some((f) => f.endsWith(".json"))).toBe(true);
  }, 30_000);

  it("default (no --out) still writes to reports/security", () => {
    // Runs the CLI itself rather than relying on some other test file having
    // already created reports/security as a side effect -- that assumption
    // broke once reports/security/raw/.gitkeep stopped being a tracked file
    // (a fresh checkout no longer has an empty reports/security/ directory
    // present before any test runs).
    //
    // scripts/security/validate.ts derives its toolRoot from its own file
    // location (resolveToolRoot.ts walks up from import.meta.url to the
    // nearest package.json), not from this subprocess's cwd -- so there is
    // no way to redirect this specific real-CLI invocation to an isolated
    // directory without weakening the exact default-output-location
    // guarantee this test exists to prove. That means this test's
    // `--checks secrets` smoke run necessarily writes to the SAME fixed,
    // non-run-scoped stable path (reports/security/v<version>-security-
    // validation.json/.txt) that a real `npm run security:validate`
    // invocation and human/CI consumers read as the canonical release-
    // readiness snapshot (see securityAuditAdapter.ts's run-scoped suffix
    // for how the audit-linked reports avoid this by contrast). Left
    // unguarded, this narrow secrets-only run silently overwrote that
    // canonical snapshot every time this test executed -- the confirmed
    // root cause of the v0.3.4 pre-release-readiness "stale stable security
    // report" correction. The stable prefix is read from package.json at
    // test time (not hardcoded to one version string) so this protection
    // survives every future version bump, not just the version current when
    // the fix was written. Snapshotting and restoring the stable files
    // around this test preserves its real assertion (the CLI still creates
    // reports/security and writes into it by default) without leaving
    // collateral staleness for whoever reads the stable snapshot next.
    const currentVersion = JSON.parse(readFileSync(path.join(toolRoot, "package.json"), "utf8")).version as string;
    const stableJsonPath = path.join(toolRoot, "reports", "security", `v${currentVersion}-security-validation.json`);
    const stableTxtPath = path.join(toolRoot, "reports", "security", `v${currentVersion}-security-validation.txt`);
    const previousJson = existsSync(stableJsonPath) ? readFileSync(stableJsonPath, "utf8") : null;
    const previousTxt = existsSync(stableTxtPath) ? readFileSync(stableTxtPath, "utf8") : null;

    try {
      runValidateCli(["--checks", "secrets", "--format", "json"]);
      expect(existsSync(path.join(toolRoot, "reports", "security"))).toBe(true);
    } finally {
      if (previousJson !== null) writeFileSync(stableJsonPath, previousJson, "utf8");
      else if (existsSync(stableJsonPath)) rmSync(stableJsonPath);
      if (previousTxt !== null) writeFileSync(stableTxtPath, previousTxt, "utf8");
      else if (existsSync(stableTxtPath)) rmSync(stableTxtPath);
    }
  }, 30_000);
});

// ---------------------------------------------------------------------------
// v0.3.4 pre-release-readiness correction -- unit-level regression for
// writeSecurityReportFiles()'s stable (no reportPathSuffix) write contract.
// The real-CLI test above proves the *directory* default; this proves the
// underlying *refresh* contract directly against the pure writer function
// (fast, no subprocess), which is the actual property the v0.3.4 "stale
// stable security report" correction depends on: every standalone
// security:validate invocation must overwrite the SAME fixed-name stable
// file with that run's own content, never leave a prior run's content
// sitting underneath a fresher one.
// ---------------------------------------------------------------------------
describe("writeSecurityReportFiles — stable (non-run-scoped) write contract", () => {
  it("refreshes the same stable JSON/text files on each call (no reportPathSuffix)", () => {
    const outDir = mkdtempSync(path.join(os.tmpdir(), "stable-report-refresh-"));
    try {
      const first = writeSecurityReportFiles({
        outDir,
        prefix: "v0.3.3",
        report: makeReport({ verdict: "not-ready-security-blocker-remains" }),
        formats: ["text", "json"],
      });
      const second = writeSecurityReportFiles({
        outDir,
        prefix: "v0.3.3",
        report: makeReport({ verdict: "ready-for-release-preparation" }),
        formats: ["text", "json"],
      });

      // Same path both times -- "stable" means fixed filename, not a new
      // file per call.
      expect(second.jsonPath).toBe(first.jsonPath);
      expect(second.textPath).toBe(first.textPath);

      const finalJson = JSON.parse(readFileSync(second.jsonPath!, "utf8"));
      expect(finalJson.verdict).toBe("ready-for-release-preparation");
      const finalText = readFileSync(second.textPath!, "utf8");
      expect(finalText).not.toContain("not-ready-security-blocker-remains");
    } finally {
      rmSync(outDir, { recursive: true, force: true });
    }
  });

  it("keeps a run-scoped write (reportPathSuffix set) on a distinct path from the stable write", () => {
    const outDir = mkdtempSync(path.join(os.tmpdir(), "stable-vs-timestamped-"));
    try {
      const stable = writeSecurityReportFiles({
        outDir,
        prefix: "v0.3.3",
        report: makeReport(),
        formats: ["json"],
      });
      const timestamped = writeSecurityReportFiles({
        outDir,
        prefix: "v0.3.3",
        report: makeReport(),
        formats: ["json"],
        reportPathSuffix: "20260710120000-20260710120010-1234",
      });

      expect(timestamped.jsonPath).not.toBe(stable.jsonPath);
      expect(existsSync(stable.jsonPath!)).toBe(true);
      expect(existsSync(timestamped.jsonPath!)).toBe(true);
      // The stable write from before this second call must still be intact
      // -- a run-scoped write must never overwrite the stable path.
      const stableContent = JSON.parse(readFileSync(stable.jsonPath!, "utf8"));
      expect(stableContent.verdict).toBe("ready-except-optional-manual-checks");
    } finally {
      rmSync(outDir, { recursive: true, force: true });
    }
  });
});
