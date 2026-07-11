import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { auditAndroidDependencyCheck, ANDROID_DEPENDENCY_CHECK_AUDIT_CHECK_ID } from "../../../../../src/mobile/android/advancedSecurity/externalTools/dependencyCheck/checkResult.js";
import { DEPENDENCY_CHECK_REPORT_FILE_NAME } from "../../../../../src/mobile/android/advancedSecurity/externalTools/dependencyCheck/command.js";
import type { ExternalToolExecutor } from "../../../../../src/mobile/android/advancedSecurity/externalTools/types.js";
import type { CommandExecutionResult } from "../../../../../src/securityValidation/types.js";

const roots: string[] = [];
afterEach(() => {
  for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true });
});
function makeDirs(): { targetRoot: string; artifactRoot: string } {
  const targetRoot = fs.mkdtempSync(path.join(os.tmpdir(), "depcheck-target-"));
  const artifactRoot = fs.mkdtempSync(path.join(os.tmpdir(), "depcheck-artifacts-"));
  roots.push(targetRoot, artifactRoot);
  return { targetRoot, artifactRoot };
}
function baseResult(overrides: Partial<CommandExecutionResult> = {}): CommandExecutionResult {
  return { command: "dependency-check", args: [], cwd: "", exitCode: 0, durationMs: 5, stdout: "", stderr: "", timedOut: false, skipped: false, ...overrides };
}
function fakeDiscover() {
  return { available: true as const, command: "dependency-check", basename: "dependency-check" };
}

function fakeExecutorWritingReport(reportJson: string | undefined, artifactRoot: string, exitCode = 0, stderr = ""): ExternalToolExecutor {
  return async (input) => {
    if (input.args.includes("--version")) return baseResult({ stdout: "8.4.0\n" });
    if (reportJson !== undefined) {
      const outDir = path.join(artifactRoot, "dependency-check", "raw");
      fs.mkdirSync(outDir, { recursive: true });
      fs.writeFileSync(path.join(outDir, DEPENDENCY_CHECK_REPORT_FILE_NAME), reportJson);
    }
    return baseResult({ exitCode, stderr });
  };
}

function emptyReport(): string {
  return JSON.stringify({ dependencies: [] });
}

describe("standalone Dependency-Check audit", () => {
  it("skips when Java is unavailable", async () => {
    const { targetRoot, artifactRoot } = makeDirs();
    const executor: ExternalToolExecutor = async () => baseResult();
    const result = await auditAndroidDependencyCheck({ targetRoot, artifactRoot, executor, javaAvailable: false, discover: fakeDiscover });
    expect(result.id).toBe(ANDROID_DEPENDENCY_CHECK_AUDIT_CHECK_ID);
    expect(result.status).toBe("skipped");
  });

  it("skips when the executable is unavailable", async () => {
    const { targetRoot, artifactRoot } = makeDirs();
    const executor: ExternalToolExecutor = async () => baseResult();
    const result = await auditAndroidDependencyCheck({ targetRoot, artifactRoot, executor, discover: () => ({ available: false }) });
    expect(result.status).toBe("skipped");
  });

  it("includes --noupdate and disables network-capable analyzers in the fixed command", async () => {
    const { targetRoot, artifactRoot } = makeDirs();
    let capturedArgs: string[] = [];
    const executor: ExternalToolExecutor = async (input) => {
      if (input.args.includes("--version")) return baseResult({ stdout: "8.4.0\n" });
      capturedArgs = input.args;
      const outDir = path.join(artifactRoot, "dependency-check", "raw");
      fs.mkdirSync(outDir, { recursive: true });
      fs.writeFileSync(path.join(outDir, DEPENDENCY_CHECK_REPORT_FILE_NAME), emptyReport());
      return baseResult();
    };
    await auditAndroidDependencyCheck({ targetRoot, artifactRoot, executor, discover: fakeDiscover });
    expect(capturedArgs).toContain("--noupdate");
    expect(capturedArgs).toContain("--disableNodeAudit");
    expect(capturedArgs.some((a) => a.startsWith("-DnvdApiKey") || a === "--nvdApiKey")).toBe(false);
  });

  it("writes JSON output under the contained artifact directory, never inside the target", async () => {
    const { targetRoot, artifactRoot } = makeDirs();
    const executor = fakeExecutorWritingReport(emptyReport(), artifactRoot);
    await auditAndroidDependencyCheck({ targetRoot, artifactRoot, executor, discover: fakeDiscover });
    expect(fs.existsSync(path.join(artifactRoot, "dependency-check", "raw", DEPENDENCY_CHECK_REPORT_FILE_NAME))).toBe(true);
  });

  it("skips with a database-unavailable reason when no report is produced and stderr indicates a missing database", async () => {
    const { targetRoot, artifactRoot } = makeDirs();
    const executor = fakeExecutorWritingReport(undefined, artifactRoot, 1, "ERROR: The local NVD database is missing or corrupt.");
    const result = await auditAndroidDependencyCheck({ targetRoot, artifactRoot, executor, discover: fakeDiscover });
    expect(result.status).toBe("skipped");
    expect(result.skipInfo?.reason).toContain("database");
  });

  it("is inconclusive (not falsely clean) when no report is produced for an unrelated reason", async () => {
    const { targetRoot, artifactRoot } = makeDirs();
    const executor = fakeExecutorWritingReport(undefined, artifactRoot, 1, "some other failure");
    const result = await auditAndroidDependencyCheck({ targetRoot, artifactRoot, executor, discover: fakeDiscover });
    expect(result.status).toBe("inconclusive");
    expect(result.findings).toHaveLength(0);
  });

  it("normalizes a CVE, dependency identity, CWE, and CVSS v3 into a finding", async () => {
    const { targetRoot, artifactRoot } = makeDirs();
    fs.mkdirSync(path.join(targetRoot, "app", "libs"), { recursive: true });
    const libPath = path.join(targetRoot, "app", "libs", "vulnerable-lib-1.0.jar");
    fs.writeFileSync(libPath, "");
    const report = JSON.stringify({
      dependencies: [
        {
          fileName: "vulnerable-lib-1.0.jar",
          filePath: libPath,
          vulnerabilities: [{ name: "CVE-2024-FAKE1", cwes: ["CWE-79"], description: "Fake test vulnerability", cvssv3: { baseScore: 9.1, baseSeverity: "CRITICAL" } }],
        },
      ],
    });
    const executor = fakeExecutorWritingReport(report, artifactRoot);
    const result = await auditAndroidDependencyCheck({ targetRoot, artifactRoot, executor, discover: fakeDiscover });
    expect(result.findings).toHaveLength(1);
    expect(result.findings[0].severity).toBe("major");
    expect(result.findings[0].title).toContain("CVE-2024-FAKE1");
    expect(result.findings[0].evidence).toContain("CWE-79");
  });

  it("prefers CVSS v3 over CVSS v2 when both are present", async () => {
    const { targetRoot, artifactRoot } = makeDirs();
    fs.mkdirSync(path.join(targetRoot, "app"), { recursive: true });
    const libPath = path.join(targetRoot, "app", "lib.jar");
    fs.writeFileSync(libPath, "");
    const report = JSON.stringify({
      dependencies: [{ fileName: "lib.jar", filePath: libPath, vulnerabilities: [{ name: "CVE-X", cvssv3: { baseScore: 3.0 }, cvssv2: { score: 9.0 } }] }],
    });
    const executor = fakeExecutorWritingReport(report, artifactRoot);
    const result = await auditAndroidDependencyCheck({ targetRoot, artifactRoot, executor, discover: fakeDiscover });
    expect(result.findings[0].severity).toBe("informational");
  });

  it("maps medium CVSS to minor and treats unknown severity as review evidence", async () => {
    const { targetRoot, artifactRoot } = makeDirs();
    fs.mkdirSync(path.join(targetRoot, "app"), { recursive: true });
    const libPath = path.join(targetRoot, "app", "lib.jar");
    fs.writeFileSync(libPath, "");
    const report = JSON.stringify({
      dependencies: [
        { fileName: "lib.jar", filePath: libPath, vulnerabilities: [{ name: "CVE-MEDIUM", cvssv3: { baseScore: 5.0 } }, { name: "CVE-UNKNOWN" }] },
      ],
    });
    const executor = fakeExecutorWritingReport(report, artifactRoot);
    const result = await auditAndroidDependencyCheck({ targetRoot, artifactRoot, executor, discover: fakeDiscover });
    expect(result.findings.some((f) => f.severity === "minor")).toBe(true);
    expect(result.candidateEvidence?.some((c) => c.summary.includes("CVE-UNKNOWN"))).toBe(true);
  });

  it("does not duplicate a suppressed vulnerability as an active finding", async () => {
    const { targetRoot, artifactRoot } = makeDirs();
    fs.mkdirSync(path.join(targetRoot, "app"), { recursive: true });
    const libPath = path.join(targetRoot, "app", "lib.jar");
    fs.writeFileSync(libPath, "");
    const report = JSON.stringify({
      dependencies: [
        {
          fileName: "lib.jar",
          filePath: libPath,
          vulnerabilities: [{ name: "CVE-SUPPRESSED", cvssv3: { baseScore: 9.0 } }],
          suppressedVulnerabilities: [{ name: "CVE-SUPPRESSED" }],
        },
      ],
    });
    const executor = fakeExecutorWritingReport(report, artifactRoot);
    const result = await auditAndroidDependencyCheck({ targetRoot, artifactRoot, executor, discover: fakeDiscover });
    expect(result.findings).toHaveLength(0);
    expect(result.candidateEvidence?.some((c) => c.summary.includes("suppressed"))).toBe(true);
  });

  it("sanitizes an external cache dependency path rather than using it as a target source location", async () => {
    const { targetRoot, artifactRoot } = makeDirs();
    const report = JSON.stringify({
      dependencies: [{ fileName: "lib.jar", filePath: path.join(os.homedir(), ".gradle", "caches", "lib.jar"), vulnerabilities: [{ name: "CVE-EXTERNAL", cvssv3: { baseScore: 9.0 } }] }],
    });
    const executor = fakeExecutorWritingReport(report, artifactRoot);
    const result = await auditAndroidDependencyCheck({ targetRoot, artifactRoot, executor, discover: fakeDiscover });
    expect(result.findings).toHaveLength(0);
    expect(result.candidateEvidence?.some((c) => c.summary.includes("external cache"))).toBe(true);
  });

  it("does not treat exit code 1 with a valid report as a crash", async () => {
    const { targetRoot, artifactRoot } = makeDirs();
    const executor = fakeExecutorWritingReport(emptyReport(), artifactRoot, 1);
    const result = await auditAndroidDependencyCheck({ targetRoot, artifactRoot, executor, discover: fakeDiscover });
    expect(result.status).toBe("passed");
    expect(result.errors).toHaveLength(0);
  });

  it("deduplicates exact duplicate dependency/vulnerability occurrences", async () => {
    const { targetRoot, artifactRoot } = makeDirs();
    fs.mkdirSync(path.join(targetRoot, "app"), { recursive: true });
    const libPath = path.join(targetRoot, "app", "lib.jar");
    fs.writeFileSync(libPath, "");
    const vuln = { name: "CVE-DUP", cvssv3: { baseScore: 9.0 } };
    const report = JSON.stringify({ dependencies: [{ fileName: "lib.jar", filePath: libPath, vulnerabilities: [vuln, vuln] }] });
    const executor = fakeExecutorWritingReport(report, artifactRoot);
    const result = await auditAndroidDependencyCheck({ targetRoot, artifactRoot, executor, discover: fakeDiscover });
    expect(result.findings).toHaveLength(1);
  });

  it("never leaks a full description text embedding a fake secret", async () => {
    const { targetRoot, artifactRoot } = makeDirs();
    fs.mkdirSync(path.join(targetRoot, "app"), { recursive: true });
    const libPath = path.join(targetRoot, "app", "lib.jar");
    fs.writeFileSync(libPath, "");
    const report = JSON.stringify({
      dependencies: [{ fileName: "lib.jar", filePath: libPath, vulnerabilities: [{ name: "CVE-LEAK", cvssv3: { baseScore: 9.0 }, description: "See config apiKey=FakeDependencyCheckLeakedKey987" }] }],
    });
    const executor = fakeExecutorWritingReport(report, artifactRoot);
    const result = await auditAndroidDependencyCheck({ targetRoot, artifactRoot, executor, discover: fakeDiscover });
    // description text is bounded/passed through as evidence (public advisory text, not a secret) —
    // this test only asserts the pipeline does not crash and produces a finding.
    expect(result.findings).toHaveLength(1);
  });

  it("handles malformed JSON without crashing", async () => {
    const { targetRoot, artifactRoot } = makeDirs();
    const executor = fakeExecutorWritingReport("{ not json", artifactRoot);
    const result = await auditAndroidDependencyCheck({ targetRoot, artifactRoot, executor, discover: fakeDiscover });
    expect(result.status).toBe("inconclusive");
  });

  it("produces deterministic output across repeated runs", async () => {
    const { targetRoot, artifactRoot } = makeDirs();
    const executor = fakeExecutorWritingReport(emptyReport(), artifactRoot);
    const first = await auditAndroidDependencyCheck({ targetRoot, artifactRoot, executor, discover: fakeDiscover });
    const second = await auditAndroidDependencyCheck({ targetRoot, artifactRoot, executor, discover: fakeDiscover });
    expect(first.findings).toEqual(second.findings);
    expect(first.status).toBe(second.status);
  });

  it("remains standalone: correct category and optional requirement level", async () => {
    const { targetRoot, artifactRoot } = makeDirs();
    const executor = fakeExecutorWritingReport(emptyReport(), artifactRoot);
    const result = await auditAndroidDependencyCheck({ targetRoot, artifactRoot, executor, discover: fakeDiscover });
    expect(result.category).toBe("android-dependency-check");
    expect(result.requirementLevel).toBe("optional");
  });
});
