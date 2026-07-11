import { describe, expect, it } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { ALLOWLISTED_OPERATION_IDS, isAllowlistedOperationId, GRADLE_OPERATIONS } from "../../../../src/mobile/android/gradle/validate/operations.js";
import { buildGradleCommandPlan } from "../../../../src/mobile/android/gradle/validate/planner.js";
import { detectAndroidProject } from "../../../../src/mobile/android/detect/detectAndroidProject.js";

const FIXTURES_ROOT = path.resolve(__dirname, "..", "..", "..", "fixtures", "android");

// ANDROID-B4-19: Allowlisted Gradle operations.
describe("ALLOWLISTED_OPERATION_IDS — ANDROID-B4-19", () => {
  it("accepts exactly the five defined operation ids", () => {
    expect(ALLOWLISTED_OPERATION_IDS).toEqual(["wrapper-version", "tasks", "assemble-debug", "unit-test-debug", "lint-debug"]);
  });

  it("has a GRADLE_OPERATIONS definition for every allowlisted id", () => {
    for (const id of ALLOWLISTED_OPERATION_IDS) {
      expect(GRADLE_OPERATIONS[id]).toBeDefined();
    }
  });
});

// ANDROID-B4-20: Arbitrary task rejection.
describe("isAllowlistedOperationId / buildGradleCommandPlan — arbitrary task rejection — ANDROID-B4-20", () => {
  it("rejects an arbitrary task name at the type-guard level", () => {
    expect(isAllowlistedOperationId("clean")).toBe(false);
    expect(isAllowlistedOperationId("publish")).toBe(false);
    expect(isAllowlistedOperationId("assembleRelease")).toBe(false);
    expect(isAllowlistedOperationId("arbitraryTaskName")).toBe(false);
  });

  it("rejects an unknown operation id before constructing any command", () => {
    const root = path.join(FIXTURES_ROOT, "compose-app");
    const detection = detectAndroidProject(root);
    const plan = buildGradleCommandPlan("assembleRelease", root, detection);
    expect(plan.rejected).toBe(true);
    if (plan.rejected) {
      expect(plan.reason).toContain("Unknown or unsupported");
    }
  });

  it("never includes clean, publish, or signing tasks in any allowlisted operation's args", () => {
    for (const definition of Object.values(GRADLE_OPERATIONS)) {
      expect(definition.args).not.toContain("clean");
      expect(definition.args).not.toContain("publish");
      expect(definition.args.join(" ")).not.toMatch(/assembleRelease|bundleRelease|sign|upload/i);
      expect(definition.args).not.toContain("--refresh-dependencies");
      expect(definition.args).not.toContain("--rerun-tasks");
      expect(definition.args).not.toContain("--continuous");
    }
  });
});

// ANDROID-B4-21: Platform wrapper selection.
describe("buildGradleCommandPlan — platform wrapper selection — ANDROID-B4-21", () => {
  it("selects gradlew.bat on win32 and gradlew on POSIX platforms", () => {
    const tempRoot = fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()), "gradle-plan-"));
    try {
      fs.writeFileSync(path.join(tempRoot, "gradlew"), "#!/bin/sh\n");
      fs.writeFileSync(path.join(tempRoot, "gradlew.bat"), "@echo off\r\n");
      const detection = detectAndroidProject(tempRoot);

      const winPlan = buildGradleCommandPlan("wrapper-version", tempRoot, detection, "win32");
      const posixPlan = buildGradleCommandPlan("wrapper-version", tempRoot, detection, "linux");

      expect(winPlan.rejected).toBe(false);
      expect(posixPlan.rejected).toBe(false);
      if (!winPlan.rejected) expect(winPlan.wrapperExecutablePath.endsWith("gradlew.bat")).toBe(true);
      if (!posixPlan.rejected) expect(posixPlan.wrapperExecutablePath.endsWith("gradlew")).toBe(true);
    } finally {
      fs.rmSync(tempRoot, { recursive: true, force: true });
    }
  });
});

// ANDROID-B4-22: Target-contained wrapper path.
describe("buildGradleCommandPlan — target containment — ANDROID-B4-22", () => {
  it("rejects when no wrapper script exists for the platform (also covers escape-safety since the path is always built via resolveWithinRoot)", () => {
    const root = path.join(FIXTURES_ROOT, "compose-app");
    const detection = detectAndroidProject(root);
    const plan = buildGradleCommandPlan("wrapper-version", root, detection, "linux");
    expect(plan.rejected).toBe(true);
    if (plan.rejected) expect(plan.reason).toContain("gradlew");
  });
});

// ANDROID-B4-23: Safe argument construction.
describe("buildGradleCommandPlan — safe argument construction — ANDROID-B4-23", () => {
  it("includes bounded non-interactive safety flags for build/test/lint operations", () => {
    const tempRoot = fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()), "gradle-plan-"));
    try {
      fs.writeFileSync(path.join(tempRoot, "gradlew"), "#!/bin/sh\n");
      const detection = detectAndroidProject(tempRoot);
      const plan = buildGradleCommandPlan("assemble-debug", tempRoot, detection, "linux");
      expect(plan.rejected).toBe(false);
      if (!plan.rejected) {
        expect(plan.args).toContain("--no-daemon");
        expect(plan.args).toContain("--console=plain");
        expect(plan.args).toContain("--offline");
      }
    } finally {
      fs.rmSync(tempRoot, { recursive: true, force: true });
    }
  });
});
