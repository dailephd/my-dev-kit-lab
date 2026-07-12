import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { runRequestedAndroidExternalTools } from "../../../../src/mobile/android/advancedSecurity/externalTools/runRequestedAndroidExternalTools.js";
import { ANDROID_SEMGREP_AUDIT_CHECK_ID } from "../../../../src/mobile/android/advancedSecurity/externalTools/semgrep/checkResult.js";
import { ANDROID_OSV_AUDIT_CHECK_ID } from "../../../../src/mobile/android/advancedSecurity/externalTools/osv/checkResult.js";
import { ANDROID_LINT_AUDIT_CHECK_ID } from "../../../../src/mobile/android/advancedSecurity/externalTools/androidLint/checkResult.js";
import { ANDROID_DEPENDENCY_CHECK_AUDIT_CHECK_ID } from "../../../../src/mobile/android/advancedSecurity/externalTools/dependencyCheck/checkResult.js";
import type { ExternalToolExecutor } from "../../../../src/mobile/android/advancedSecurity/externalTools/types.js";
import type { GradleCommandExecutor } from "../../../../src/mobile/android/gradle/validate/executor.js";
import type { AndroidDetectionResult } from "../../../../src/mobile/android/detection.js";
import type { CommandExecutionResult } from "../../../../src/securityValidation/types.js";

const roots: string[] = [];
afterEach(() => {
  for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true });
});

function makeDirs(): { targetRoot: string; artifactRoot: string } {
  const targetRoot = fs.mkdtempSync(path.join(os.tmpdir(), "dispatch-target-"));
  const artifactRoot = fs.mkdtempSync(path.join(os.tmpdir(), "dispatch-artifacts-"));
  roots.push(targetRoot, artifactRoot);
  fs.writeFileSync(path.join(targetRoot, "gradlew"), "#!/bin/sh\n");
  fs.writeFileSync(path.join(targetRoot, "gradlew.bat"), "@echo off\r\n");
  return { targetRoot, artifactRoot };
}

function detection(): AndroidDetectionResult {
  return {
    detected: true,
    confidence: "high",
    evidence: [],
    projectKind: "application",
    uiToolkit: "xml-view",
    hasGradleWrapper: true,
    gradleSettingsFiles: [],
    rootBuildFiles: [],
    versionCatalogFiles: [],
    modules: [{ path: "app", kind: "application", manifestPaths: [] }],
    applicationModules: ["app"],
    libraryModules: [],
    manifestPaths: [],
    javaSourceRoots: [],
    kotlinSourceRoots: [],
    unitTestSourceRoots: [],
    instrumentedTestSourceRoots: [],
    partialOrUnsupportedStructure: false,
    warnings: [],
  };
}

function baseResult(overrides: Partial<CommandExecutionResult> = {}): CommandExecutionResult {
  return { command: "tool", args: [], cwd: "", exitCode: 0, durationMs: 5, stdout: "", stderr: "", timedOut: false, skipped: false, ...overrides };
}

function unavailableExternalToolExecutor(): ExternalToolExecutor {
  return async () => baseResult({ exitCode: null });
}
function unavailableGradleExecutor(): GradleCommandExecutor {
  return async () => baseResult({ exitCode: null });
}

describe("runRequestedAndroidExternalTools — dispatcher", () => {
  it("executes zero tools when requestedTools is empty", async () => {
    const { targetRoot, artifactRoot } = makeDirs();
    const results = await runRequestedAndroidExternalTools({
      request: { requestedTools: [], targetRoot, artifactRoot },
      detection: detection(),
      executors: {},
    });
    expect(results).toHaveLength(0);
  });

  it("executes only the explicitly requested tool", async () => {
    const { targetRoot, artifactRoot } = makeDirs();
    const results = await runRequestedAndroidExternalTools({
      request: { requestedTools: ["semgrep"], targetRoot, artifactRoot },
      detection: detection(),
      executors: { semgrep: unavailableExternalToolExecutor() },
    });
    expect(results).toHaveLength(1);
    expect(results[0].id).toBe(ANDROID_SEMGREP_AUDIT_CHECK_ID);
  });

  it("executes all four requested tools in deterministic order", async () => {
    const { targetRoot, artifactRoot } = makeDirs();
    const results = await runRequestedAndroidExternalTools({
      request: { requestedTools: ["dependency-check", "android-lint", "osv", "semgrep"], targetRoot, artifactRoot, networkPolicy: "allow-for-requested-tool" },
      detection: detection(),
      executors: {
        semgrep: unavailableExternalToolExecutor(),
        osv: unavailableExternalToolExecutor(),
        androidLint: unavailableGradleExecutor(),
        dependencyCheck: unavailableExternalToolExecutor(),
      },
    });
    expect(results.map((r) => r.id)).toEqual([
      ANDROID_SEMGREP_AUDIT_CHECK_ID,
      ANDROID_OSV_AUDIT_CHECK_ID,
      ANDROID_LINT_AUDIT_CHECK_ID,
      ANDROID_DEPENDENCY_CHECK_AUDIT_CHECK_ID,
    ]);
  });

  it("rejects an unknown tool id rather than silently ignoring it", async () => {
    const { targetRoot, artifactRoot } = makeDirs();
    await expect(
      runRequestedAndroidExternalTools({
        request: { requestedTools: ["not-a-real-tool"], targetRoot, artifactRoot },
        detection: detection(),
        executors: {},
      })
    ).rejects.toThrow();
  });

  it("produces deterministic output across repeated runs with fake executors", async () => {
    const { targetRoot, artifactRoot } = makeDirs();
    const options = {
      request: { requestedTools: ["semgrep", "osv"], targetRoot, artifactRoot, networkPolicy: "allow-for-requested-tool" as const },
      detection: detection(),
      executors: { semgrep: unavailableExternalToolExecutor(), osv: unavailableExternalToolExecutor() },
    };
    const first = await runRequestedAndroidExternalTools(options);
    const second = await runRequestedAndroidExternalTools(options);
    expect(first.map((r) => r.status)).toEqual(second.map((r) => r.status));
  });
});
