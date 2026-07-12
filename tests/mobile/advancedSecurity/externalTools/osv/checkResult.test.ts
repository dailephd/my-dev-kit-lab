import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { auditAndroidOsv, ANDROID_OSV_AUDIT_CHECK_ID } from "../../../../../src/mobile/android/advancedSecurity/externalTools/osv/checkResult.js";
import type { ExternalToolExecutor } from "../../../../../src/mobile/android/advancedSecurity/externalTools/types.js";
import type { CommandExecutionResult } from "../../../../../src/securityValidation/types.js";

const roots: string[] = [];
afterEach(() => {
  for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true });
});
function tmpTarget(): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "osv-target-"));
  roots.push(root);
  return root;
}
function baseResult(overrides: Partial<CommandExecutionResult> = {}): CommandExecutionResult {
  return { command: "osv-scanner", args: [], cwd: "", exitCode: 0, durationMs: 5, stdout: "", stderr: "", timedOut: false, skipped: false, ...overrides };
}
function fakeExecutor(handler: (args: string[]) => CommandExecutionResult): ExternalToolExecutor {
  return async (input) => handler(input.args);
}
function fakeDiscover() {
  return { available: true as const, command: "osv-scanner", basename: "osv-scanner" };
}
function emptyResults(): string {
  return JSON.stringify({ results: [] });
}

describe("standalone OSV audit — network policy", () => {
  it("skips when network is denied (default policy)", async () => {
    const targetRoot = tmpTarget();
    const executor = fakeExecutor(() => baseResult({ stdout: "2.0.0\n" }));
    const result = await auditAndroidOsv({ targetRoot, executor, networkPolicy: "deny", discover: fakeDiscover });
    expect(result.id).toBe(ANDROID_OSV_AUDIT_CHECK_ID);
    expect(result.status).toBe("skipped");
  });

  it("runs when network is explicitly authorized and records the effective policy", async () => {
    const targetRoot = tmpTarget();
    const executor = fakeExecutor((args) => (args.includes("--version") ? baseResult({ stdout: "2.0.0\n" }) : baseResult({ stdout: emptyResults() })));
    const result = await auditAndroidOsv({ targetRoot, executor, networkPolicy: "allow-for-requested-tool", discover: fakeDiscover });
    expect(result.status).toBe("passed");
    expect(result.evidence.some((e) => e.includes("networkPolicy=allow-for-requested-tool"))).toBe(true);
  });
});

describe("standalone OSV audit — command families", () => {
  it("uses the modern 'scan source' command for version >= 2", async () => {
    const targetRoot = tmpTarget();
    const executor = fakeExecutor((args) => {
      if (args.includes("--version")) return baseResult({ stdout: "2.0.0\n" });
      expect(args.slice(0, 2)).toEqual(["scan", "source"]);
      return baseResult({ stdout: emptyResults() });
    });
    const result = await auditAndroidOsv({ targetRoot, executor, networkPolicy: "allow-for-requested-tool", discover: fakeDiscover });
    expect(result.evidence.some((e) => e.includes("commandFamily=modern"))).toBe(true);
  });

  it("uses the legacy command for version 1.x", async () => {
    const targetRoot = tmpTarget();
    const executor = fakeExecutor((args) => {
      if (args.includes("--version")) return baseResult({ stdout: "1.5.0\n" });
      expect(args[0]).not.toBe("scan");
      return baseResult({ stdout: emptyResults() });
    });
    const result = await auditAndroidOsv({ targetRoot, executor, networkPolicy: "allow-for-requested-tool", discover: fakeDiscover });
    expect(result.evidence.some((e) => e.includes("commandFamily=legacy"))).toBe(true);
  });

  it("skips on an unsupported version", async () => {
    const targetRoot = tmpTarget();
    const executor = fakeExecutor(() => baseResult({ stdout: "not-a-version\n" }));
    const result = await auditAndroidOsv({ targetRoot, executor, networkPolicy: "allow-for-requested-tool", discover: fakeDiscover });
    expect(result.status).toBe("skipped");
  });

  it("skips when the executable is unavailable", async () => {
    const targetRoot = tmpTarget();
    const executor = fakeExecutor(() => baseResult());
    const result = await auditAndroidOsv({
      targetRoot,
      executor,
      networkPolicy: "allow-for-requested-tool",
      discover: () => ({ available: false }),
    });
    expect(result.status).toBe("skipped");
  });
});

describe("standalone OSV audit — result normalization", () => {
  it("produces completed-without-findings for an empty valid report", async () => {
    const targetRoot = tmpTarget();
    const executor = fakeExecutor((args) => (args.includes("--version") ? baseResult({ stdout: "2.0.0\n" }) : baseResult({ stdout: emptyResults() })));
    const result = await auditAndroidOsv({ targetRoot, executor, networkPolicy: "allow-for-requested-tool", discover: fakeDiscover });
    expect(result.status).toBe("passed");
    expect(result.findings).toHaveLength(0);
  });

  it("normalizes package/version/vulnerability/aliases and maps high severity to major", async () => {
    const targetRoot = tmpTarget();
    fs.writeFileSync(path.join(targetRoot, "build.gradle"), "");
    const json = JSON.stringify({
      results: [
        {
          source: { path: "build.gradle", type: "lockfile" },
          packages: [
            {
              package: { name: "com.example:vulnerable-lib", version: "1.2.3", ecosystem: "Maven" },
              vulnerabilities: [
                { id: "GHSA-fake-1234", aliases: ["CVE-2024-00001"], summary: "Fake vulnerability for testing", database_specific: { severity: "HIGH" } },
              ],
            },
          ],
        },
      ],
    });
    const executor = fakeExecutor((args) => (args.includes("--version") ? baseResult({ stdout: "2.0.0\n" }) : baseResult({ stdout: json })));
    const result = await auditAndroidOsv({ targetRoot, executor, networkPolicy: "allow-for-requested-tool", discover: fakeDiscover });
    expect(result.findings).toHaveLength(1);
    expect(result.findings[0].severity).toBe("major");
    expect(result.findings[0].title).toContain("GHSA-fake-1234");
    expect(result.findings[0].evidence).toContain("CVE-2024-00001");
  });

  it("maps medium severity to minor and low to informational-review (candidate)", async () => {
    const targetRoot = tmpTarget();
    fs.writeFileSync(path.join(targetRoot, "build.gradle"), "");
    const json = JSON.stringify({
      results: [
        {
          source: { path: "build.gradle" },
          packages: [
            { package: { name: "pkg-a", version: "1.0", ecosystem: "Maven" }, vulnerabilities: [{ id: "OSV-1", database_specific: { severity: "MODERATE" } }] },
            { package: { name: "pkg-b", version: "1.0", ecosystem: "Maven" }, vulnerabilities: [{ id: "OSV-2", database_specific: { severity: "LOW" } }] },
          ],
        },
      ],
    });
    const executor = fakeExecutor((args) => (args.includes("--version") ? baseResult({ stdout: "2.0.0\n" }) : baseResult({ stdout: json })));
    const result = await auditAndroidOsv({ targetRoot, executor, networkPolicy: "allow-for-requested-tool", discover: fakeDiscover });
    expect(result.findings.some((f) => f.severity === "minor")).toBe(true);
    expect(result.findings.some((f) => f.severity === "informational")).toBe(true);
  });

  it("treats unknown severity as review evidence, not a blocker finding", async () => {
    const targetRoot = tmpTarget();
    fs.writeFileSync(path.join(targetRoot, "build.gradle"), "");
    const json = JSON.stringify({
      results: [{ source: { path: "build.gradle" }, packages: [{ package: { name: "pkg", version: "1.0", ecosystem: "Maven" }, vulnerabilities: [{ id: "OSV-X" }] }] }],
    });
    const executor = fakeExecutor((args) => (args.includes("--version") ? baseResult({ stdout: "2.0.0\n" }) : baseResult({ stdout: json })));
    const result = await auditAndroidOsv({ targetRoot, executor, networkPolicy: "allow-for-requested-tool", discover: fakeDiscover });
    expect(result.findings).toHaveLength(0);
    expect(result.candidateEvidence?.some((c) => c.ruleId === "android-optional-tool-osv-evidence")).toBe(true);
  });

  it("sanitizes an external (non-target-contained) manifest path rather than using it as a source location", async () => {
    const targetRoot = tmpTarget();
    const json = JSON.stringify({
      results: [{ source: { path: "../../outside/build.gradle" }, packages: [{ package: { name: "pkg", version: "1.0", ecosystem: "Maven" }, vulnerabilities: [{ id: "OSV-Y", database_specific: { severity: "HIGH" } }] }] }],
    });
    const executor = fakeExecutor((args) => (args.includes("--version") ? baseResult({ stdout: "2.0.0\n" }) : baseResult({ stdout: json })));
    const result = await auditAndroidOsv({ targetRoot, executor, networkPolicy: "allow-for-requested-tool", discover: fakeDiscover });
    expect(result.findings).toHaveLength(0);
    expect(result.candidateEvidence?.length ?? 0).toBeGreaterThan(0);
  });

  it("does not treat a vulnerability exit code (1) with valid JSON as a crash", async () => {
    const targetRoot = tmpTarget();
    const executor = fakeExecutor((args) => (args.includes("--version") ? baseResult({ stdout: "2.0.0\n" }) : baseResult({ stdout: emptyResults(), exitCode: 1 })));
    const result = await auditAndroidOsv({ targetRoot, executor, networkPolicy: "allow-for-requested-tool", discover: fakeDiscover });
    expect(result.status).toBe("passed");
    expect(result.errors).toHaveLength(0);
  });

  it("treats a service/network failure (malformed output) as inconclusive", async () => {
    const targetRoot = tmpTarget();
    const executor = fakeExecutor((args) => (args.includes("--version") ? baseResult({ stdout: "2.0.0\n" }) : baseResult({ stdout: "{ not json", exitCode: 0 })));
    const result = await auditAndroidOsv({ targetRoot, executor, networkPolicy: "allow-for-requested-tool", discover: fakeDiscover });
    expect(result.status).toBe("inconclusive");
  });

  it("deduplicates exact duplicate vulnerability occurrences", async () => {
    const targetRoot = tmpTarget();
    fs.writeFileSync(path.join(targetRoot, "build.gradle"), "");
    const vuln = { id: "OSV-DUP", database_specific: { severity: "HIGH" } };
    const json = JSON.stringify({
      results: [{ source: { path: "build.gradle" }, packages: [{ package: { name: "pkg", version: "1.0", ecosystem: "Maven" }, vulnerabilities: [vuln, vuln] }] }],
    });
    const executor = fakeExecutor((args) => (args.includes("--version") ? baseResult({ stdout: "2.0.0\n" }) : baseResult({ stdout: json })));
    const result = await auditAndroidOsv({ targetRoot, executor, networkPolicy: "allow-for-requested-tool", discover: fakeDiscover });
    expect(result.findings).toHaveLength(1);
  });

  it("produces deterministic output across repeated runs", async () => {
    const targetRoot = tmpTarget();
    const executor = fakeExecutor((args) => (args.includes("--version") ? baseResult({ stdout: "2.0.0\n" }) : baseResult({ stdout: emptyResults() })));
    const first = await auditAndroidOsv({ targetRoot, executor, networkPolicy: "allow-for-requested-tool", discover: fakeDiscover });
    const second = await auditAndroidOsv({ targetRoot, executor, networkPolicy: "allow-for-requested-tool", discover: fakeDiscover });
    expect(first).toEqual(second);
  });

  it("remains standalone: correct category and optional requirement level", async () => {
    const targetRoot = tmpTarget();
    const executor = fakeExecutor((args) => (args.includes("--version") ? baseResult({ stdout: "2.0.0\n" }) : baseResult({ stdout: emptyResults() })));
    const result = await auditAndroidOsv({ targetRoot, executor, networkPolicy: "allow-for-requested-tool", discover: fakeDiscover });
    expect(result.category).toBe("android-osv");
    expect(result.requirementLevel).toBe("optional");
  });
});
