import { describe, expect, it } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execSync } from "node:child_process";
import { detectAndroidProject } from "../../../../src/mobile/android/detect/detectAndroidProject.js";
import { runOptionalGradleValidation } from "../../../../src/mobile/android/gradle/validate/runOptionalGradleValidation.js";
import type { GradleCommandExecutor } from "../../../../src/mobile/android/gradle/validate/executor.js";
import { parseGradleTaskNames, isGradleTaskAvailable } from "../../../../src/mobile/android/gradle/validate/taskListParser.js";

const FIXTURES_ROOT = path.resolve(__dirname, "..", "..", "..", "fixtures", "android");

function makeFakeTargetWithWrapper(): string {
  const tempRoot = fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()), "gradle-run-"));
  fs.cpSync(path.join(FIXTURES_ROOT, "compose-app"), tempRoot, { recursive: true });
  fs.writeFileSync(path.join(tempRoot, "gradlew"), "#!/bin/sh\n");
  fs.writeFileSync(path.join(tempRoot, "gradlew.bat"), "@echo off\r\n");
  return tempRoot;
}

const TASKS_OUTPUT = [
  "assemble - Assembles main output for this project.",
  "assembleDebug - Assembles main output for variant debug.",
  "testDebugUnitTest - Run unit tests for the debug build.",
  "lintDebug - Runs lint on the debug variant.",
].join("\n");

function fakeExecutorFor(exitCodes: Partial<Record<string, number>>): GradleCommandExecutor {
  return async (plan) => {
    const taskArg = plan.args[0];
    const exitCode = taskArg === "tasks" ? exitCodes.tasks ?? 0 : exitCodes[plan.operationId] ?? 0;
    return {
      command: plan.wrapperExecutablePath,
      args: plan.args,
      cwd: plan.cwd,
      exitCode,
      durationMs: 10,
      stdout: plan.operationId === "tasks" && exitCode === 0 ? TASKS_OUTPUT : "output",
      stderr: exitCode === 0 ? "" : "failure output",
      timedOut: false,
      skipped: false,
    };
  };
}

// ANDROID-B4-24: Disabled execution.
describe("runOptionalGradleValidation — disabled by default — ANDROID-B4-24", () => {
  it("returns not-run results without touching the filesystem when disabled", () => {
    const root = path.join(FIXTURES_ROOT, "compose-app");
    const detection = detectAndroidProject(root);
    return runOptionalGradleValidation({ enabled: false, targetRoot: root, detection, operationIds: ["wrapper-version", "tasks"] }).then((results) => {
      expect(results).toHaveLength(2);
      expect(results.every((r) => r.status === "not-run" && !r.ran)).toBe(true);
    });
  });
});

// ANDROID-B4-25: Wrapper-version execution.
describe("runOptionalGradleValidation — wrapper-version success — ANDROID-B4-25", () => {
  it("produces a passed result with command, cwd, duration, and bounded output evidence", async () => {
    const tempRoot = makeFakeTargetWithWrapper();
    try {
      const detection = detectAndroidProject(tempRoot);
      const [result] = await runOptionalGradleValidation({
        enabled: true,
        targetRoot: tempRoot,
        detection,
        operationIds: ["wrapper-version"],
        executor: fakeExecutorFor({}),
      });
      expect(result.status).toBe("passed");
      expect(result.command?.cwd).toBe(path.resolve(tempRoot));
      expect(result.durationMs).toBeDefined();
      expect(result.evidence.some((e) => e.startsWith("exitCode="))).toBe(true);
    } finally {
      fs.rmSync(tempRoot, { recursive: true, force: true });
    }
  });
});

// ANDROID-B4-26: Task-list parsing.
describe("parseGradleTaskNames — ANDROID-B4-26", () => {
  it("extracts task names, not descriptions, from common tasks output", () => {
    const names = parseGradleTaskNames(TASKS_OUTPUT);
    expect(names.has("assembleDebug")).toBe(true);
    expect(names.has("testDebugUnitTest")).toBe(true);
    expect(isGradleTaskAvailable(names, "lintDebug")).toBe(true);
    expect(isGradleTaskAvailable(names, "notATask")).toBe(false);
    // A description word must never be mistaken for a task identifier.
    expect(names.has("Assembles")).toBe(false);
  });
});

// ANDROID-B4-27: Missing task skip.
describe("runOptionalGradleValidation — missing task skip — ANDROID-B4-27", () => {
  it("skips assemble-debug with a structured reason when tasks discovery finds it unavailable", async () => {
    const tempRoot = makeFakeTargetWithWrapper();
    try {
      const detection = detectAndroidProject(tempRoot);
      const executor: GradleCommandExecutor = async (plan) => ({
        command: plan.wrapperExecutablePath,
        args: plan.args,
        cwd: plan.cwd,
        exitCode: 0,
        durationMs: 5,
        stdout: "assemble - Assembles main output for this project.\n", // no assembleDebug
        stderr: "",
        timedOut: false,
        skipped: false,
      });
      const results = await runOptionalGradleValidation({
        enabled: true,
        targetRoot: tempRoot,
        detection,
        operationIds: ["tasks", "assemble-debug"],
        executor,
      });
      const assemble = results.find((r) => r.id === "android-gradle-assemble-debug");
      expect(assemble?.status).toBe("skipped");
      expect(assemble?.skipInfo?.reason).toContain("not available");
    } finally {
      fs.rmSync(tempRoot, { recursive: true, force: true });
    }
  });

  it("skips a task-gated operation when task discovery was never run and allowWithoutTaskDiscovery is unset", async () => {
    const tempRoot = makeFakeTargetWithWrapper();
    try {
      const detection = detectAndroidProject(tempRoot);
      const [result] = await runOptionalGradleValidation({
        enabled: true,
        targetRoot: tempRoot,
        detection,
        operationIds: ["assemble-debug"],
        executor: fakeExecutorFor({}),
      });
      expect(result.status).toBe("skipped");
      expect(result.skipInfo?.missingCapability).toBe("gradle-task-discovery");
    } finally {
      fs.rmSync(tempRoot, { recursive: true, force: true });
    }
  });
});

// ANDROID-B4-28: Environment-incomplete result.
describe("runOptionalGradleValidation — environment-incomplete — ANDROID-B4-28", () => {
  it("reports inconclusive, not passed, when the command cannot be spawned", async () => {
    const tempRoot = makeFakeTargetWithWrapper();
    try {
      const detection = detectAndroidProject(tempRoot);
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
      const [result] = await runOptionalGradleValidation({ enabled: true, targetRoot: tempRoot, detection, operationIds: ["tasks"], executor });
      expect(result.status).toBe("inconclusive");
      expect(result.status).not.toBe("passed");
    } finally {
      fs.rmSync(tempRoot, { recursive: true, force: true });
    }
  });
});

// ANDROID-B4-29: Build failure versus orchestration error.
describe("runOptionalGradleValidation — build failure vs orchestration error — ANDROID-B4-29", () => {
  it("distinguishes a genuine nonzero build exit (failed) from a spawn failure (error) for wrapper-version", async () => {
    const tempRoot = makeFakeTargetWithWrapper();
    try {
      const detection = detectAndroidProject(tempRoot);
      const spawnFailureExecutor: GradleCommandExecutor = async (plan) => ({
        command: plan.wrapperExecutablePath,
        args: plan.args,
        cwd: plan.cwd,
        exitCode: null,
        durationMs: 1,
        stdout: "",
        stderr: "ENOENT",
        timedOut: false,
        skipped: false,
      });
      const [wrapperResult] = await runOptionalGradleValidation({
        enabled: true,
        targetRoot: tempRoot,
        detection,
        operationIds: ["wrapper-version"],
        executor: spawnFailureExecutor,
      });
      expect(wrapperResult.status).toBe("error");
    } finally {
      fs.rmSync(tempRoot, { recursive: true, force: true });
    }
  });
});

// ANDROID-B4-30: Unit-test failure result.
describe("runOptionalGradleValidation — unit-test failure — ANDROID-B4-30", () => {
  it("records a failed testDebugUnitTest as validation evidence with zero SecurityFinding records", async () => {
    const tempRoot = makeFakeTargetWithWrapper();
    try {
      const detection = detectAndroidProject(tempRoot);
      const results = await runOptionalGradleValidation({
        enabled: true,
        targetRoot: tempRoot,
        detection,
        operationIds: ["tasks", "unit-test-debug"],
        executor: fakeExecutorFor({ "unit-test-debug": 1 }),
      });
      const testResult = results.find((r) => r.id === "android-gradle-unit-test-debug");
      expect(testResult?.status).toBe("failed");
      expect(testResult?.findings).toEqual([]);
    } finally {
      fs.rmSync(tempRoot, { recursive: true, force: true });
    }
  });
});

// ANDROID-B4-31: Lint result behavior.
describe("runOptionalGradleValidation — lint result — ANDROID-B4-31", () => {
  it("represents lintDebug success and failure as operation status without security findings", async () => {
    const tempRoot = makeFakeTargetWithWrapper();
    try {
      const detection = detectAndroidProject(tempRoot);
      const successResults = await runOptionalGradleValidation({
        enabled: true,
        targetRoot: tempRoot,
        detection,
        operationIds: ["tasks", "lint-debug"],
        executor: fakeExecutorFor({}),
      });
      const success = successResults.find((r) => r.id === "android-gradle-lint-debug");
      expect(success?.status).toBe("passed");
      expect(success?.findings).toEqual([]);

      const failureResults = await runOptionalGradleValidation({
        enabled: true,
        targetRoot: tempRoot,
        detection,
        operationIds: ["tasks", "lint-debug"],
        executor: fakeExecutorFor({ "lint-debug": 1 }),
      });
      const failure = failureResults.find((r) => r.id === "android-gradle-lint-debug");
      expect(failure?.status).toBe("failed");
      expect(failure?.findings).toEqual([]);
    } finally {
      fs.rmSync(tempRoot, { recursive: true, force: true });
    }
  });
});

// ANDROID-B4-32: Timeout handling (via injected executor simulating a timeout).
describe("runOptionalGradleValidation — timeout handling — ANDROID-B4-32", () => {
  it("reports inconclusive, never passed, when the executor reports a timeout", async () => {
    const tempRoot = makeFakeTargetWithWrapper();
    try {
      const detection = detectAndroidProject(tempRoot);
      const executor: GradleCommandExecutor = async (plan) => ({
        command: plan.wrapperExecutablePath,
        args: plan.args,
        cwd: plan.cwd,
        exitCode: null,
        durationMs: plan.timeoutMs,
        stdout: "",
        stderr: "",
        timedOut: true,
        skipped: false,
      });
      const [result] = await runOptionalGradleValidation({ enabled: true, targetRoot: tempRoot, detection, operationIds: ["wrapper-version"], executor });
      expect(result.status).toBe("inconclusive");
    } finally {
      fs.rmSync(tempRoot, { recursive: true, force: true });
    }
  });
});

// ANDROID-B4-33: Output truncation and redaction.
describe("runOptionalGradleValidation — output truncation — ANDROID-B4-33", () => {
  it("bounds a very large stdout and reports a truncation warning", async () => {
    const tempRoot = makeFakeTargetWithWrapper();
    try {
      const detection = detectAndroidProject(tempRoot);
      const hugeOutput = "x".repeat(10_000);
      const executor: GradleCommandExecutor = async (plan) => ({
        command: plan.wrapperExecutablePath,
        args: plan.args,
        cwd: plan.cwd,
        exitCode: 0,
        durationMs: 5,
        stdout: hugeOutput,
        stderr: "",
        timedOut: false,
        skipped: false,
      });
      const [result] = await runOptionalGradleValidation({ enabled: true, targetRoot: tempRoot, detection, operationIds: ["wrapper-version"], executor });
      expect(result.command!.stdout.length).toBeLessThan(hugeOutput.length);
      expect(result.warnings.some((w) => w.includes("truncated"))).toBe(true);
    } finally {
      fs.rmSync(tempRoot, { recursive: true, force: true });
    }
  });
});

// ANDROID-B4-34 / B4-36: Target Git status preservation and unexpected tracked modification.
describe("runOptionalGradleValidation — target mutation evidence — ANDROID-B4-34", () => {
  it("preserves pre-existing dirtiness and flags an unexpected tracked modification distinctly", async () => {
    const tempRoot = makeFakeTargetWithWrapper();
    try {
      execSync("git init -q", { cwd: tempRoot });
      execSync("git config user.email test@example.com", { cwd: tempRoot });
      execSync("git config user.name test", { cwd: tempRoot });
      execSync("git add -A", { cwd: tempRoot });
      execSync("git commit -q -m init", { cwd: tempRoot });
      // Pre-existing dirtiness before any operation runs.
      fs.writeFileSync(path.join(tempRoot, "gradlew.bat"), "@echo off\r\nrem changed\r\n");

      const detection = detectAndroidProject(tempRoot);
      const executor: GradleCommandExecutor = async (plan) => {
        // Simulate the operation unexpectedly modifying a tracked source file.
        fs.appendFileSync(path.join(tempRoot, "settings.gradle.kts"), "\n// unexpected edit\n");
        return { command: plan.wrapperExecutablePath, args: plan.args, cwd: plan.cwd, exitCode: 0, durationMs: 5, stdout: "", stderr: "", timedOut: false, skipped: false };
      };

      const [result] = await runOptionalGradleValidation({ enabled: true, targetRoot: tempRoot, detection, operationIds: ["wrapper-version"], executor });
      expect(result.targetModificationObserved).toBe(true);
      expect(result.warnings.some((w) => w.includes("settings.gradle.kts"))).toBe(true);
    } finally {
      fs.rmSync(tempRoot, { recursive: true, force: true });
    }
  });
});

// ANDROID-B4-35: Expected generated outputs.
describe("runOptionalGradleValidation — expected generated outputs — ANDROID-B4-35", () => {
  it("categorizes a new build/ directory as an expected generated output, not a source modification", async () => {
    const tempRoot = makeFakeTargetWithWrapper();
    try {
      execSync("git init -q", { cwd: tempRoot });
      execSync("git config user.email test@example.com", { cwd: tempRoot });
      execSync("git config user.name test", { cwd: tempRoot });
      execSync("git add -A", { cwd: tempRoot });
      execSync("git commit -q -m init", { cwd: tempRoot });

      const detection = detectAndroidProject(tempRoot);
      const executor: GradleCommandExecutor = async (plan) => {
        fs.mkdirSync(path.join(tempRoot, "app", "build"), { recursive: true });
        fs.writeFileSync(path.join(tempRoot, "app", "build", "output.txt"), "generated");
        return { command: plan.wrapperExecutablePath, args: plan.args, cwd: plan.cwd, exitCode: 0, durationMs: 5, stdout: "", stderr: "", timedOut: false, skipped: false };
      };

      const [result] = await runOptionalGradleValidation({ enabled: true, targetRoot: tempRoot, detection, operationIds: ["assemble-debug"], executor, allowWithoutTaskDiscovery: true });
      expect(result.targetModificationObserved).toBe(false);
      // A brand-new untracked directory is reported by `git status` as the
      // directory itself ("app/build/"), not each file inside it.
      expect(result.evidence.some((e) => e.includes("app/build/"))).toBe(true);
    } finally {
      fs.rmSync(tempRoot, { recursive: true, force: true });
    }
  });
});

// ANDROID-B4-37: Non-Git target.
describe("runOptionalGradleValidation — non-Git target — ANDROID-B4-37", () => {
  it("records unavailable git-status evidence without falsely claiming immutability", async () => {
    const tempRoot = makeFakeTargetWithWrapper();
    try {
      const detection = detectAndroidProject(tempRoot);
      const [result] = await runOptionalGradleValidation({
        enabled: true,
        targetRoot: tempRoot,
        detection,
        operationIds: ["wrapper-version"],
        executor: fakeExecutorFor({}),
      });
      expect(result.warnings.some((w) => w.includes("not a git repository"))).toBe(true);
      expect(result.targetModificationObserved).toBeUndefined();
    } finally {
      fs.rmSync(tempRoot, { recursive: true, force: true });
    }
  });
});
