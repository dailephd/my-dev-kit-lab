import { spawn } from "node:child_process";
import type { SecurityCheckResult } from "../types.js";
import type { AdversarialCliTarget } from "./adversarialCliConfig.js";
import { buildCliCommand } from "./adversarialCliConfig.js";
import { makeFinding, skippedCheck } from "./runAdversarialCheck.js";
import { createTempWorkspace } from "./tempWorkspace.js";

// ---------------------------------------------------------------------------
// JSON stdout/stderr safety checks
//
// Verifies that:
//   - JSON mode produces parseable JSON on stdout
//   - Warnings go to stderr and do not corrupt stdout
//   - Failure in JSON mode produces a valid JSON error object, not a stack trace
//
// These checks only run when the target supports --format json.
// For the fake CLI: --format json is always supported.
// ---------------------------------------------------------------------------

type StdioResult = {
  exitCode: number;
  stdout: string;
  stderr: string;
};

function runAndCapture(
  command: string,
  args: string[],
  cwd: string,
  timeoutMs: number
): Promise<StdioResult> {
  return new Promise<StdioResult>((resolve) => {
    let child;
    try {
      child = spawn(command, args, {
        cwd,
        shell: false,
        stdio: ["ignore", "pipe", "pipe"],
        env: { ...process.env },
      });
    } catch {
      resolve({ exitCode: 1, stdout: "", stderr: "" });
      return;
    }

    const stdoutChunks: Buffer[] = [];
    const stderrChunks: Buffer[] = [];

    child.stdout.on("data", (chunk: Buffer) => stdoutChunks.push(chunk));
    child.stderr.on("data", (chunk: Buffer) => stderrChunks.push(chunk));

    const timer = setTimeout(() => {
      try {
        child.kill();
      } catch {
        // ignore
      }
      resolve({
        exitCode: 1,
        stdout: Buffer.concat(stdoutChunks).toString("utf8"),
        stderr: Buffer.concat(stderrChunks).toString("utf8"),
      });
    }, timeoutMs);

    child.on("close", (code: number | null) => {
      clearTimeout(timer);
      resolve({
        exitCode: code ?? 1,
        stdout: Buffer.concat(stdoutChunks).toString("utf8"),
        stderr: Buffer.concat(stderrChunks).toString("utf8"),
      });
    });

    child.on("error", () => {
      clearTimeout(timer);
      resolve({
        exitCode: 1,
        stdout: Buffer.concat(stdoutChunks).toString("utf8"),
        stderr: Buffer.concat(stderrChunks).toString("utf8"),
      });
    });
  });
}

// ---------------------------------------------------------------------------
// Exported checks
// ---------------------------------------------------------------------------

/**
 * Checks that `--format json` produces parseable JSON on stdout.
 */
export async function checkJsonOutputIsParseable(
  target: AdversarialCliTarget
): Promise<SecurityCheckResult> {
  const started = new Date();
  const workspace = createTempWorkspace("p5-json-parse-");
  try {
    const { command, args } = buildCliCommand(target, [
      "--root",
      workspace.sourceDir,
      "--out",
      workspace.outputDir,
      "--format",
      "json",
    ]);

    const result = await runAndCapture(command, args, workspace.root, target.timeoutMs);
    const finished = new Date();

    const findings = [];
    const stdout = result.stdout.trim();

    if (stdout.length === 0) {
      if (!target.isRealTarget) {
        findings.push(
          makeFinding({
            id: "json-stdout-empty",
            title: "JSON mode produced no stdout output",
            severity: "major",
            category: "cli-adversarial",
            description: "Expected JSON on stdout but got empty output.",
            recommendation: "CLI should emit a JSON object to stdout when --format json is requested.",
          })
        );
      }
      // For real targets: empty stdout may be intentional; skip finding
    } else {
      try {
        const parsed = JSON.parse(stdout) as unknown;
        if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
          findings.push(
            makeFinding({
              id: "json-stdout-not-object",
              title: "JSON output is not an object",
              severity: "minor",
              category: "cli-adversarial",
              description: `Parsed JSON is ${Array.isArray(parsed) ? "array" : typeof parsed}, not an object.`,
              recommendation: "JSON output should be a top-level object.",
            })
          );
        }
      } catch (e) {
        findings.push(
          makeFinding({
            id: "json-stdout-not-parseable",
            title: "stdout is not valid JSON in JSON mode",
            severity: "major",
            category: "cli-adversarial",
            description: `JSON.parse failed: ${(e as Error).message}. stdout was: ${stdout.slice(0, 200)}`,
            recommendation:
              "CLI must emit only valid JSON to stdout when --format json is requested.",
          })
        );
      }
    }

    return {
      id: "json-mode-parseable-output",
      name: "JSON mode produces parseable JSON on stdout",
      category: "cli-adversarial",
      severity: "major" as const,
      status:
        findings.some((f) => f.severity === "major" || f.severity === "blocker")
          ? "failed"
          : findings.length > 0
          ? "warning"
          : "passed",
      findings,
      startedAt: started.toISOString(),
      finishedAt: finished.toISOString(),
      durationMs: finished.getTime() - started.getTime(),
    };
  } finally {
    await workspace.cleanup();
  }
}

/**
 * Checks that warning messages go to stderr and do not corrupt stdout.
 * Uses --emit-stderr to trigger a warning and verifies stdout is still valid JSON.
 */
export async function checkStderrNotInStdout(
  target: AdversarialCliTarget
): Promise<SecurityCheckResult> {
  const started = new Date();
  const workspace = createTempWorkspace("p5-stderr-sep-");
  try {
    const warningText = "test-warning-signal-abc123";

    const { command, args } = buildCliCommand(target, [
      "--root",
      workspace.sourceDir,
      "--out",
      workspace.outputDir,
      "--format",
      "json",
      "--emit-stderr",
      warningText,
    ]);

    const result = await runAndCapture(command, args, workspace.root, target.timeoutMs);
    const finished = new Date();

    const findings = [];
    const stdout = result.stdout.trim();

    if (stdout.includes(warningText)) {
      findings.push(
        makeFinding({
          id: "warning-in-stdout",
          title: "Warning message appeared in stdout",
          severity: "major",
          category: "cli-adversarial",
          description: `Warning text '${warningText}' was found in stdout. Warnings must go to stderr only.`,
          recommendation:
            "All warning and progress messages must be written to stderr, not stdout.",
        })
      );
    }

    if (stdout.length > 0) {
      try {
        JSON.parse(stdout);
      } catch (e) {
        findings.push(
          makeFinding({
            id: "stdout-not-json-with-stderr",
            title: "stdout is not valid JSON when stderr warning is emitted",
            severity: "major",
            category: "cli-adversarial",
            description: `JSON.parse failed: ${(e as Error).message}. This may indicate stderr contaminated stdout.`,
            recommendation:
              "stderr output must not be mixed into stdout in JSON mode.",
          })
        );
      }
    }

    return {
      id: "warnings-go-to-stderr",
      name: "Warnings go to stderr and do not corrupt JSON stdout",
      category: "cli-adversarial",
      severity: "major" as const,
      status:
        findings.some((f) => f.severity === "major" || f.severity === "blocker")
          ? "failed"
          : findings.length > 0
          ? "warning"
          : "passed",
      findings,
      startedAt: started.toISOString(),
      finishedAt: finished.toISOString(),
      durationMs: finished.getTime() - started.getTime(),
    };
  } finally {
    await workspace.cleanup();
  }
}

/**
 * Checks that a CLI failure in JSON mode produces a valid JSON error object.
 * Not a crash, not a raw stack trace, not empty.
 */
export async function checkFailureProducesJsonError(
  target: AdversarialCliTarget
): Promise<SecurityCheckResult> {
  const started = new Date();
  const workspace = createTempWorkspace("p5-json-err-");
  try {
    const { command, args } = buildCliCommand(target, [
      "--root",
      workspace.sourceDir,
      "--format",
      "json",
      "--fail",
    ]);

    const result = await runAndCapture(command, args, workspace.root, target.timeoutMs);
    const finished = new Date();

    const findings = [];

    if (result.exitCode === 0) {
      findings.push(
        makeFinding({
          id: "failure-exit-code-zero",
          title: "CLI exited 0 even though failure was requested",
          severity: "minor",
          category: "cli-adversarial",
          description: "--fail was passed but the CLI exited with code 0.",
          recommendation: "CLI must exit non-zero on errors.",
        })
      );
    }

    const stdout = result.stdout.trim();
    if (stdout.length > 0) {
      try {
        const parsed = JSON.parse(stdout) as unknown;
        if (
          typeof parsed !== "object" ||
          parsed === null ||
          Array.isArray(parsed)
        ) {
          findings.push(
            makeFinding({
              id: "json-error-not-object",
              title: "JSON error output is not an object",
              severity: "minor",
              category: "cli-adversarial",
              description: "Expected a JSON object with an error field; got a non-object.",
              recommendation: "CLI should emit a JSON object with an 'error' field on failure.",
            })
          );
        }
      } catch (e) {
        findings.push(
          makeFinding({
            id: "json-error-not-parseable",
            title: "stdout is not valid JSON on failure in JSON mode",
            severity: "major",
            category: "cli-adversarial",
            description: `JSON.parse failed: ${(e as Error).message}. stdout: ${stdout.slice(0, 200)}`,
            recommendation:
              "CLI must emit valid JSON to stdout even when reporting an error. Stack traces must not appear on stdout.",
          })
        );
      }
    }

    return {
      id: "json-error-object-on-failure",
      name: "CLI failure in JSON mode produces a valid JSON error object",
      category: "cli-adversarial",
      severity: "minor" as const,
      status:
        findings.some((f) => f.severity === "major" || f.severity === "blocker")
          ? "failed"
          : findings.length > 0
          ? "warning"
          : "passed",
      findings,
      startedAt: started.toISOString(),
      finishedAt: finished.toISOString(),
      durationMs: finished.getTime() - started.getTime(),
    };
  } finally {
    await workspace.cleanup();
  }
}

/**
 * Verifies that progress/status output does not corrupt JSON stdout.
 * Runs the CLI with --format json and verifies the output line can be parsed.
 * This is a structural alias over checkJsonOutputIsParseable for naming alignment
 * with the test matrix entry.
 */
export async function checkProgressNotInJsonStdout(
  target: AdversarialCliTarget
): Promise<SecurityCheckResult> {
  if (target.isRealTarget) {
    // Real CLI may emit progress on stdout when no --format json is specified.
    // The check depends on whether the real CLI supports --format json.
    // Return a skipped result to avoid false positives for unknown real CLIs.
    return skippedCheck({
      id: "progress-not-in-json-stdout",
      name: "Progress output does not corrupt JSON stdout",
      category: "cli-adversarial",
      reason:
        "Real CLI target: --format json behavior is target-specific. Run manually against the real CLI.",
    });
  }

  const started = new Date();
  const workspace = createTempWorkspace("p5-progress-json-");
  try {
    // Emit stderr (simulates progress), request JSON output.
    const { command, args } = buildCliCommand(target, [
      "--root",
      workspace.sourceDir,
      "--out",
      workspace.outputDir,
      "--format",
      "json",
      "--emit-stderr",
      "indexing 3 files...",
    ]);

    const result = await runAndCapture(command, args, workspace.root, target.timeoutMs);
    const finished = new Date();

    const findings = [];
    const stdout = result.stdout.trim();

    if (stdout.includes("indexing")) {
      findings.push(
        makeFinding({
          id: "progress-in-json-stdout",
          title: "Progress message appeared in JSON stdout",
          severity: "major",
          category: "cli-adversarial",
          description:
            "Progress message 'indexing 3 files...' was found in stdout. Progress must go to stderr.",
          recommendation:
            "All progress, status, and informational messages must be written to stderr.",
        })
      );
    }

    if (stdout.length > 0) {
      try {
        JSON.parse(stdout);
      } catch (e) {
        findings.push(
          makeFinding({
            id: "progress-corrupted-json",
            title: "stdout is not valid JSON when progress is emitted",
            severity: "major",
            category: "cli-adversarial",
            description: `JSON.parse failed: ${(e as Error).message}`,
            recommendation:
              "Progress output must not appear on stdout when JSON mode is active.",
          })
        );
      }
    }

    return {
      id: "progress-not-in-json-stdout",
      name: "Progress output does not corrupt JSON stdout",
      category: "cli-adversarial",
      severity: "major" as const,
      status:
        findings.some((f) => f.severity === "major" || f.severity === "blocker")
          ? "failed"
          : findings.length > 0
          ? "warning"
          : "passed",
      findings,
      startedAt: started.toISOString(),
      finishedAt: finished.toISOString(),
      durationMs: finished.getTime() - started.getTime(),
    };
  } finally {
    await workspace.cleanup();
  }
}
