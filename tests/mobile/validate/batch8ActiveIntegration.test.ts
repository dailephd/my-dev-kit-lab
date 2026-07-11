import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { validateAndroidTarget } from "../../../src/mobile/android/validate/validateAndroidTarget.js";
import { toAndroidReportModel } from "../../../src/mobile/android/report/model.js";
import { renderAndroidTextReport } from "../../../src/mobile/android/report/renderAndroidReport.js";
import type { GradleCommandExecutor } from "../../../src/mobile/android/gradle/validate/executor.js";
import type { ExternalToolExecutor } from "../../../src/mobile/android/advancedSecurity/externalTools/types.js";
import type { CommandExecutionResult } from "../../../src/securityValidation/types.js";

const FIXTURES_ROOT = path.resolve(__dirname, "..", "..", "fixtures", "android");
const TOOL_ROOT = path.resolve(__dirname, "..", "..", "..");

function fixture(name: string): string {
  return path.join(FIXTURES_ROOT, name);
}

const roots: string[] = [];
afterEach(() => {
  for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true });
});

function makeTargetWithWrapper(): string {
  const targetRoot = fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()), "batch8-target-"));
  roots.push(targetRoot);
  fs.cpSync(fixture("compose-app"), targetRoot, { recursive: true });
  fs.writeFileSync(path.join(targetRoot, "gradlew"), "#!/bin/sh\n");
  fs.writeFileSync(path.join(targetRoot, "gradlew.bat"), "@echo off\r\n");
  return targetRoot;
}

function baseCommandResult(overrides: Partial<CommandExecutionResult> = {}): CommandExecutionResult {
  return { command: "tool", args: [], cwd: "", exitCode: 0, durationMs: 5, stdout: "", stderr: "", timedOut: false, skipped: false, ...overrides };
}

const ADVANCED_CHECK_IDS_IN_ORDER = [
  "android-network-security-audit",
  "android-backup-configuration-audit",
  "android-release-configuration-audit",
  "android-secret-candidates-audit",
  "android-signing-configuration-audit",
  "android-webview-security-audit",
  "android-file-provider-audit",
  "android-sensitive-storage-audit",
  "android-sensitive-logging-audit",
  "android-clipboard-security-audit",
  "android-firebase-google-services-audit",
];

describe("Batch 8 — active internal-check integration", () => {
  it("runs all 19 active checks (8 v0.4.0 + 11 advanced) in deterministic order", async () => {
    const result = await validateAndroidTarget({ toolRoot: TOOL_ROOT, targetPath: fixture("compose-app") });
    const ids = result.checks.map((c) => c.id);
    expect(ids).toHaveLength(19);
    const v040Order = [
      "android-project-detection",
      "android-manifest-parsing",
      "android-permissions-audit",
      "android-exported-components-audit",
      "android-intent-filters-audit",
      "android-deep-links-audit",
      "android-gradle-metadata",
      "android-target-immutability",
    ];
    expect(ids.slice(0, 8)).toEqual(v040Order);
    expect(ids.slice(8)).toEqual(ADVANCED_CHECK_IDS_IN_ORDER);
  });

  it("does not run advanced Android checks for a non-Android target", async () => {
    const nonAndroidRoot = fs.mkdtempSync(fs.realpathSync(os.tmpdir()));
    roots.push(nonAndroidRoot);
    fs.writeFileSync(path.join(nonAndroidRoot, "package.json"), "{}");
    const result = await validateAndroidTarget({ toolRoot: TOOL_ROOT, targetPath: nonAndroidRoot });
    const ids = result.checks.map((c) => c.id);
    for (const advancedId of ADVANCED_CHECK_IDS_IN_ORDER) {
      const check = result.checks.find((c) => c.id === advancedId);
      expect(check?.status === "unsupported" || !ids.includes(advancedId)).toBe(true);
    }
  });

  it("runs zero processes and zero external tools by default", async () => {
    const result = await validateAndroidTarget({ toolRoot: TOOL_ROOT, targetPath: fixture("compose-app") });
    const gradleOpChecks = result.checks.filter((c) => c.id.startsWith("android-gradle-") && c.id !== "android-gradle-metadata");
    const externalChecks = result.checks.filter((c) => ["android-semgrep", "android-osv", "android-lint", "android-dependency-check"].includes(c.category));
    expect(gradleOpChecks).toHaveLength(0);
    expect(externalChecks).toHaveLength(0);
  });

  it("produces stable structural check order across repeated runs", async () => {
    const first = await validateAndroidTarget({ toolRoot: TOOL_ROOT, targetPath: fixture("compose-app") });
    const second = await validateAndroidTarget({ toolRoot: TOOL_ROOT, targetPath: fixture("compose-app") });
    expect(first.checks.map((c) => c.id)).toEqual(second.checks.map((c) => c.id));
  });
});

describe("Batch 8 — external-tool dispatch failure isolation", () => {
  it("an unexpected dispatcher-level error does not discard checks already gathered", async () => {
    const throwingExecutor: ExternalToolExecutor = async () => {
      throw new Error("simulated dispatcher failure");
    };
    const result = await validateAndroidTarget({
      toolRoot: TOOL_ROOT,
      targetPath: fixture("compose-app"),
      requestedExternalToolIds: ["semgrep"],
      externalToolExecutors: { semgrep: throwingExecutor },
    });
    // The 19 static checks are still present even though the external-tool
    // path failed unexpectedly.
    expect(result.checks.length).toBeGreaterThanOrEqual(19);
    expect(result.checks.some((c) => c.id === "android-project-detection")).toBe(true);
  });
});

describe("Batch 8 — fake multi-tool smoke (all four external tools)", () => {
  it("executes only requested tools in fixed order with deterministic findings, candidates, and no raw output leakage", async () => {
    const targetRoot = makeTargetWithWrapper();
    const artifactRoot = fs.mkdtempSync(path.join(os.tmpdir(), "batch8-artifacts-"));
    roots.push(artifactRoot);

    const fakeExternalExecutor: ExternalToolExecutor = async (input) => {
      if (input.args.includes("--version")) return baseCommandResult({ stdout: "1.0.0\n" });
      if (input.command.includes("dependency-check") || input.args.some((a) => a.includes("dependency-check"))) {
        return baseCommandResult({ exitCode: 1, stderr: "FakeToolLeakedSecretMarker should never appear" });
      }
      return baseCommandResult({ stdout: JSON.stringify({ version: "1.0.0", results: [] }) });
    };
    const fakeGradleExecutor: GradleCommandExecutor = async (plan) => baseCommandResult({ command: plan.wrapperExecutablePath, args: plan.args, cwd: plan.cwd, exitCode: 1 });

    // Real semgrep/osv/dependency-check binaries are never installed in CI
    // (or reliably in any dev sandbox) — discovery is injected
    // deterministically so this test actually exercises execution rather
    // than incidentally passing/failing based on the runner's PATH.
    const fakeDiscover = (basename: string) => () => ({ available: true as const, command: basename, basename });

    const result = await validateAndroidTarget({
      toolRoot: TOOL_ROOT,
      targetPath: targetRoot,
      requestedExternalToolIds: ["dependency-check", "android-lint", "osv", "semgrep"],
      externalNetworkPolicy: "allow-for-requested-tool",
      externalToolArtifactRoot: artifactRoot,
      externalToolExecutors: {
        semgrep: fakeExternalExecutor,
        osv: fakeExternalExecutor,
        androidLint: fakeGradleExecutor,
        dependencyCheck: fakeExternalExecutor,
      },
      externalToolDiscover: {
        semgrep: fakeDiscover("semgrep"),
        osv: fakeDiscover("osv-scanner"),
        dependencyCheck: fakeDiscover("dependency-check"),
      },
    });

    const externalIds = result.checks.filter((c) => c.id.startsWith("android-") && ["android-semgrep-audit", "android-osv-audit", "android-lint-audit", "android-dependency-check-audit"].includes(c.id)).map((c) => c.id);
    expect(externalIds).toEqual(["android-semgrep-audit", "android-osv-audit", "android-lint-audit", "android-dependency-check-audit"]);

    const semgrepCheck = result.checks.find((c) => c.id === "android-semgrep-audit");
    const osvCheck = result.checks.find((c) => c.id === "android-osv-audit");
    expect(semgrepCheck?.status).toBe("passed");
    expect(osvCheck?.status).toBe("passed");

    const serialized = JSON.stringify(result);
    expect(serialized).not.toContain("FakeToolLeakedSecretMarker");
  });
});

describe("Batch 8 — Gradle/Android Lint deduplication", () => {
  it("does not run lintDebug twice when requested via both --android-gradle-operations and --android-external-tools", async () => {
    const targetRoot = makeTargetWithWrapper();
    const artifactRoot = fs.mkdtempSync(path.join(os.tmpdir(), "batch8-dedup-artifacts-"));
    roots.push(artifactRoot);

    let lintInvocations = 0;
    const countingExecutor: GradleCommandExecutor = async (plan) => {
      if (plan.operationId === "lint-debug") lintInvocations += 1;
      return baseCommandResult({ command: plan.wrapperExecutablePath, args: plan.args, cwd: plan.cwd, exitCode: 0 });
    };

    const result = await validateAndroidTarget({
      toolRoot: TOOL_ROOT,
      targetPath: targetRoot,
      requestedGradleOperationIds: ["lint-debug"],
      requestedExternalToolIds: ["android-lint"],
      gradleExecutor: countingExecutor,
      externalToolArtifactRoot: artifactRoot,
      allowGradleWithoutTaskDiscovery: true,
    });

    expect(lintInvocations).toBe(1);
    // Both the existing Gradle-operation result and the normalized external
    // Android Lint check are still present (distinct provenance preserved).
    expect(result.checks.some((c) => c.id === "android-gradle-lint-debug")).toBe(true);
    expect(result.checks.some((c) => c.id === "android-lint-audit")).toBe(true);
  });
});

describe("Batch 8 — OSV network policy integration", () => {
  // OSV-Scanner is never installed in CI (or reliably in any dev sandbox),
  // so discovery is injected deterministically rather than relying on real
  // PATH lookup — otherwise this suite is flaky/environment-dependent (it
  // passed locally by incidental PATH contents but failed on every CI OS).
  const fakeOsvDiscover = () => ({ available: true as const, command: "osv-scanner", basename: "osv-scanner" });

  it("skips OSV when requested with deny (default)", async () => {
    const result = await validateAndroidTarget({
      toolRoot: TOOL_ROOT,
      targetPath: fixture("compose-app"),
      requestedExternalToolIds: ["osv"],
      externalToolExecutors: { osv: async () => baseCommandResult({ stdout: "2.0.0\n" }) },
      externalToolDiscover: { osv: fakeOsvDiscover },
    });
    const osvCheck = result.checks.find((c) => c.id === "android-osv-audit");
    expect(osvCheck?.status).toBe("skipped");
  });

  it("runs OSV when requested with allow-for-requested-tool", async () => {
    const result = await validateAndroidTarget({
      toolRoot: TOOL_ROOT,
      targetPath: fixture("compose-app"),
      requestedExternalToolIds: ["osv"],
      externalNetworkPolicy: "allow-for-requested-tool",
      externalToolExecutors: {
        osv: async (input) => (input.args.includes("--version") ? baseCommandResult({ stdout: "2.0.0\n" }) : baseCommandResult({ stdout: JSON.stringify({ results: [] }) })),
      },
      externalToolDiscover: { osv: fakeOsvDiscover },
    });
    const osvCheck = result.checks.find((c) => c.id === "android-osv-audit");
    expect(osvCheck?.status).toBe("passed");
  });
});

describe("Batch 8 — verdict integration", () => {
  it("an unrequested external tool has no verdict effect", async () => {
    const withoutTools = await validateAndroidTarget({ toolRoot: TOOL_ROOT, targetPath: fixture("compose-app") });
    expect(withoutTools.verdict).not.toBe("not-ready-security-blocker-remains");
  });

  it("a requested-but-skipped external tool contributes advisory reasoning, not a blocker", async () => {
    const result = await validateAndroidTarget({
      toolRoot: TOOL_ROOT,
      targetPath: fixture("compose-app"),
      requestedExternalToolIds: ["osv"],
      // deny (default) -> OSV skips.
    });
    expect(result.verdict).not.toBe("not-ready-security-blocker-remains");
    expect((result.verdictReasons ?? []).some((r) => r.code === "android-optional-check-not-run")).toBe(true);
  });
});

describe("Batch 8 — JSON/text report parity", () => {
  it("text and JSON agree on check ids, statuses, and finding/candidate counts", async () => {
    const result = await validateAndroidTarget({ toolRoot: TOOL_ROOT, targetPath: fixture("compose-app") });
    const model = toAndroidReportModel(result, { profile: "android" });
    const text = renderAndroidTextReport(model);

    for (const check of model.advancedSecurityChecks) {
      expect(text).toContain(check.id);
      expect(text).toContain(`findings: ${check.findings.length}`);
      expect(text).toContain(`candidates: ${check.candidateEvidence?.length ?? 0}`);
    }
  });

  it("candidate evidence is visible in the text report distinctly from confirmed findings", async () => {
    const result = await validateAndroidTarget({ toolRoot: TOOL_ROOT, targetPath: fixture("compose-app") });
    const model = toAndroidReportModel(result, { profile: "android" });
    const text = renderAndroidTextReport(model);
    expect(text).toContain("CANDIDATE EVIDENCE (REVIEW REQUIRED — NOT CONFIRMED FINDINGS)");
  });
});
