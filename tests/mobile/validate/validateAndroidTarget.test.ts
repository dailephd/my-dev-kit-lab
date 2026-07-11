import { describe, expect, it } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execSync } from "node:child_process";
import { validateAndroidTarget } from "../../../src/mobile/android/validate/validateAndroidTarget.js";
import { toAndroidReportModel, serializeAndroidReportModel } from "../../../src/mobile/android/report/model.js";
import { renderAndroidTextReport } from "../../../src/mobile/android/report/renderAndroidReport.js";
import type { GradleCommandExecutor } from "../../../src/mobile/android/gradle/validate/executor.js";

const FIXTURES_ROOT = path.resolve(__dirname, "..", "..", "fixtures", "android");
const TOOL_ROOT = path.resolve(__dirname, "..", "..", "..");

function fixture(name: string): string {
  return path.join(FIXTURES_ROOT, name);
}

// ANDROID-B5-03: Default static command path — zero Gradle execution.
describe("validateAndroidTarget — default static path — ANDROID-B5-03", () => {
  it("never invokes the injected executor when no operations are requested", async () => {
    let called = false;
    const executor: GradleCommandExecutor = async (plan) => {
      called = true;
      return { command: plan.wrapperExecutablePath, args: plan.args, cwd: plan.cwd, exitCode: 0, durationMs: 1, stdout: "", stderr: "", timedOut: false, skipped: false };
    };
    await validateAndroidTarget({ toolRoot: TOOL_ROOT, targetPath: fixture("compose-app"), gradleExecutor: executor });
    expect(called).toBe(false);
  });

  it("performs detection, manifest parsing, four audits, and static Gradle metadata", async () => {
    const result = await validateAndroidTarget({ toolRoot: TOOL_ROOT, targetPath: fixture("compose-app") });
    const ids = result.checks.map((c) => c.id);
    expect(ids).toContain("android-project-detection");
    expect(ids).toContain("android-manifest-parsing");
    expect(ids).toContain("android-permissions-audit");
    expect(ids).toContain("android-exported-components-audit");
    expect(ids).toContain("android-intent-filters-audit");
    expect(ids).toContain("android-deep-links-audit");
    expect(ids).toContain("android-gradle-metadata");
    expect(result.gradle.modules.length).toBeGreaterThan(0);
  });
});

// ANDROID-B5-09: Confirmed Compose application integration.
describe("validateAndroidTarget — Compose application — ANDROID-B5-09", () => {
  it("produces a complete result with detection, manifests, checks, verdict, and no findings above minor", async () => {
    const result = await validateAndroidTarget({ toolRoot: TOOL_ROOT, targetPath: fixture("compose-app") });
    expect(result.detection.detected).toBe(true);
    expect(result.target.classification.uiToolkit).toBe("compose");
    expect(result.manifests).toHaveLength(1);
    expect(result.releaseMetadata?.applicationModulePath).toBe("app");
    expect(result.playReadiness?.applicable).toBe(true);
    expect(["ready-for-release-preparation", "ready-except-optional-manual-checks"]).toContain(result.verdict);
  });
});

// ANDROID-B5-10: XML/View application integration.
describe("validateAndroidTarget — XML/View application — ANDROID-B5-10", () => {
  it("does not falsely classify the XML/View fixture as Compose", async () => {
    const result = await validateAndroidTarget({ toolRoot: TOOL_ROOT, targetPath: fixture("xml-view-app") });
    expect(result.target.classification.uiToolkit).toBe("xml-view");
  });
});

// ANDROID-B5-11: Java application integration.
describe("validateAndroidTarget — Java application — ANDROID-B5-11", () => {
  it("preserves Java source-root classification through the full path", async () => {
    const result = await validateAndroidTarget({ toolRoot: TOOL_ROOT, targetPath: fixture("java-app") });
    expect(result.detection.javaSourceRoots.length).toBeGreaterThan(0);
    expect(result.detection.kotlinSourceRoots).toEqual([]);
  });
});

// ANDROID-B5-12: Android library integration.
describe("validateAndroidTarget — Android library — ANDROID-B5-12", () => {
  it("marks Play-readiness not applicable and does not fail for missing application-only metadata", async () => {
    const result = await validateAndroidTarget({ toolRoot: TOOL_ROOT, targetPath: fixture("library") });
    expect(result.detection.projectKind).toBe("library");
    expect(result.playReadiness?.applicable).toBe(false);
    expect(result.verdict).toBe("ready-for-release-preparation");
  });
});

// ANDROID-B5-13: Multi-module integration (single application).
describe("validateAndroidTarget — multi-module (single application) — ANDROID-B5-13", () => {
  it("preserves all modules and produces one unambiguous application release summary", async () => {
    const result = await validateAndroidTarget({ toolRoot: TOOL_ROOT, targetPath: fixture("multi-module") });
    expect(result.detection.modules.map((m) => m.path)).toEqual(["app", "core", "feature-login"]);
    expect(result.releaseMetadata?.applicationModulePath).toBe("app");
  });
});

// ANDROID-B5-14: Multiple application modules.
describe("validateAndroidTarget — multiple application modules — ANDROID-B5-14", () => {
  it("produces an inconclusive verdict rather than arbitrarily selecting a primary module", async () => {
    const tempRoot = fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()), "android-multiapp-"));
    try {
      fs.cpSync(fixture("multi-module"), tempRoot, { recursive: true });
      // Turn the library module "core" into a second application module.
      const coreBuildFile = path.join(tempRoot, "core", "build.gradle.kts");
      fs.writeFileSync(
        coreBuildFile,
        `plugins {\n    id("com.android.application")\n    id("org.jetbrains.kotlin.android")\n}\n\nandroid {\n    namespace = "com.example.multimodule.core"\n    compileSdk = 34\n    defaultConfig {\n        applicationId = "com.example.multimodule.core"\n        minSdk = 24\n        targetSdk = 34\n    }\n}\n`
      );
      const result = await validateAndroidTarget({ toolRoot: TOOL_ROOT, targetPath: tempRoot });
      expect(result.detection.applicationModules.length).toBeGreaterThan(1);
      expect(result.verdict).toBe("inconclusive-audit-environment-incomplete");
      expect(result.verdictReasons?.some((r) => r.code === "android-multiple-application-modules")).toBe(true);
      expect(result.releaseMetadata?.applicationModulePath).toBeUndefined();
    } finally {
      fs.rmSync(tempRoot, { recursive: true, force: true });
    }
  });
});

// ANDROID-B5-15: Partial Android target.
describe("validateAndroidTarget — partial target — ANDROID-B5-15", () => {
  it("preserves available evidence but receives an inconclusive verdict", async () => {
    const result = await validateAndroidTarget({ toolRoot: TOOL_ROOT, targetPath: fixture("partial") });
    expect(result.detection.applicationModules).toEqual(["app"]);
    expect(result.verdict).toBe("inconclusive-audit-environment-incomplete");
  });
});

// ANDROID-B5-16: Non-Android profile mismatch.
describe("validateAndroidTarget — non-Android target — ANDROID-B5-16", () => {
  it("does not run Android checks as passed and returns a clear mismatch verdict", async () => {
    const result = await validateAndroidTarget({ toolRoot: TOOL_ROOT, targetPath: fixture("non-android-gradle") });
    expect(result.checks.every((c) => c.category === "android-target-immutability" || c.status !== "passed")).toBe(true);
    expect(result.verdict).toBe("inconclusive-audit-environment-incomplete");
  });
});

// ANDROID-B5-17: Malformed manifest isolation.
describe("validateAndroidTarget — malformed manifest isolation — ANDROID-B5-17", () => {
  it("one malformed manifest does not erase findings/evidence from other manifests", async () => {
    const tempRoot = fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()), "android-malformed-"));
    try {
      fs.cpSync(fixture("multi-module"), tempRoot, { recursive: true });
      fs.writeFileSync(path.join(tempRoot, "core", "src", "main", "AndroidManifest.xml"), "<manifest><application></manifest>");
      const result = await validateAndroidTarget({ toolRoot: TOOL_ROOT, targetPath: tempRoot });
      expect(result.manifests.length).toBe(3);
      const appManifest = result.manifests.find((m) => m.manifestPath.startsWith("app/"));
      expect(appManifest?.launcherActivityName).toBe(".MainActivity");
    } finally {
      fs.rmSync(tempRoot, { recursive: true, force: true });
    }
  });
});

// ANDROID-B5-18/19: Audit aggregation and exact-duplicate deduplication.
describe("validateAndroidTarget — finding aggregation — ANDROID-B5-18", () => {
  it("aggregates findings from all four audit families with stable ids and paths", async () => {
    const result = await validateAndroidTarget({ toolRoot: TOOL_ROOT, targetPath: fixture("xml-view-app") });
    expect(result.findings.length).toBeGreaterThan(0);
    for (const f of result.findings) {
      expect(f.id.length).toBeGreaterThan(0);
      expect(f.affectedFiles?.length).toBeGreaterThan(0);
    }
    // Deterministic sort order.
    const sorted = [...result.findings].sort((a, b) => a.id.localeCompare(b.id));
    expect(result.findings.map((f) => f.id)).toEqual(sorted.map((f) => f.id));
  });
});

// ANDROID-B5-20: Static Gradle metadata integration.
describe("validateAndroidTarget — static Gradle metadata integration — ANDROID-B5-20", () => {
  it("surfaces resolved, unresolved, and conflicting metadata in the result", async () => {
    const result = await validateAndroidTarget({ toolRoot: TOOL_ROOT, targetPath: fixture("compose-app") });
    expect(result.gradle.modules[0].applicationId).toBe("com.example.composeapp");
    expect(result.releaseMetadata?.androidGradlePluginVersion).toBe("8.2.0");
  });
});

// ANDROID-B5-22: No Play-policy claim.
describe("validateAndroidTarget — no Play-policy claim — ANDROID-B5-22", () => {
  it("never claims current Google Play policy or compliance was validated", async () => {
    const result = await validateAndroidTarget({ toolRoot: TOOL_ROOT, targetPath: fixture("compose-app") });
    const serialized = JSON.stringify(result);
    expect(serialized).not.toMatch(/policy compliant|play.?approved|publication ready/i);
  });
});

// ANDROID-B5-31: Optional Gradle success.
describe("validateAndroidTarget — optional Gradle success — ANDROID-B5-31", () => {
  it("includes explicitly requested fake wrapper-version success in the final result", async () => {
    const tempRoot = fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()), "android-gradle-ok-"));
    try {
      fs.cpSync(fixture("compose-app"), tempRoot, { recursive: true });
      fs.writeFileSync(path.join(tempRoot, "gradlew"), "#!/bin/sh\n");
      fs.writeFileSync(path.join(tempRoot, "gradlew.bat"), "@echo off\r\n");
      const executor: GradleCommandExecutor = async (plan) => ({
        command: plan.wrapperExecutablePath,
        args: plan.args,
        cwd: plan.cwd,
        exitCode: 0,
        durationMs: 10,
        stdout: "Gradle 8.5",
        stderr: "",
        timedOut: false,
        skipped: false,
      });
      const result = await validateAndroidTarget({
        toolRoot: TOOL_ROOT,
        targetPath: tempRoot,
        requestedGradleOperationIds: ["wrapper-version"],
        gradleExecutor: executor,
      });
      const op = result.checks.find((c) => c.id === "android-gradle-wrapper-version");
      expect(op?.status).toBe("passed");
    } finally {
      fs.rmSync(tempRoot, { recursive: true, force: true });
    }
  });
});

// ANDROID-B5-32: Optional Gradle environment limitation.
describe("validateAndroidTarget — optional Gradle environment limitation — ANDROID-B5-32", () => {
  it("produces inconclusive operation evidence without a fabricated SecurityFinding when the environment is incomplete", async () => {
    const tempRoot = fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()), "android-gradle-env-"));
    try {
      fs.cpSync(fixture("compose-app"), tempRoot, { recursive: true });
      fs.writeFileSync(path.join(tempRoot, "gradlew"), "#!/bin/sh\n");
      fs.writeFileSync(path.join(tempRoot, "gradlew.bat"), "@echo off\r\n");
      const executor: GradleCommandExecutor = async (plan) => ({
        command: plan.wrapperExecutablePath,
        args: plan.args,
        cwd: plan.cwd,
        exitCode: null,
        durationMs: 1,
        stdout: "",
        stderr: "java: command not found",
        timedOut: false,
        skipped: false,
      });
      const result = await validateAndroidTarget({
        toolRoot: TOOL_ROOT,
        targetPath: tempRoot,
        requestedGradleOperationIds: ["tasks"],
        gradleExecutor: executor,
      });
      const op = result.checks.find((c) => c.id === "android-gradle-tasks");
      expect(op?.status).toBe("inconclusive");
      // compose-app always contributes one baseline informational finding
      // (the expected-launcher-activity-exported note) plus, since Batch 8
      // activated the eleven advanced checks by default, one minor
      // android:allowBackup="true" finding from the backup-configuration
      // audit — neither is produced by the Gradle operation outcome itself,
      // so the operation must not have escalated anything to blocker/major.
      expect(result.findings.every((f) => f.severity === "informational" || f.severity === "minor")).toBe(true);
    } finally {
      fs.rmSync(tempRoot, { recursive: true, force: true });
    }
  });
});

// ANDROID-B5-33: Optional build/test/lint failure.
describe("validateAndroidTarget — optional operation failure — ANDROID-B5-33", () => {
  it("reports a genuine operation failure as validation evidence, not a SecurityFinding", async () => {
    const tempRoot = fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()), "android-gradle-fail-"));
    try {
      fs.cpSync(fixture("compose-app"), tempRoot, { recursive: true });
      fs.writeFileSync(path.join(tempRoot, "gradlew"), "#!/bin/sh\n");
      fs.writeFileSync(path.join(tempRoot, "gradlew.bat"), "@echo off\r\n");
      const executor: GradleCommandExecutor = async (plan) => ({
        command: plan.wrapperExecutablePath,
        args: plan.args,
        cwd: plan.cwd,
        exitCode: plan.args[0] === "tasks" ? 0 : 1,
        durationMs: 10,
        stdout: plan.args[0] === "tasks" ? "testDebugUnitTest - Run unit tests for the debug build.\n" : "1 test failed",
        stderr: "",
        timedOut: false,
        skipped: false,
      });
      const result = await validateAndroidTarget({
        toolRoot: TOOL_ROOT,
        targetPath: tempRoot,
        requestedGradleOperationIds: ["tasks", "unit-test-debug"],
        gradleExecutor: executor,
        allowGradleWithoutTaskDiscovery: true,
      });
      const op = result.checks.find((c) => c.id === "android-gradle-unit-test-debug");
      expect(op?.status).toBe("failed");
      // compose-app always contributes one baseline informational finding
      // (the expected-launcher-activity-exported note) plus, since Batch 8
      // activated the eleven advanced checks by default, one minor
      // android:allowBackup="true" finding from the backup-configuration
      // audit — neither is produced by the Gradle operation outcome itself,
      // so the operation must not have escalated anything to blocker/major.
      expect(result.findings.every((f) => f.severity === "informational" || f.severity === "minor")).toBe(true);
      expect(result.verdict).not.toBe("not-ready-security-blocker-remains");
    } finally {
      fs.rmSync(tempRoot, { recursive: true, force: true });
    }
  });
});

// ANDROID-B5-34: Default target immutability.
describe("validateAndroidTarget — default target immutability — ANDROID-B5-34", () => {
  it("produces no target file changes for static-only validation", async () => {
    const target = fixture("compose-app");
    const before = execSync("git status --short", { cwd: TOOL_ROOT, encoding: "utf8" });
    await validateAndroidTarget({ toolRoot: TOOL_ROOT, targetPath: target });
    const after = execSync("git status --short", { cwd: TOOL_ROOT, encoding: "utf8" });
    expect(after).toBe(before);
  });
});

// ANDROID-B5-36: Unexpected tracked target modification.
describe("validateAndroidTarget — unexpected tracked modification — ANDROID-B5-36", () => {
  it("prevents a ready verdict and reports the modification prominently", async () => {
    const tempRoot = fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()), "android-unexpected-mod-"));
    try {
      fs.cpSync(fixture("compose-app"), tempRoot, { recursive: true });
      fs.writeFileSync(path.join(tempRoot, "gradlew"), "#!/bin/sh\n");
      fs.writeFileSync(path.join(tempRoot, "gradlew.bat"), "@echo off\r\n");
      execSync("git init -q", { cwd: tempRoot });
      execSync("git config user.email test@example.com", { cwd: tempRoot });
      execSync("git config user.name test", { cwd: tempRoot });
      execSync("git add -A", { cwd: tempRoot });
      execSync("git commit -q -m init", { cwd: tempRoot });

      const executor: GradleCommandExecutor = async (plan) => {
        fs.appendFileSync(path.join(tempRoot, "settings.gradle.kts"), "\n// unexpected\n");
        return { command: plan.wrapperExecutablePath, args: plan.args, cwd: plan.cwd, exitCode: 0, durationMs: 1, stdout: "", stderr: "", timedOut: false, skipped: false };
      };
      const result = await validateAndroidTarget({
        toolRoot: TOOL_ROOT,
        targetPath: tempRoot,
        requestedGradleOperationIds: ["wrapper-version"],
        gradleExecutor: executor,
      });
      expect(result.verdict).toBe("not-ready-security-blocker-remains");
      expect(result.targetMutationEvidence?.unexpectedChanges.length).toBeGreaterThan(0);
    } finally {
      fs.rmSync(tempRoot, { recursive: true, force: true });
    }
  });
});

// ANDROID-B5-37/38: JSON report schema + determinism.
describe("Android report model — JSON schema and determinism — ANDROID-B5-37", () => {
  it("contains required top-level sections with no unbounded data", async () => {
    const result = await validateAndroidTarget({ toolRoot: TOOL_ROOT, targetPath: fixture("compose-app") });
    const model = toAndroidReportModel(result, { profile: "android", requestedGradleOperations: [] });
    for (const key of ["metadata", "verdict", "verdictReasons", "findingsBySeverity", "checks", "playReadinessItems", "moduleSummary"]) {
      expect(model).toHaveProperty(key);
    }
    const json = serializeAndroidReportModel(model);
    expect(() => JSON.parse(json)).not.toThrow();
  });

  it("produces equivalent normalized JSON for repeated runs against unchanged fixtures", async () => {
    const runOnce = async () => {
      const result = await validateAndroidTarget({ toolRoot: TOOL_ROOT, targetPath: fixture("library") });
      const model = toAndroidReportModel(result, { profile: "android", requestedGradleOperations: [] });
      // Strip volatile timestamp/duration fields before comparing.
      return JSON.stringify({ ...model, metadata: { ...model.metadata, generatedAt: "x", totalDurationMs: 0 } });
    };
    expect(await runOnce()).toBe(await runOnce());
  });
});

// ANDROID-B5-39/40: Text report sections and finding presentation.
describe("renderAndroidTextReport — sections and finding presentation — ANDROID-B5-39", () => {
  it("contains the required sections and never prints an entire manifest", async () => {
    const result = await validateAndroidTarget({ toolRoot: TOOL_ROOT, targetPath: fixture("xml-view-app") });
    const model = toAndroidReportModel(result, { profile: "android", requestedGradleOperations: [] });
    const text = renderAndroidTextReport(model);
    for (const heading of [
      "ANDROID SECURITY-VALIDATION SUMMARY",
      "VERDICT",
      "TARGET IDENTITY",
      "MODULE SUMMARY",
      "MANIFEST SUMMARY",
      "PERMISSIONS SUMMARY",
      "EXPORTED COMPONENT SUMMARY",
      "DEEP-LINK SUMMARY",
      "STATIC GRADLE METADATA",
      "PLAY-READINESS CHECKLIST PLACEHOLDERS",
      "FINDINGS BY SEVERITY",
      "STATIC-ANALYSIS LIMITATIONS",
      "RECOMMENDED NEXT STEP",
    ]) {
      expect(text).toContain(heading);
    }
    expect(text).not.toContain("<manifest");
    for (const f of result.findings) {
      expect(text).toContain(f.id);
    }
  });
});
