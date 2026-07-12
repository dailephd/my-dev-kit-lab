import { describe, expect, it } from "vitest";
import { runSecurityCommand } from "../../src/securityValidation/commandRunner.js";

// v0.4.1 Batch 7 — narrow additive regression: the optional `env` parameter
// must never affect callers that omit it (every pre-existing caller), and
// must be honored by the child process when supplied.
describe("runSecurityCommand env parameter (Batch 7 narrow correction)", () => {
  it("defaults to inheriting process.env when env is omitted", async () => {
    process.env.RUN_SECURITY_COMMAND_ENV_TEST = "inherited-value";
    try {
      const result = await runSecurityCommand({
        command: process.execPath,
        args: ["-e", "process.stdout.write(process.env.RUN_SECURITY_COMMAND_ENV_TEST || '')"],
        cwd: process.cwd(),
        timeoutMs: 10_000,
      });
      expect(result.stdout).toBe("inherited-value");
    } finally {
      delete process.env.RUN_SECURITY_COMMAND_ENV_TEST;
    }
  });

  it("uses the supplied minimal env instead of the full process env when provided", async () => {
    process.env.RUN_SECURITY_COMMAND_ENV_TEST = "should-not-be-visible";
    try {
      const minimalEnv: NodeJS.ProcessEnv = { PATH: process.env.PATH, ONLY_ALLOWED_VAR: "visible-value" };
      const result = await runSecurityCommand({
        command: process.execPath,
        args: ["-e", "process.stdout.write((process.env.RUN_SECURITY_COMMAND_ENV_TEST || 'ABSENT') + ':' + (process.env.ONLY_ALLOWED_VAR || 'ABSENT'))"],
        cwd: process.cwd(),
        timeoutMs: 10_000,
        env: minimalEnv,
      });
      expect(result.stdout).toBe("ABSENT:visible-value");
    } finally {
      delete process.env.RUN_SECURITY_COMMAND_ENV_TEST;
    }
  });
});
