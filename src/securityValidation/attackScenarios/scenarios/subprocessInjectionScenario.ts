import type { AttackScenario, AttackScenarioContext, AttackScenarioRunOutcome } from "../attackScenario.js";
import { makeEvidence } from "../exploitEvidence.js";
import { getPayloadsForGroup } from "../payloadCorpus.js";
import { buildSecurityCommandSpawnOptions, runSecurityCommand } from "../../commandRunner.js";

// ---------------------------------------------------------------------------
// v0.2.2 Batch 3 — subprocess injection scenario.
//
// Non-destructive by construction: never executes a payload as a shell
// command. Instead it runs `node -e "..."` with each subprocess-injection
// payload passed as a single argv element (via spawn's argument array, the
// same mechanism runSecurityCommand/runMeasuredCommand use), and confirms
// the child process receives it back as exactly one literal argument — proof
// that no shell re-interpreted it (splitting it into multiple commands via
// `;`, `&&`, backticks, `$()`, or `|`).
//
// Also verifies at runtime, through the compiled command runner's own
// spawn-options builder (the exact value runSecurityCommand() spawns with),
// that the runner does not enable a shell. No TypeScript source is read, so
// the proof works from an installed package.
// ---------------------------------------------------------------------------

const ECHO_ARGV_SCRIPT = "process.stdout.write(JSON.stringify(process.argv.slice(1)))";

// Dependencies of the scenario, injectable so tests can substitute a
// controlled runner without executing anything unsafe. The defaults are the
// real command runner and its real spawn-options builder, both of which ship
// in the compiled package.
export interface SubprocessInjectionDeps {
  runCommand: typeof runSecurityCommand;
  readSpawnOptions: (cwd: string) => unknown;
}

const DEFAULT_DEPS: SubprocessInjectionDeps = {
  runCommand: runSecurityCommand,
  readSpawnOptions: (cwd) => buildSecurityCommandSpawnOptions({ cwd, env: process.env }),
};

type ShellPolicyProof =
  | { state: "safe" }
  | { state: "unsafe"; detail: string }
  | { state: "unavailable"; detail: string };

// Runtime proof that the applicable runner's spawn path does not use a shell.
// A strict `shell === false` is the only accepted safe value; a truthy shell
// is demonstrated unsafe; a missing/malformed/throwing proof is unavailable.
function proveShellDisabled(deps: SubprocessInjectionDeps, cwd: string): ShellPolicyProof {
  let options: unknown;
  try {
    options = deps.readSpawnOptions(cwd);
  } catch (error) {
    return {
      state: "unavailable",
      detail: `Spawn options could not be obtained from the command runner: ${error instanceof Error ? error.message : String(error)}`,
    };
  }
  if (typeof options !== "object" || options === null || !("shell" in options)) {
    return { state: "unavailable", detail: "Command runner spawn options did not declare a shell setting." };
  }
  const shell = (options as { shell: unknown }).shell;
  if (shell === false) return { state: "safe" };
  if (shell === true || typeof shell === "string") {
    return { state: "unsafe", detail: "Command runner spawn options enable a shell." };
  }
  return { state: "unavailable", detail: "Command runner spawn options declared a malformed shell setting." };
}

export const SUBPROCESS_INJECTION_SCENARIO: AttackScenario = {
  id: "subprocess-injection-safety",
  title: "Subprocess injection: shell metacharacter payloads are passed as literal arguments",
  description:
    "Runs a benign argv-echoing Node script with each subprocess-injection payload as a single spawn argument and confirms it round-trips as exactly one literal string, proving no shell re-interpretation. Also verifies at runtime that the command runner constructs subprocess calls with shell:false.",
  checkId: "subprocess",
  applicableProfiles: [],
  severityBaseline: "blocker",
  verdictImpact: "tool-framework-blocker",
  expectedSafeBehavior:
    "Every subprocess-injection payload round-trips as a single literal argv element; the command runner uses shell:false.",
  evidenceRequirements: ["command", "observation"],
  run: (ctx: AttackScenarioContext) => runSubprocessInjectionScenario(ctx, DEFAULT_DEPS),
};

export async function runSubprocessInjectionScenario(
  ctx: AttackScenarioContext,
  deps: SubprocessInjectionDeps
): Promise<AttackScenarioRunOutcome> {
  {
    const evidence = [];
    const notLiteral: string[] = [];

    const payloads = getPayloadsForGroup("subprocess-injection");
    for (const p of payloads) {
      const cmd = await deps.runCommand({
        command: process.execPath,
        args: ["-e", ECHO_ARGV_SCRIPT, p.value],
        cwd: ctx.toolRoot,
        timeoutMs: 10_000,
      });

      let roundTrippedCorrectly = false;
      try {
        const parsed = JSON.parse(cmd.stdout.trim()) as string[];
        roundTrippedCorrectly = parsed.length === 1 && parsed[0] === p.value;
      } catch {
        roundTrippedCorrectly = false;
      }

      if (!roundTrippedCorrectly) {
        notLiteral.push(p.id);
      }

      evidence.push(
        makeEvidence({
          kind: "command",
          source: `runSecurityCommand() argv round-trip for payload '${p.id}'`,
          commandCwd: ctx.toolRoot,
          commandSummary: "node -e <argv-echo-script> <payload>",
          exitCode: cmd.exitCode,
          confidence: "high",
          expectedBehavior: "Payload must round-trip as exactly one literal argv element.",
          observedBehavior: roundTrippedCorrectly
            ? "Round-tripped as a single literal argument, as expected."
            : "Did NOT round-trip as a single literal argument — possible shell interpretation.",
          rawPreview: p.value,
        })
      );
    }

    const proof = proveShellDisabled(deps, ctx.toolRoot);
    evidence.push(
      makeEvidence({
        kind: "observation",
        source: "runtime check: buildSecurityCommandSpawnOptions() used by runSecurityCommand()",
        confidence: proof.state === "unavailable" ? "low" : "high",
        expectedBehavior: "Subprocess calls should be constructed with shell:false.",
        observedBehavior:
          proof.state === "safe"
            ? "Command runner spawn options declare shell:false."
            : proof.state === "unsafe"
              ? proof.detail
              : `Could not verify shell:false: ${proof.detail}`,
      })
    );

    if (notLiteral.length > 0 || proof.state === "unsafe") {
      return {
        status: "failed",
        confidence: "high",
        evidence,
        recommendation:
          notLiteral.length > 0
            ? `Investigate argument construction — payload(s) did not round-trip literally: ${notLiteral.join(", ")}.`
            : "The command runner must construct child_process.spawn calls with shell:false.",
      };
    }

    if (proof.state === "unavailable") {
      return {
        status: "blocked",
        confidence: "low",
        evidence,
        recommendation: "Could not verify shell:false for the command runner; argv round-trip evidence alone is not sufficient.",
      };
    }

    return {
      status: "passed",
      confidence: "high",
      evidence,
    };
  }
}
