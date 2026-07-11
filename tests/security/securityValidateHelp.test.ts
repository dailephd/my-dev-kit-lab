import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { resolveCommand } from "../../src/core/resolveCommand.js";

const toolRoot = process.cwd();
const cleanupRoots: string[] = [];

afterEach(() => {
  for (const root of cleanupRoots.splice(0)) {
    rmSync(root, { recursive: true, force: true });
  }
});

function runValidateCli(args: string[]): { stdout: string; stderr: string; status: number } {
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
    return { stdout, stderr: "", status: 0 };
  } catch (err) {
    const error = err as { stdout?: string; stderr?: string; status?: number };
    return { stdout: error.stdout ?? "", stderr: error.stderr ?? "", status: error.status ?? 1 };
  }
}

function unusedOutDir(): string {
  const root = mkdtempSync(path.join(os.tmpdir(), "security-validate-help-"));
  cleanupRoots.push(root);
  return path.join(root, "reports-that-must-not-exist");
}

function expectHelpNoWork(args: string[]) {
  const outDir = unusedOutDir();
  const result = runValidateCli([...args, "--out", outDir]);

  expect(result.status).toBe(0);
  expect(result.stdout).toContain("Usage: npm run security:validate");
  expect(result.stdout).toContain("node-cli-package|local-tool|npm-package|android");
  expect(result.stdout).toContain("--android-gradle-operations");
  expect(result.stdout).toContain("wrapper-version, tasks, assemble-debug, unit-test-debug, lint-debug");
  expect(result.stdout).toContain("Gradle is never executed by default.");
  expect(result.stdout).not.toContain("SECURITY VALIDATION REPORT");
  expect(result.stdout).not.toContain("ANDROID SECURITY-VALIDATION SUMMARY");
  expect(result.stderr).toBe("");
  expect(existsSync(outDir)).toBe(false);
}

describe("security:validate help and unknown-option CLI behavior", () => {
  it("CLI-HELP-01/04/05: --help prints usage and performs no validation or report write", () => {
    expectHelpNoWork(["--help"]);
  });

  it("CLI-HELP-02: -h behaves identically", () => {
    expectHelpNoWork(["-h"]);
  });

  it("CLI-HELP-03: help wins over invalid profile and missing target", () => {
    expectHelpNoWork(["--profile", "invalid", "--help", "--target", "missing-path"]);
  });

  it("CLI-UNKNOWN-01: unknown options fail before validation and report writes", () => {
    const outDir = unusedOutDir();
    const result = runValidateCli(["--definitely-unknown-option", "value", "--out", outDir]);

    expect(result.status).toBe(2);
    expect(result.stderr).toContain("Unknown option: --definitely-unknown-option.");
    expect(result.stderr).toContain("Usage: npm run security:validate");
    expect(result.stdout).toBe("");
    expect(existsSync(outDir)).toBe(false);
  });
});
