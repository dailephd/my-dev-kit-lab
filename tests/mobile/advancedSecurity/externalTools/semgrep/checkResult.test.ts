import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { auditAndroidSemgrep, ANDROID_SEMGREP_AUDIT_CHECK_ID } from "../../../../../src/mobile/android/advancedSecurity/externalTools/semgrep/checkResult.js";
import { assertUniqueSemgrepRuleIds, serializeSemgrepRulePack } from "../../../../../src/mobile/android/advancedSecurity/externalTools/semgrep/rules.js";
import type { ExternalToolExecutor } from "../../../../../src/mobile/android/advancedSecurity/externalTools/types.js";
import type { CommandExecutionResult } from "../../../../../src/securityValidation/types.js";

const roots: string[] = [];
afterEach(() => {
  for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true });
});

function makeDirs(): { targetRoot: string; artifactRoot: string } {
  const targetRoot = fs.mkdtempSync(path.join(os.tmpdir(), "semgrep-target-"));
  const artifactRoot = fs.mkdtempSync(path.join(os.tmpdir(), "semgrep-artifacts-"));
  roots.push(targetRoot, artifactRoot);
  return { targetRoot, artifactRoot };
}

function baseResult(overrides: Partial<CommandExecutionResult> = {}): CommandExecutionResult {
  return { command: "semgrep", args: [], cwd: "", exitCode: 0, durationMs: 5, stdout: "", stderr: "", timedOut: false, skipped: false, ...overrides };
}

function fakeExecutor(handler: (args: string[]) => CommandExecutionResult): ExternalToolExecutor {
  return async (input) => handler(input.args);
}

function fakeDiscover() {
  return { available: true as const, command: "semgrep", basename: "semgrep" };
}

function emptyResultsJson(version = "1.45.0"): string {
  return JSON.stringify({ version, results: [], errors: [], paths: { scanned: ["Main.java"], skipped: [] } });
}

describe("Semgrep rule pack", () => {
  it("has unique rule ids", () => {
    expect(() => assertUniqueSemgrepRuleIds()).not.toThrow();
  });
  it("serializes deterministically", () => {
    expect(serializeSemgrepRulePack()).toBe(serializeSemgrepRulePack());
  });
});

describe("standalone Semgrep audit", () => {
  it("skips when the executable is unavailable (simulated via a version probe returning null exit code)", async () => {
    const { targetRoot, artifactRoot } = makeDirs();
    const executor = fakeExecutor(() => baseResult({ exitCode: null }));
    const result = await auditAndroidSemgrep({ targetRoot, artifactRoot, executor, discover: fakeDiscover });
    expect(result.id).toBe(ANDROID_SEMGREP_AUDIT_CHECK_ID);
    expect(result.status).toBe("skipped");
  });

  it("uses the modern command family for version >= 1", async () => {
    const { targetRoot, artifactRoot } = makeDirs();
    const executor = fakeExecutor((args) => {
      if (args.includes("--version")) return baseResult({ stdout: "1.45.0\n" });
      expect(args[0]).toBe("scan");
      return baseResult({ stdout: emptyResultsJson("1.45.0") });
    });
    const result = await auditAndroidSemgrep({ targetRoot, artifactRoot, executor, discover: fakeDiscover });
    expect(result.evidence.some((e) => e.includes("commandFamily=modern"))).toBe(true);
  });

  it("uses the legacy command family for version 0.x", async () => {
    const { targetRoot, artifactRoot } = makeDirs();
    const executor = fakeExecutor((args) => {
      if (args.includes("--version")) return baseResult({ stdout: "0.98.0\n" });
      expect(args[0]).not.toBe("scan");
      return baseResult({ stdout: emptyResultsJson("0.98.0") });
    });
    const result = await auditAndroidSemgrep({ targetRoot, artifactRoot, executor, discover: fakeDiscover });
    expect(result.evidence.some((e) => e.includes("commandFamily=legacy"))).toBe(true);
  });

  it("skips on an unsupported version", async () => {
    const { targetRoot, artifactRoot } = makeDirs();
    const executor = fakeExecutor(() => baseResult({ stdout: "not-a-version\n" }));
    const result = await auditAndroidSemgrep({ targetRoot, artifactRoot, executor, discover: fakeDiscover });
    expect(result.status).toBe("skipped");
  });

  it("disables metrics and version-check in the fixed arguments and uses no remote registry config", async () => {
    const { targetRoot, artifactRoot } = makeDirs();
    let capturedArgs: string[] = [];
    const executor = fakeExecutor((args) => {
      if (!args.includes("--version")) capturedArgs = args;
      return args.includes("--version") ? baseResult({ stdout: "1.45.0\n" }) : baseResult({ stdout: emptyResultsJson() });
    });
    await auditAndroidSemgrep({ targetRoot, artifactRoot, executor, discover: fakeDiscover });
    expect(capturedArgs).toContain("--metrics=off");
    expect(capturedArgs).toContain("--disable-version-check");
    expect(capturedArgs.some((a) => a.startsWith("p/") || a.startsWith("r/") || a.startsWith("registry."))).toBe(false);
    expect(capturedArgs).toContain("--json");
  });

  it("includes fixed excludes for generated/dependency directories", async () => {
    const { targetRoot, artifactRoot } = makeDirs();
    let capturedArgs: string[] = [];
    const executor = fakeExecutor((args) => {
      if (!args.includes("--version")) capturedArgs = args;
      return args.includes("--version") ? baseResult({ stdout: "1.45.0\n" }) : baseResult({ stdout: emptyResultsJson() });
    });
    await auditAndroidSemgrep({ targetRoot, artifactRoot, executor, discover: fakeDiscover });
    expect(capturedArgs).toContain("node_modules");
    expect(capturedArgs).toContain(".gradle");
  });

  it("normalizes a valid ERROR-severity result into a major finding", async () => {
    const { targetRoot, artifactRoot } = makeDirs();
    fs.mkdirSync(path.join(targetRoot, "app"), { recursive: true });
    fs.writeFileSync(path.join(targetRoot, "app", "Foo.java"), "class Foo {}");
    const json = JSON.stringify({
      version: "1.45.0",
      results: [
        {
          check_id: "android-semgrep-world-readable-writable-mode",
          path: "app/Foo.java",
          start: { line: 5, col: 1 },
          end: { line: 5, col: 10 },
          extra: { message: "World-readable mode used", severity: "ERROR" },
        },
      ],
      errors: [],
      paths: { scanned: ["app/Foo.java"], skipped: [] },
    });
    const executor = fakeExecutor((args) => (args.includes("--version") ? baseResult({ stdout: "1.45.0\n" }) : baseResult({ stdout: json })));
    const result = await auditAndroidSemgrep({ targetRoot, artifactRoot, executor, discover: fakeDiscover });
    expect(result.findings).toHaveLength(1);
    expect(result.findings[0].severity).toBe("major");
    expect(result.status).toBe("failed");
  });

  it("maps WARNING severity to minor and INFO to candidate evidence", async () => {
    const { targetRoot, artifactRoot } = makeDirs();
    const json = JSON.stringify({
      version: "1.45.0",
      results: [
        { check_id: "r1", path: "app/A.java", start: { line: 1 }, extra: { message: "warn", severity: "WARNING" } },
        { check_id: "r2", path: "app/B.java", start: { line: 2 }, extra: { message: "info", severity: "INFO" } },
      ],
      errors: [],
      paths: { scanned: [], skipped: [] },
    });
    const executor = fakeExecutor((args) => (args.includes("--version") ? baseResult({ stdout: "1.45.0\n" }) : baseResult({ stdout: json })));
    const result = await auditAndroidSemgrep({ targetRoot, artifactRoot, executor, discover: fakeDiscover });
    expect(result.findings.some((f) => f.severity === "minor")).toBe(true);
    expect(result.candidateEvidence?.length ?? 0).toBeGreaterThan(0);
  });

  it("does not treat exit code 1 with valid JSON as a crash", async () => {
    const { targetRoot, artifactRoot } = makeDirs();
    const executor = fakeExecutor((args) => (args.includes("--version") ? baseResult({ stdout: "1.45.0\n" }) : baseResult({ stdout: emptyResultsJson(), exitCode: 1 })));
    const result = await auditAndroidSemgrep({ targetRoot, artifactRoot, executor, discover: fakeDiscover });
    expect(result.status).toBe("passed");
    expect(result.errors).toHaveLength(0);
  });

  it("treats malformed JSON as inconclusive without crashing", async () => {
    const { targetRoot, artifactRoot } = makeDirs();
    const executor = fakeExecutor((args) => (args.includes("--version") ? baseResult({ stdout: "1.45.0\n" }) : baseResult({ stdout: "{ not json", exitCode: 0 })));
    const result = await auditAndroidSemgrep({ targetRoot, artifactRoot, executor, discover: fakeDiscover });
    expect(result.status).toBe("inconclusive");
  });

  it("marks a genuine tool error (non-findings exit code, no valid JSON) as error", async () => {
    const { targetRoot, artifactRoot } = makeDirs();
    const executor = fakeExecutor((args) => (args.includes("--version") ? baseResult({ stdout: "1.45.0\n" }) : baseResult({ stdout: "", stderr: "fatal error", exitCode: 2 })));
    const result = await auditAndroidSemgrep({ targetRoot, artifactRoot, executor, discover: fakeDiscover });
    expect(result.status).toBe("failed");
  });

  it("marks a timed-out analysis as inconclusive", async () => {
    const { targetRoot, artifactRoot } = makeDirs();
    const executor = fakeExecutor((args) => (args.includes("--version") ? baseResult({ stdout: "1.45.0\n" }) : baseResult({ timedOut: true, exitCode: null })));
    const result = await auditAndroidSemgrep({ targetRoot, artifactRoot, executor, discover: fakeDiscover });
    expect(result.status).toBe("inconclusive");
  });

  it("writes the config artifact under the tool-owned artifact directory", async () => {
    const { targetRoot, artifactRoot } = makeDirs();
    const executor = fakeExecutor((args) => (args.includes("--version") ? baseResult({ stdout: "1.45.0\n" }) : baseResult({ stdout: emptyResultsJson() })));
    await auditAndroidSemgrep({ targetRoot, artifactRoot, executor, discover: fakeDiscover });
    expect(fs.existsSync(path.join(artifactRoot, "semgrep", "android-rules.yaml"))).toBe(true);
  });

  it("produces deterministic output across repeated runs", async () => {
    const { targetRoot, artifactRoot } = makeDirs();
    const executor = fakeExecutor((args) => (args.includes("--version") ? baseResult({ stdout: "1.45.0\n" }) : baseResult({ stdout: emptyResultsJson() })));
    const first = await auditAndroidSemgrep({ targetRoot, artifactRoot, executor, discover: fakeDiscover });
    const second = await auditAndroidSemgrep({ targetRoot, artifactRoot, executor, discover: fakeDiscover });
    expect(first.findings).toEqual(second.findings);
    expect(first.status).toBe(second.status);
  });

  it("never leaks a fake secret embedded in a matched message into the result", async () => {
    const { targetRoot, artifactRoot } = makeDirs();
    const json = JSON.stringify({
      version: "1.45.0",
      results: [
        {
          check_id: "r1",
          path: "app/A.java",
          start: { line: 1 },
          extra: { message: "matched value", severity: "ERROR", lines: 'String password = "FakeSemgrepLeakedSecret123";' },
        },
      ],
      errors: [],
      paths: { scanned: [], skipped: [] },
    });
    const executor = fakeExecutor((args) => (args.includes("--version") ? baseResult({ stdout: "1.45.0\n" }) : baseResult({ stdout: json })));
    const result = await auditAndroidSemgrep({ targetRoot, artifactRoot, executor, discover: fakeDiscover });
    expect(JSON.stringify(result)).not.toContain("FakeSemgrepLeakedSecret123");
  });

  it("remains standalone: correct category and optional requirement level", async () => {
    const { targetRoot, artifactRoot } = makeDirs();
    const executor = fakeExecutor((args) => (args.includes("--version") ? baseResult({ stdout: "1.45.0\n" }) : baseResult({ stdout: emptyResultsJson() })));
    const result = await auditAndroidSemgrep({ targetRoot, artifactRoot, executor, discover: fakeDiscover });
    expect(result.category).toBe("android-semgrep");
    expect(result.requirementLevel).toBe("optional");
  });
});
