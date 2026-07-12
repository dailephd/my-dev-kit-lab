import type { CommandExecutionResult } from "../../../../securityValidation/types.js";
import { runSecurityCommand } from "../../../../securityValidation/commandRunner.js";
import { boundedText, DEFAULT_MAX_STDERR_BYTES, DEFAULT_MAX_STDOUT_BYTES } from "./boundedOutput.js";
import type { ExternalToolCommandInput, ExternalToolExecutor } from "./types.js";

// ---------------------------------------------------------------------------
// v0.4.1 Batch 7 — bounded external-tool execution.
//
// Reuses runSecurityCommand (shell:false, argument array, existing
// cross-platform Windows .cmd/.bat shim handling via resolveCommand) rather
// than a second process owner — the only new behavior added here is passing
// a minimized environment and bounding stdout/stderr before they leave this
// module, mirroring buildGradleOperationCheckResult's boundedSummary()
// pattern but generalized for reuse across all four Batch 7 adapters.
// ---------------------------------------------------------------------------

export const VERSION_PROBE_TIMEOUT_MS = 15_000;

export function createRealExternalToolExecutor(): ExternalToolExecutor {
  return (input: ExternalToolCommandInput) =>
    runSecurityCommand({
      command: input.command,
      args: input.args,
      cwd: input.cwd,
      timeoutMs: input.timeoutMs,
      env: input.env,
    });
}

export type BoundedExecutionOutcome = {
  result: CommandExecutionResult;
  stdout: string;
  stderr: string;
  stdoutTruncated: boolean;
  stderrTruncated: boolean;
};

export async function runBoundedExternalTool(
  executor: ExternalToolExecutor,
  input: ExternalToolCommandInput,
  maxStdoutBytes: number = DEFAULT_MAX_STDOUT_BYTES,
  maxStderrBytes: number = DEFAULT_MAX_STDERR_BYTES
): Promise<BoundedExecutionOutcome> {
  const result = await executor(input);
  const stdoutBound = boundedText(result.stdout, maxStdoutBytes);
  const stderrBound = boundedText(result.stderr, maxStderrBytes);
  return {
    result,
    stdout: stdoutBound.text,
    stderr: stderrBound.text,
    stdoutTruncated: stdoutBound.truncated,
    stderrTruncated: stderrBound.truncated,
  };
}

// Deterministic, sanitized command summary: fixed tool identity + fixed
// option names, target/artifact roots replaced with symbolic placeholders,
// never the resolved absolute executable path or any environment value.
export function buildCommandSummary(toolBasename: string, args: readonly string[], targetRoot: string, artifactRoot?: string): string {
  const sanitizedArgs = args.map((arg) => {
    if (arg === targetRoot) return "<TARGET>";
    if (artifactRoot && arg === artifactRoot) return "<ARTIFACT_ROOT>";
    if (arg.startsWith(targetRoot)) return `<TARGET>${arg.slice(targetRoot.length).replace(/\\/g, "/")}`;
    if (artifactRoot && arg.startsWith(artifactRoot)) return `<ARTIFACT_ROOT>${arg.slice(artifactRoot.length).replace(/\\/g, "/")}`;
    return arg;
  });
  return [toolBasename, ...sanitizedArgs].join(" ");
}
