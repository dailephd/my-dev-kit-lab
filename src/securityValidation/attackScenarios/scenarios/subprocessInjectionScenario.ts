import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { AttackScenario, AttackScenarioContext, AttackScenarioRunOutcome } from "../attackScenario.js";
import { makeEvidence } from "../exploitEvidence.js";
import { getPayloadsForGroup } from "../payloadCorpus.js";
import { runSecurityCommand } from "../../commandRunner.js";

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
// Also does a bounded static check that the command-execution helpers this
// scenario exercises are built with `shell: false` (source inspection of a
// known-small file, not a general code scanner).
// ---------------------------------------------------------------------------

const ECHO_ARGV_SCRIPT = "process.stdout.write(JSON.stringify(process.argv.slice(1)))";

function commandRunnerSourcePath(): string {
  const here = path.dirname(fileURLToPath(import.meta.url));
  return path.resolve(here, "..", "..", "commandRunner.ts");
}

export const SUBPROCESS_INJECTION_SCENARIO: AttackScenario = {
  id: "subprocess-injection-safety",
  title: "Subprocess injection: shell metacharacter payloads are passed as literal arguments",
  description:
    "Runs a benign argv-echoing Node script with each subprocess-injection payload as a single spawn argument and confirms it round-trips as exactly one literal string, proving no shell re-interpretation. Also checks that commandRunner.ts constructs subprocess calls with shell:false.",
  checkId: "subprocess",
  applicableProfiles: [],
  severityBaseline: "blocker",
  verdictImpact: "tool-framework-blocker",
  expectedSafeBehavior:
    "Every subprocess-injection payload round-trips as a single literal argv element; commandRunner.ts uses shell:false.",
  evidenceRequirements: ["command", "observation"],
  run: async (ctx: AttackScenarioContext): Promise<AttackScenarioRunOutcome> => {
    const evidence = [];
    const notLiteral: string[] = [];

    const payloads = getPayloadsForGroup("subprocess-injection");
    for (const p of payloads) {
      const cmd = await runSecurityCommand({
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

    let shellFalseConfirmed = false;
    let sourceReadable = true;
    try {
      const source = fs.readFileSync(commandRunnerSourcePath(), "utf8");
      shellFalseConfirmed = /shell:\s*false/.test(source);
    } catch {
      sourceReadable = false;
    }
    evidence.push(
      makeEvidence({
        kind: "observation",
        source: "static check: src/securityValidation/commandRunner.ts",
        confidence: sourceReadable ? "high" : "low",
        expectedBehavior: "Subprocess calls should be constructed with shell:false.",
        observedBehavior: sourceReadable
          ? shellFalseConfirmed
            ? "shell:false found in commandRunner.ts."
            : "shell:false NOT found in commandRunner.ts."
          : "Could not read commandRunner.ts source for static confirmation.",
      })
    );

    if (notLiteral.length > 0 || (sourceReadable && !shellFalseConfirmed)) {
      return {
        status: "failed",
        confidence: "high",
        evidence,
        recommendation:
          notLiteral.length > 0
            ? `Investigate argument construction — payload(s) did not round-trip literally: ${notLiteral.join(", ")}.`
            : "commandRunner.ts must construct child_process.spawn calls with shell:false.",
      };
    }

    if (!sourceReadable) {
      return {
        status: "blocked",
        confidence: "low",
        evidence,
        recommendation: "Could not statically confirm shell:false; argv round-trip evidence is still valid.",
      };
    }

    return {
      status: "passed",
      confidence: "high",
      evidence,
    };
  },
};
