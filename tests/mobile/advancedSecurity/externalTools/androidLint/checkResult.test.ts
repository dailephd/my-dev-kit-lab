import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { auditAndroidLint, ANDROID_LINT_AUDIT_CHECK_ID } from "../../../../../src/mobile/android/advancedSecurity/externalTools/androidLint/checkResult.js";
import type { GradleCommandExecutor } from "../../../../../src/mobile/android/gradle/validate/executor.js";
import type { AndroidDetectionResult } from "../../../../../src/mobile/android/detection.js";
import type { CommandExecutionResult } from "../../../../../src/securityValidation/types.js";

const roots: string[] = [];
afterEach(() => {
  for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true });
});

function makeTargetWithWrapper(): string {
  const targetRoot = fs.mkdtempSync(path.join(os.tmpdir(), "lint-target-"));
  roots.push(targetRoot);
  fs.writeFileSync(path.join(targetRoot, "gradlew"), "#!/bin/sh\n");
  fs.writeFileSync(path.join(targetRoot, "gradlew.bat"), "@echo off\r\n");
  fs.mkdirSync(path.join(targetRoot, "app"), { recursive: true });
  return targetRoot;
}

function makeTargetWithoutWrapper(): string {
  const targetRoot = fs.mkdtempSync(path.join(os.tmpdir(), "lint-target-nowrapper-"));
  roots.push(targetRoot);
  fs.mkdirSync(path.join(targetRoot, "app"), { recursive: true });
  return targetRoot;
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
  return { command: "gradlew", args: [], cwd: "", exitCode: 0, durationMs: 5, stdout: "", stderr: "", timedOut: false, skipped: false, ...overrides };
}

function fakeExecutor(result: CommandExecutionResult, onExecute?: () => void): GradleCommandExecutor {
  return async () => {
    onExecute?.();
    return result;
  };
}

function writeFreshLintXml(targetRoot: string, relativeDir: string, issuesXml: string): string {
  const dir = path.join(targetRoot, relativeDir);
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, "lint-results-debug.xml");
  fs.writeFileSync(file, `<?xml version="1.0" encoding="UTF-8"?>\n<issues format="6" by="lint 8.0.0">\n${issuesXml}\n</issues>\n`);
  return file;
}

function issueXml(id: string, severity: string, message: string, file: string, line: number): string {
  return `  <issue id="${id}" severity="${severity}" message="${message}" category="Security" priority="5">\n    <location file="${file}" line="${line}" column="1"/>\n  </issue>`;
}

describe("standalone Android Lint audit", () => {
  it("skips when no Gradle wrapper is present for this platform (reuses existing planner rejection)", async () => {
    const targetRoot = makeTargetWithoutWrapper();
    const artifactRoot = fs.mkdtempSync(path.join(os.tmpdir(), "lint-artifacts-"));
    roots.push(artifactRoot);
    const result = await auditAndroidLint({ targetRoot, detection: detection(), executor: fakeExecutor(baseResult()), artifactRoot });
    expect(result.id).toBe(ANDROID_LINT_AUDIT_CHECK_ID);
    expect(result.status).toBe("skipped");
  });

  it("skips when the lintDebug task is known unavailable", async () => {
    const targetRoot = makeTargetWithWrapper();
    const artifactRoot = fs.mkdtempSync(path.join(os.tmpdir(), "lint-artifacts-"));
    roots.push(artifactRoot);
    const result = await auditAndroidLint({ targetRoot, detection: detection(), executor: fakeExecutor(baseResult()), artifactRoot, taskAvailable: false });
    expect(result.status).toBe("skipped");
  });

  it("marks a timed-out lint run as inconclusive", async () => {
    const targetRoot = makeTargetWithWrapper();
    const artifactRoot = fs.mkdtempSync(path.join(os.tmpdir(), "lint-artifacts-"));
    roots.push(artifactRoot);
    const result = await auditAndroidLint({ targetRoot, detection: detection(), executor: fakeExecutor(baseResult({ timedOut: true, exitCode: null })), artifactRoot });
    expect(result.status).toBe("inconclusive");
  });

  it("is inconclusive when no fresh structured report is discovered", async () => {
    const targetRoot = makeTargetWithWrapper();
    const artifactRoot = fs.mkdtempSync(path.join(os.tmpdir(), "lint-artifacts-"));
    roots.push(artifactRoot);
    const result = await auditAndroidLint({ targetRoot, detection: detection(), executor: fakeExecutor(baseResult({ exitCode: 0 })), artifactRoot });
    expect(result.status).toBe("inconclusive");
    expect(result.findings).toHaveLength(0);
  });

  it("normalizes a fresh Error-severity XML issue into a major finding", async () => {
    const targetRoot = makeTargetWithWrapper();
    const artifactRoot = fs.mkdtempSync(path.join(os.tmpdir(), "lint-artifacts-"));
    roots.push(artifactRoot);
    const result = await auditAndroidLint({
      targetRoot,
      detection: detection(),
      executor: fakeExecutor(baseResult({ exitCode: 0 }), () =>
        writeFreshLintXml(targetRoot, "app/build/reports", issueXml("HardcodedText", "Error", "Hardcoded string found", "app/src/main/java/Foo.java", 12))
      ),
      artifactRoot,
    });
    expect(result.findings).toHaveLength(1);
    expect(result.findings[0].severity).toBe("major");
    expect(result.status).toBe("failed");
  });

  it("maps Warning to minor and Information to candidate evidence", async () => {
    const targetRoot = makeTargetWithWrapper();
    const artifactRoot = fs.mkdtempSync(path.join(os.tmpdir(), "lint-artifacts-"));
    roots.push(artifactRoot);
    const result = await auditAndroidLint({
      targetRoot,
      detection: detection(),
      executor: fakeExecutor(baseResult({ exitCode: 0 }), () =>
        writeFreshLintXml(
          targetRoot,
          "app/build/reports",
          [
            issueXml("UnusedResources", "Warning", "Unused resource", "app/src/main/res/values/strings.xml", 3),
            issueXml("Typos", "Information", "Possible typo", "app/src/main/java/Foo.java", 1),
          ].join("\n")
        )
      ),
      artifactRoot,
    });
    expect(result.findings.some((f) => f.severity === "minor")).toBe(true);
    expect(result.candidateEvidence?.length ?? 0).toBeGreaterThan(0);
  });

  it("does not misclassify a stale pre-existing report as current-run evidence", async () => {
    const targetRoot = makeTargetWithWrapper();
    const artifactRoot = fs.mkdtempSync(path.join(os.tmpdir(), "lint-artifacts-"));
    roots.push(artifactRoot);
    // Written BEFORE the check runs and not touched again — must be ignored.
    // Waits comfortably longer than the adapter's freshness epsilon (250ms)
    // so this stays a genuine "stale" case even under filesystem mtime
    // rounding.
    writeFreshLintXml(targetRoot, "app/build/reports", issueXml("StaleIssue", "Error", "Should not be picked up", "app/src/main/java/Stale.java", 1));
    await new Promise((r) => setTimeout(r, 400));
    const result = await auditAndroidLint({ targetRoot, detection: detection(), executor: fakeExecutor(baseResult({ exitCode: 0 })), artifactRoot });
    expect(result.findings.some((f) => f.title.includes("StaleIssue"))).toBe(false);
  });

  it("preserves findings and execution error together when Gradle exits non-zero but a fresh valid report exists", async () => {
    const targetRoot = makeTargetWithWrapper();
    const artifactRoot = fs.mkdtempSync(path.join(os.tmpdir(), "lint-artifacts-"));
    roots.push(artifactRoot);
    const result = await auditAndroidLint({
      targetRoot,
      detection: detection(),
      executor: fakeExecutor(baseResult({ exitCode: 1 }), () => writeFreshLintXml(targetRoot, "app/build/reports", issueXml("Security", "Fatal", "Fatal issue", "app/src/main/java/Foo.java", 1))),
      artifactRoot,
    });
    expect(result.findings).toHaveLength(1);
    expect(result.warnings.some((w) => w.includes("exited with code 1"))).toBe(true);
  });

  it("is inconclusive when Gradle exits non-zero and no report exists", async () => {
    const targetRoot = makeTargetWithWrapper();
    const artifactRoot = fs.mkdtempSync(path.join(os.tmpdir(), "lint-artifacts-"));
    roots.push(artifactRoot);
    const result = await auditAndroidLint({ targetRoot, detection: detection(), executor: fakeExecutor(baseResult({ exitCode: 1 })), artifactRoot });
    expect(result.status).toBe("inconclusive");
  });

  it("copies the fresh report into the artifact root without deleting the original", async () => {
    const targetRoot = makeTargetWithWrapper();
    const artifactRoot = fs.mkdtempSync(path.join(os.tmpdir(), "lint-artifacts-"));
    roots.push(artifactRoot);
    let source = "";
    await auditAndroidLint({
      targetRoot,
      detection: detection(),
      executor: fakeExecutor(baseResult({ exitCode: 0 }), () => {
        source = writeFreshLintXml(targetRoot, "app/build/reports", issueXml("X", "Warning", "msg", "app/src/main/java/Foo.java", 1));
      }),
      artifactRoot,
    });
    expect(fs.existsSync(source)).toBe(true);
    expect(fs.existsSync(path.join(artifactRoot, "android-lint", "lint-results-debug.xml"))).toBe(true);
  });

  it("classifies an expected build/ mutation without flagging it as unexpected", async () => {
    const targetRoot = makeTargetWithWrapper();
    const artifactRoot = fs.mkdtempSync(path.join(os.tmpdir(), "lint-artifacts-"));
    roots.push(artifactRoot);
    const result = await auditAndroidLint({ targetRoot, detection: detection(), executor: fakeExecutor(baseResult({ exitCode: 0 })), artifactRoot });
    // build/ output classification is exercised indirectly: no crash, and
    // targetModificationObserved is only set true for genuinely unexpected
    // changes (git is unavailable in a plain tmp dir, so mutation evidence
    // is simply not comparable here — asserted via absence of a hard error).
    expect(result.errors).toHaveLength(0);
  });

  it("produces deterministic output across repeated runs", async () => {
    const targetRoot = makeTargetWithWrapper();
    const artifactRoot = fs.mkdtempSync(path.join(os.tmpdir(), "lint-artifacts-"));
    roots.push(artifactRoot);
    const writeFixture = () => writeFreshLintXml(targetRoot, "app/build/reports", issueXml("X", "Error", "msg", "app/src/main/java/Foo.java", 1));
    const first = await auditAndroidLint({ targetRoot, detection: detection(), executor: fakeExecutor(baseResult({ exitCode: 0 }), writeFixture), artifactRoot });
    const second = await auditAndroidLint({ targetRoot, detection: detection(), executor: fakeExecutor(baseResult({ exitCode: 0 }), writeFixture), artifactRoot });
    expect(first.findings).toEqual(second.findings);
    expect(first.status).toBe(second.status);
  });

  it("remains standalone: correct category and optional requirement level", async () => {
    const targetRoot = makeTargetWithWrapper();
    const artifactRoot = fs.mkdtempSync(path.join(os.tmpdir(), "lint-artifacts-"));
    roots.push(artifactRoot);
    const result = await auditAndroidLint({ targetRoot, detection: detection(), executor: fakeExecutor(baseResult({ exitCode: 0 })), artifactRoot });
    expect(result.category).toBe("android-lint");
    expect(result.requirementLevel).toBe("optional");
  });
});
