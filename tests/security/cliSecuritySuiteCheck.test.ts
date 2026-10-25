import { describe, expect, it, vi } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { resolveValidationTarget } from "../../src/securityValidation/validate/resolveTarget.js";
import { runCliSecuritySuiteCheck } from "../../src/securityValidation/validate/runCliSecuritySuiteCheck.js";
import * as runner from "../../src/securityValidation/commandRunner.js";
import type { CommandExecutionResult } from "../../src/securityValidation/types.js";

function makeTempProject(prefix: string): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

function cleanup(dir: string): void {
  fs.rmSync(dir, { recursive: true, force: true });
}

function writeJson(filePath: string, value: unknown): void {
  fs.writeFileSync(filePath, JSON.stringify(value, null, 2), "utf8");
}

function normalizeExistingPath(dir: string): string {
  return fs.realpathSync.native(path.resolve(dir));
}

function extractReportedPath(summary: string, prefix: string): string {
  const line = summary
    .split(/\r?\n/)
    .find((entry) => entry.startsWith(prefix));
  if (!line) {
    throw new Error(`expected summary line starting with ${prefix}`);
  }
  return line.slice(prefix.length);
}

describe("runCliSecuritySuiteCheck", () => {
  it.each([
    { exitCode: null, signal: "SIGTERM" as const, timedOut: false },
    { exitCode: null, signal: null, timedOut: true, treeTerminated: true },
    { exitCode: 0, signal: null, timedOut: true, treeTerminated: true },
    { exitCode: 0, signal: null, timedOut: false, treeTerminated: false },
    { exitCode: null, signal: null, timedOut: false, spawnError: "spawn ENOENT" },
  ])("retains truthful failed process evidence and never reconstructs success: %j", async processResult => {
    const cmd: CommandExecutionResult = {
      command: "npm", args: ["run", "test:security"], cwd: process.cwd(),
      durationMs: 1234, stdout: "784 tests passed", stderr: "", skipped: false,
      timeoutMs: 180000, resolutionKind: "direct", ...processResult,
    };
    const spy = vi.spyOn(runner, "runSecurityCommand").mockResolvedValue(cmd);
    try {
      const result = await runCliSecuritySuiteCheck({ toolRoot: process.cwd(), target: resolveValidationTarget(undefined, process.cwd()), timeoutMs: 60000 });
      expect(spy.mock.calls[0]?.[0].timeoutMs).toBe(180000);
      expect(result.status).toBe("failed");
      expect(result.exitCode).toBe(cmd.exitCode);
      expect(result.findings[0]?.severity).toBe("major");
      const evidence = result.findings[0]?.evidence;
      expect(evidence).toContain(`timedOut=${cmd.timedOut}`);
      expect(evidence).toContain(`signal=${String(cmd.signal)}`);
      expect(evidence).toContain("timeoutMs=180000");
      expect(evidence).toContain("durationMs=1234");
      if (cmd.spawnError) expect(evidence).toContain("spawnError=spawn ENOENT");
    } finally { spy.mockRestore(); }
  });

  it("bounds and sanitizes untrusted stdout/stderr evidence without changing a nonzero exit", async () => {
    const spy = vi.spyOn(runner, "runSecurityCommand").mockResolvedValue({
      command: "npm", args: [], cwd: process.cwd(), exitCode: 9, durationMs: 1,
      stdout: "\x1b[31m" + "x".repeat(1000) + "UNRETAINED", stderr: "\x00bad\x1b[0m",
      timedOut: false, skipped: false,
    });
    try {
      const result = await runCliSecuritySuiteCheck({ toolRoot: process.cwd(), target: resolveValidationTarget(undefined, process.cwd()), timeoutMs: 60000 });
      expect(result.status).toBe("failed");
      expect(result.exitCode).toBe(9);
      expect(result.stdoutSummary).toHaveLength(500);
      expect(result.stderrSummary).toBe("bad");
      expect(result.findings[0]?.evidence).not.toMatch(/[\x00\x1b]|UNRETAINED/);
      expect(result.findings[0]?.evidence).toContain("signal=unknown");
    } finally { spy.mockRestore(); }
  });

  it("runs target test:security in the target cwd and passes when the script exits 0", async () => {
    const targetRoot = makeTempProject("sec target pass ");
    const packageJsonPath = path.join(targetRoot, "package.json");
    const scriptPath = path.join(targetRoot, "security-pass.js");
    try {
      writeJson(packageJsonPath, {
        name: "target-pass-project",
        version: "1.0.0",
        scripts: {
          "test:security": "node security-pass.js",
        },
      });
      fs.writeFileSync(
        scriptPath,
        "console.log('SECURITY_PASS_CWD=' + process.cwd());\n",
        "utf8"
      );
      const packageJsonBefore = fs.readFileSync(packageJsonPath, "utf8");
      const scriptBefore = fs.readFileSync(scriptPath, "utf8");
      const target = resolveValidationTarget(targetRoot, process.cwd());

      const result = await runCliSecuritySuiteCheck({
        toolRoot: process.cwd(),
        target,
        timeoutMs: 30_000,
      });
      const normalizedTargetRoot = normalizeExistingPath(targetRoot);
      if (result.commandCwd === undefined) {
        throw new Error("expected commandCwd for passing target security suite result");
      }
      if (result.stdoutSummary === undefined) {
        throw new Error("expected stdoutSummary for passing target security suite result");
      }

      expect(result.status).toBe("passed");
      expect(result.command).toBe("npm run test:security");
      expect(normalizeExistingPath(result.commandCwd)).toBe(normalizedTargetRoot);
      expect(result.exitCode).toBe(0);
      expect(
        normalizeExistingPath(extractReportedPath(result.stdoutSummary, "SECURITY_PASS_CWD="))
      ).toBe(normalizedTargetRoot);
      expect(result.findings).toHaveLength(0);
      expect(fs.readFileSync(packageJsonPath, "utf8")).toBe(packageJsonBefore);
      expect(fs.readFileSync(scriptPath, "utf8")).toBe(scriptBefore);
    } finally {
      cleanup(targetRoot);
    }
  }, 15000);

  it("fails when the target test:security script exits nonzero", async () => {
    const targetRoot = makeTempProject("sec-target-fail-");
    try {
      writeJson(path.join(targetRoot, "package.json"), {
        name: "target-fail-project",
        version: "1.0.0",
        scripts: {
          "test:security": "node security-fail.js",
        },
      });
      fs.writeFileSync(
        path.join(targetRoot, "security-fail.js"),
        "console.error('SECURITY_FAIL_CWD=' + process.cwd());\nprocess.exit(1);\n",
        "utf8"
      );
      const target = resolveValidationTarget(targetRoot, process.cwd());

      const result = await runCliSecuritySuiteCheck({
        toolRoot: process.cwd(),
        target,
        timeoutMs: 30_000,
      });
      const normalizedTargetRoot = normalizeExistingPath(targetRoot);
      if (result.commandCwd === undefined) {
        throw new Error("expected commandCwd for failing target security suite result");
      }
      if (result.stderrSummary === undefined) {
        throw new Error("expected stderrSummary for failing target security suite result");
      }

      expect(result.status).toBe("failed");
      expect(normalizeExistingPath(result.commandCwd)).toBe(normalizedTargetRoot);
      expect(result.exitCode).toBe(1);
      expect(
        normalizeExistingPath(extractReportedPath(result.stderrSummary, "SECURITY_FAIL_CWD="))
      ).toBe(normalizedTargetRoot);
      expect(result.findings).toHaveLength(1);
      expect(result.findings[0]?.title).toContain("Target test:security script failed");
      expect(result.findings[0]?.evidence).toContain("cwd=");
      expect(result.findings[0]?.evidence).toContain("exitCode=1");
      // npm 12 may print "npm notice" lines before the target script's own stderr, so the target-produced
      // marker is located inside the bounded stderr evidence rather than assumed to be its first line.
      const evidence = result.findings[0]?.evidence ?? "";
      expect(evidence).toContain("stderr=");
      expect(
        normalizeExistingPath(extractReportedPath(evidence.slice(evidence.indexOf("stderr=") + "stderr=".length), "SECURITY_FAIL_CWD="))
      ).toBe(normalizedTargetRoot);
    } finally {
      cleanup(targetRoot);
    }
  }, 15000);

  it("still passes a zero-exit target script whose stderr carries unrelated noise", async () => {
    const targetRoot = makeTempProject("sec-target-noise-pass-");
    try {
      writeJson(path.join(targetRoot, "package.json"), {
        name: "target-noise-pass-project",
        version: "1.0.0",
        scripts: { "test:security": "node security-noise.js" },
      });
      fs.writeFileSync(
        path.join(targetRoot, "security-noise.js"),
        "console.error('npm notice unrelated noise');\nconsole.error('SECURITY_FAIL_CWD=not-a-failure');\n",
        "utf8"
      );
      const target = resolveValidationTarget(targetRoot, process.cwd());

      const result = await runCliSecuritySuiteCheck({
        toolRoot: process.cwd(),
        target,
        timeoutMs: 30_000,
      });

      expect(result.status).toBe("passed");
      expect(result.exitCode).toBe(0);
      expect(result.findings).toHaveLength(0);
    } finally {
      cleanup(targetRoot);
    }
  }, 15000);

  it("fails a nonzero target script even when its stderr has only unrelated noise", async () => {
    const targetRoot = makeTempProject("sec-target-noise-fail-");
    try {
      writeJson(path.join(targetRoot, "package.json"), {
        name: "target-noise-fail-project",
        version: "1.0.0",
        scripts: { "test:security": "node security-noise-fail.js" },
      });
      fs.writeFileSync(
        path.join(targetRoot, "security-noise-fail.js"),
        "console.error('npm notice unrelated noise');\nprocess.exit(3);\n",
        "utf8"
      );
      const target = resolveValidationTarget(targetRoot, process.cwd());

      const result = await runCliSecuritySuiteCheck({
        toolRoot: process.cwd(),
        target,
        timeoutMs: 30_000,
      });

      expect(result.status).toBe("failed");
      expect(result.exitCode).toBe(3);
      expect(result.findings).toHaveLength(1);
      expect(result.findings[0]?.severity).toBe("major");
      expect(result.findings[0]?.evidence).toContain("exitCode=3");
      expect(result.findings[0]?.evidence).not.toContain("SECURITY_FAIL_CWD=");
    } finally {
      cleanup(targetRoot);
    }
  }, 15000);

  it("fails with a major finding when the target package lacks test:security", async () => {
    const targetRoot = makeTempProject("sec-target-missing-");
    try {
      writeJson(path.join(targetRoot, "package.json"), {
        name: "target-missing-project",
        version: "1.0.0",
        scripts: {
          test: "node -e \"console.log('ok')\"",
        },
      });
      const target = resolveValidationTarget(targetRoot, process.cwd());

      const result = await runCliSecuritySuiteCheck({
        toolRoot: process.cwd(),
        target,
        timeoutMs: 30_000,
      });

      expect(result.status).toBe("failed");
      expect(result.exitCode).toBeNull();
      expect(result.commandCwd).toBe(path.resolve(targetRoot));
      expect(result.findings).toHaveLength(1);
      expect(result.findings[0]?.id).toBe("target-security-suite-missing-script");
    } finally {
      cleanup(targetRoot);
    }
  });
});
