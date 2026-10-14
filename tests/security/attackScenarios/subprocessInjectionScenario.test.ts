import { describe, expect, it } from "vitest";
import {
  SUBPROCESS_INJECTION_SCENARIO,
  runSubprocessInjectionScenario,
  type SubprocessInjectionDeps,
} from "../../../src/securityValidation/attackScenarios/scenarios/subprocessInjectionScenario.js";
import { DEFAULT_SECURITY_CONFIG } from "../../../src/securityValidation/config.js";
import type { SecurityValidationTarget } from "../../../src/securityValidation/validate/resolveTarget.js";
import { getPayloadsForGroup } from "../../../src/securityValidation/attackScenarios/payloadCorpus.js";
import { buildSecurityCommandSpawnOptions, runSecurityCommand } from "../../../src/securityValidation/commandRunner.js";
import type { AttackScenarioContext } from "../../../src/securityValidation/attackScenarios/attackScenario.js";

function makeCtx(): AttackScenarioContext {
  const target: SecurityValidationTarget = {
    targetRoot: process.cwd(),
    toolRoot: process.cwd(),
    packageName: "fake",
    packageVersion: "1.0.0",
    hasPackageJson: true,
    hasSecurityTestScript: false,
    hasLockfile: false,
    branch: "main",
    commit: "abc",
    hasGit: true,
    isSelf: true,
  };
  return { toolRoot: process.cwd(), target, profile: "node-cli-package", config: DEFAULT_SECURITY_CONFIG };
}

describe("SUBPROCESS_INJECTION_SCENARIO", () => {
  it("source checkout: real runner with all safe evidence available → passed (not merely passed-or-blocked)", async () => {
    const outcome = await SUBPROCESS_INJECTION_SCENARIO.run(makeCtx());
    expect(outcome.status).toBe("passed");
    expect(outcome.confidence).toBe("high");
  }, 30_000);

  it("evidence documents each payload round-trip without executing it as a shell command", async () => {
    const outcome = await SUBPROCESS_INJECTION_SCENARIO.run(makeCtx());
    const commandEvidence = outcome.evidence.filter((e) => e.kind === "command");
    expect(commandEvidence.length).toBe(5); // 5 subprocess-injection payloads in the corpus
    for (const e of commandEvidence) {
      expect(e.observedBehavior).toMatch(/round-tripped as a single literal argument/i);
    }
  }, 30_000);

  it("produces JSON-serializable evidence with redacted previews for shell payloads", async () => {
    const outcome = await SUBPROCESS_INJECTION_SCENARIO.run(makeCtx());
    expect(() => JSON.stringify(outcome.evidence)).not.toThrow();
  }, 30_000);

  it("does not depend on any TypeScript source file next to the scenario module", async () => {
    // The original defect read ../../commandRunner.ts relative to the scenario
    // module; in an installed package only compiled .js exists there.
    const evidence = (await SUBPROCESS_INJECTION_SCENARIO.run(makeCtx())).evidence;
    const proof = evidence.find((e) => e.kind === "observation");
    expect(proof?.source).not.toMatch(/\.ts/);
    expect(proof?.observedBehavior).toMatch(/shell:false/);
  }, 30_000);

  it("preserves scenario id, check id, severity policy and framework-blocker attribution", () => {
    expect(SUBPROCESS_INJECTION_SCENARIO.id).toBe("subprocess-injection-safety");
    expect(SUBPROCESS_INJECTION_SCENARIO.checkId).toBe("subprocess");
    expect(SUBPROCESS_INJECTION_SCENARIO.verdictImpact).toBe("tool-framework-blocker");
    expect(SUBPROCESS_INJECTION_SCENARIO.severityBaseline).toBe("blocker");
    expect(SUBPROCESS_INJECTION_SCENARIO.evidenceRequirements).toEqual(["command", "observation"]);
  });

  it("round-trips every corpus payload as exactly one literal argv value", async () => {
    const payloads = getPayloadsForGroup("subprocess-injection");
    expect(payloads.length).toBe(5);
    const outcome = await SUBPROCESS_INJECTION_SCENARIO.run(makeCtx());
    const commands = outcome.evidence.filter((e) => e.kind === "command");
    expect(commands.map((e) => e.source)).toEqual(
      payloads.map((p) => `runSecurityCommand() argv round-trip for payload '${p.id}'`)
    );
  }, 30_000);

  it("the real spawn-options builder declares shell:false", () => {
    const options = buildSecurityCommandSpawnOptions({ cwd: process.cwd(), env: process.env });
    expect(options.shell).toBe(false);
  });

  describe("controlled runners", () => {
    const safeOptions = () => buildSecurityCommandSpawnOptions({ cwd: process.cwd(), env: process.env });
    const realDeps: SubprocessInjectionDeps = {
      runCommand: runSecurityCommand,
      readSpawnOptions: safeOptions,
    };

    it("unsafe argv interpretation (payload split into several args) → failed", async () => {
      const outcome = await runSubprocessInjectionScenario(makeCtx(), {
        ...realDeps,
        // Simulates a shell having re-split the payload; nothing is executed.
        runCommand: async (options) => ({
          command: options.command,
          args: options.args,
          cwd: options.cwd,
          exitCode: 0,
          durationMs: 0,
          stdout: JSON.stringify(["inert", "split"]),
          stderr: "",
          timedOut: false,
          skipped: false,
        }),
      });
      expect(outcome.status).toBe("failed");
      expect(outcome.recommendation).toMatch(/did not round-trip literally/);
    });

    it("runner that enables a shell → failed even when argv round-trips", async () => {
      const outcome = await runSubprocessInjectionScenario(makeCtx(), {
        ...realDeps,
        readSpawnOptions: () => ({ shell: true }),
      });
      expect(outcome.status).toBe("failed");
      expect(outcome.recommendation).toMatch(/shell:false/);
    });

    it("safety proof unavailable (builder throws) → blocked, never passed", async () => {
      const outcome = await runSubprocessInjectionScenario(makeCtx(), {
        ...realDeps,
        readSpawnOptions: () => {
          throw new Error("module not loadable");
        },
      });
      expect(outcome.status).toBe("blocked");
      expect(outcome.confidence).toBe("low");
    });

    it.each([
      ["undefined", undefined],
      ["null", null],
      ["missing shell field", { cwd: "x" }],
      ["non-boolean shell", { shell: 0 }],
    ])("malformed or incomplete proof (%s) → blocked", async (_label, value) => {
      const outcome = await runSubprocessInjectionScenario(makeCtx(), {
        ...realDeps,
        readSpawnOptions: () => value,
      });
      expect(outcome.status).toBe("blocked");
    });

    it("evidence from every outcome is JSON-serializable", async () => {
      const outcome = await runSubprocessInjectionScenario(makeCtx(), {
        ...realDeps,
        readSpawnOptions: () => undefined,
      });
      expect(() => JSON.stringify(outcome)).not.toThrow();
    });
  });
});
