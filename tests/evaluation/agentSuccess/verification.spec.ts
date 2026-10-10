import { existsSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  applyPatchToSandbox,
  assessBaseline,
  runVerificationCheck,
  runVerificationChecks,
  type VerificationCheckResult,
  type VerificationStatus
} from "../../../src/evaluation/agentSuccess/index.js";
import { buildMinimalHostEnv } from "../../../src/evaluation/benchmarkSandbox/index.js";
import { FIX_PATCH, makeCanonicalFixture, makeSandbox, useSandboxTestCleanup } from "../benchmarkSandbox/sandboxTestHelpers.js";

useSandboxTestCleanup();

const savedEnv = { ...process.env };
afterEach(() => {
  for (const key of Object.keys(process.env)) if (!(key in savedEnv)) delete process.env[key];
  Object.assign(process.env, savedEnv);
});

const check = (id: string, script: string, timeoutMs = 20_000) => ({ id, executable: "node" as const, args: [script], timeoutMs });

async function sandboxWith(extra: Record<string, string> = {}) {
  return makeSandbox(makeCanonicalFixture(extra), `v${Math.random().toString(36).slice(2, 10)}`);
}

function result(checkClass: "task" | "regression", status: VerificationStatus): VerificationCheckResult {
  return {
    checkId: `${checkClass}-${status}`,
    class: checkClass,
    executable: "node",
    args: [],
    startedAt: "t",
    endedAt: "t",
    durationMs: 0,
    status,
    exitCode: status === "passed" ? 0 : status === "failed" ? 1 : null,
    stdoutPath: "",
    stderrPath: "",
    timedOut: status === "timeout",
    outputLimit: null,
    processError: null,
    failureReason: null
  };
}

describe("verification checks", () => {
  it("RSP-032 reports exit code 0 as passed with evidence files", async () => {
    const sandbox = await sandboxWith();
    const outcome = await runVerificationCheck({ sandbox, check: check("regression-id", "tests/regression.check.cjs"), checkClass: "regression", phase: "baseline" });
    expect(outcome).toMatchObject({ checkId: "regression-id", class: "regression", executable: "node", args: ["tests/regression.check.cjs"], status: "passed", exitCode: 0, timedOut: false, outputLimit: null, processError: null, failureReason: null });
    expect(existsSync(outcome.stdoutPath)).toBe(true);
    expect(existsSync(outcome.stderrPath)).toBe(true);
    expect(outcome.stdoutPath.startsWith(sandbox.evidenceRoot)).toBe(true);
    expect(outcome.stdoutPath).toContain(path.join("verification", "baseline"));
    expect(outcome.durationMs).toBeGreaterThanOrEqual(0);
    expect(Date.parse(outcome.endedAt)).toBeGreaterThanOrEqual(Date.parse(outcome.startedAt));
  });

  it("RSP-033 reports a non-zero exit as failed with the exit code as the reason", async () => {
    const sandbox = await sandboxWith();
    const outcome = await runVerificationCheck({ sandbox, check: check("task-add", "tests/task.check.cjs"), checkClass: "task", phase: "baseline" });
    expect(outcome).toMatchObject({ status: "failed", exitCode: 1, timedOut: false, processError: null });
    expect(outcome.failureReason).toContain("code 1");
    expect(readFileSync(outcome.stderrPath, "utf8")).toContain("add failed");
  });

  it("RSP-033 reports a missing script as failed rather than passed", async () => {
    const sandbox = await sandboxWith();
    const outcome = await runVerificationCheck({ sandbox, check: check("ghost", "tests/does-not-exist.cjs"), checkClass: "task", phase: "baseline" });
    expect(outcome.status).toBe("failed");
    expect(outcome.exitCode).not.toBe(0);
  });

  it("RSP-034 treats a baseline with a failing task check and passing regression checks as evaluable", async () => {
    expect(assessBaseline({ taskResults: [result("task", "failed")], regressionResults: [result("regression", "passed")] })).toEqual({ evaluable: true, reasons: [] });
    expect(assessBaseline({ taskResults: [result("task", "passed"), result("task", "failed")], regressionResults: [result("regression", "passed"), result("regression", "passed")] }).evaluable).toBe(true);
  });

  it("RSP-034 evaluates a real baseline run as evaluable", async () => {
    const sandbox = await sandboxWith();
    const baseline = await runVerificationChecks({
      sandbox,
      task: { taskChecks: [check("task-add", "tests/task.check.cjs")], regressionChecks: [check("regression-id", "tests/regression.check.cjs")] },
      phase: "baseline"
    });
    expect(baseline.taskResults.map((entry) => entry.status)).toEqual(["failed"]);
    expect(baseline.regressionResults.map((entry) => entry.status)).toEqual(["passed"]);
    expect(assessBaseline(baseline)).toEqual({ evaluable: true, reasons: [] });
  });

  it("RSP-035 makes a baseline invalid when every task check already passes", () => {
    const assessment = assessBaseline({ taskResults: [result("task", "passed")], regressionResults: [result("regression", "passed")] });
    expect(assessment).toEqual({ evaluable: false, reasons: ["ALL_TASK_CHECKS_PASSED"] });
  });

  it("RSP-036 makes a baseline invalid when a regression check fails initially, even if a task check fails too", () => {
    const assessment = assessBaseline({ taskResults: [result("task", "failed")], regressionResults: [result("regression", "passed"), result("regression", "failed")] });
    expect(assessment).toEqual({ evaluable: false, reasons: ["REGRESSION_CHECK_FAILED"] });
  });

  it("makes a baseline invalid, never an agent failure, when a check timed out or errored or no checks exist", () => {
    expect(assessBaseline({ taskResults: [result("task", "timeout")], regressionResults: [result("regression", "passed")] })).toEqual({ evaluable: false, reasons: ["CHECK_NOT_EVALUABLE"] });
    expect(assessBaseline({ taskResults: [result("task", "failed")], regressionResults: [result("regression", "error")] })).toEqual({ evaluable: false, reasons: ["CHECK_NOT_EVALUABLE"] });
    expect(assessBaseline({ taskResults: [], regressionResults: [] }).reasons).toContain("NO_CHECKS");
  });

  it("RSP-037 keeps post-edit task and regression evidence separate and never short-circuits", async () => {
    const sandbox = await sandboxWith({ "tests/second.check.cjs": "process.exit(0);\n", "tests/third.check.cjs": "process.exit(2);\n" });
    const applied = await applyPatchToSandbox({ sandbox, rawProposal: FIX_PATCH, protectedFiles: [] });
    expect(applied.outcome).toBe("success");

    const post = await runVerificationChecks({
      sandbox,
      task: {
        taskChecks: [check("task-add", "tests/task.check.cjs"), check("task-third", "tests/third.check.cjs"), check("task-second", "tests/second.check.cjs")],
        regressionChecks: [check("regression-id", "tests/regression.check.cjs"), check("regression-third", "tests/third.check.cjs")]
      },
      phase: "post-edit"
    });
    expect(post.phase).toBe("post-edit");
    expect(post.taskResults.map((entry) => [entry.checkId, entry.class, entry.status])).toEqual([
      ["task-add", "task", "passed"],
      ["task-third", "task", "failed"],
      ["task-second", "task", "passed"]
    ]);
    expect(post.regressionResults.map((entry) => [entry.checkId, entry.class, entry.status])).toEqual([
      ["regression-id", "regression", "passed"],
      ["regression-third", "regression", "failed"]
    ]);
    expect(post.taskResults[0]?.stdoutPath).toContain(path.join("verification", "post-edit"));
    expect(Object.keys(post).sort()).toEqual(["phase", "regressionResults", "taskResults"]);
  });

  it("RSP-038 reports a timeout with the process tree terminated", async () => {
    const sandbox = await sandboxWith({ "tests/hang.check.cjs": "setInterval(() => {}, 1000);\n" });
    const started = Date.now();
    const outcome = await runVerificationCheck({ sandbox, check: check("hang", "tests/hang.check.cjs", 700), checkClass: "task", phase: "baseline" });
    expect(outcome.status).toBe("timeout");
    expect(outcome.timedOut).toBe(true);
    expect(outcome.processError).toContain("timed out");
    expect(outcome.failureReason).toContain("timed out");
    expect(Date.now() - started).toBeLessThan(15_000);
  });

  it("RSP-039 reports an output-limit breach as an error and terminates the process", async () => {
    const sandbox = await sandboxWith({ "tests/flood.check.cjs": 'setInterval(() => process.stdout.write("x".repeat(500)), 1);\n' });
    const started = Date.now();
    const outcome = await runVerificationCheck({ sandbox, check: check("flood", "tests/flood.check.cjs", 20_000), checkClass: "task", phase: "baseline", outputLimitBytes: 2000 });
    expect(outcome.status).toBe("error");
    expect(outcome.outputLimit).toEqual({ stream: "stdout", limitBytes: 2000 });
    expect(outcome.processError).toContain("exceeded 2000 bytes");
    expect(statSync(outcome.stdoutPath).size).toBe(2000);
    expect(Date.now() - started).toBeLessThan(15_000);
  });

  it("RSP-040 does not forward unrelated secret-like environment variables to checks", async () => {
    process.env.API_KEY = "api-key-value";
    process.env.OPENAI_API_KEY = "openai-key-value";
    process.env.GITHUB_TOKEN = "gh-token-value";
    process.env.MY_SECRET = "secret-value";
    process.env.DB_PASSWORD = "password-value";
    process.env.AUTH_HEADER = "auth-value";
    process.env.SESSION_COOKIE = "cookie-value";
    process.env.PROJECT_SPECIFIC = "project-value";
    const sandbox = await sandboxWith({ "tests/env.check.cjs": "console.log(JSON.stringify(process.env));\n" });
    const outcome = await runVerificationCheck({ sandbox, check: check("env", "tests/env.check.cjs"), checkClass: "task", phase: "baseline" });
    expect(outcome.status).toBe("passed");
    const childEnv = JSON.parse(readFileSync(outcome.stdoutPath, "utf8")) as Record<string, string>;
    const names = Object.keys(childEnv).map((name) => name.toLowerCase());
    for (const forbidden of ["api_key", "openai_api_key", "github_token", "my_secret", "db_password", "auth_header", "session_cookie", "project_specific"]) {
      expect(names, forbidden).not.toContain(forbidden);
    }
    expect(JSON.stringify(childEnv)).not.toMatch(/api-key-value|gh-token-value|secret-value|password-value|auth-value|cookie-value|project-value/);
    expect(childEnv.CI).toBe("1");
    expect(childEnv.NO_COLOR).toBe("1");
    expect(names).toContain("path");
  });

  it("builds a minimal host environment that drops credential-like names even when allowed by name", () => {
    const env = buildMinimalHostEnv({ PATH: "/bin", Path: "C:\\bin", SystemRoot: "C:\\Windows", TEMP: "t", LANG: "C", NODE_OPTIONS: "--x", NPM_TOKEN: "tok", TMPDIR_TOKEN: "tok" } as NodeJS.ProcessEnv, { CI: "1" });
    const lower = Object.keys(env).map((key) => key.toLowerCase());
    expect(lower).toEqual(expect.arrayContaining(["path", "systemroot", "temp", "lang", "ci"]));
    expect(lower).not.toContain("node_options");
    expect(lower).not.toContain("npm_token");
    expect(lower.filter((key) => key === "path")).toHaveLength(1);
  });
});
