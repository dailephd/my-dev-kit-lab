import { spawn } from "node:child_process";
import path from "node:path";
import type { SecurityCheckResult } from "../types.js";
import type { AdversarialCliTarget } from "./adversarialCliConfig.js";
import { buildCliCommand } from "./adversarialCliConfig.js";
import { makeFinding } from "./runAdversarialCheck.js";
import { createTempWorkspace, diffSnapshots, snapshotDir } from "./tempWorkspace.js";

// ---------------------------------------------------------------------------
// Subprocess safety checks
//
// Verifies that:
//   - CLI arguments with shell metacharacters are treated as literal strings
//   - No command injection occurs via path arguments
//   - DOT label generation handles special characters safely
//
// The harness itself uses spawn with shell:false, so this layer tests the CLI
// binary's behavior, not the harness behavior.
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

// Metacharacters that would be interpreted by a shell if the CLI used shell:true.
const METACHAR_PATHS = [
  { value: `path;echo injected`, label: "semicolon" },
  { value: `path&echo injected`, label: "ampersand" },
  { value: `path$(echo injected)`, label: "command substitution" },
  { value: `path\`echo injected\``, label: "backtick substitution" },
];

/**
 * Checks that paths with shell metacharacters are passed as literal strings
 * and do not trigger command injection via the CLI invocation.
 *
 * The harness invokes the CLI with shell:false, so metacharacters in the
 * path argument array are always literal. This check verifies that the CLI
 * itself does not re-interpret path arguments through a shell.
 */
export async function checkSubprocessNoShellInterpolation(
  target: AdversarialCliTarget
): Promise<SecurityCheckResult> {
  const started = new Date();
  const workspace = createTempWorkspace("p5-shell-");
  try {
    const findings = [];

    for (const { value: metacharPath, label } of METACHAR_PATHS) {
      const beforeOutside = snapshotDir(workspace.outsideDir);

      // Use the metachar path as the --root argument.
      // Since the path likely doesn't exist, the CLI may exit non-zero.
      // What matters is: no shell side effects (no "injected" written anywhere).
      const injectedFile = path.join(workspace.root, "injected");

      const { command, args } = buildCliCommand(target, [
        "--root",
        path.join(workspace.sourceDir, metacharPath),
        "--out",
        workspace.outputDir,
      ]);

      await runAndCapture(command, args, workspace.root, target.timeoutMs);

      // If shell injection worked, "injected" might be created.
      const { existsSync } = await import("node:fs");
      if (existsSync(injectedFile)) {
        findings.push(
          makeFinding({
            id: `shell-injection-${label.replace(/\s+/g, "-")}`,
            title: `Shell injection via ${label} in --root`,
            severity: "blocker",
            category: "cli-adversarial",
            description: `Shell injection via ${label}: file 'injected' was created, suggesting shell interpolation occurred.`,
            affectedFiles: [injectedFile],
            recommendation:
              "CLI must never pass path arguments through a shell. Use spawn argument arrays only.",
          })
        );
      }

      // Also check that outsideDir was not affected.
      const afterOutside = snapshotDir(workspace.outsideDir);
      const outsideDiff = diffSnapshots(beforeOutside, afterOutside);
      if (outsideDiff.added.length > 0 || outsideDiff.modified.length > 0) {
        findings.push(
          makeFinding({
            id: `shell-injection-outside-${label.replace(/\s+/g, "-")}`,
            title: `Unexpected writes outside workspace for ${label} path`,
            severity: "major",
            category: "cli-adversarial",
            description: `${label} in --root caused writes outside the workspace.`,
            recommendation:
              "Path arguments with metacharacters must be treated as literal strings.",
          })
        );
      }
    }

    const finished = new Date();
    return {
      id: "subprocess-no-shell-interpolation",
      name: "Subprocess calls avoid shell-string interpolation for metachar paths",
      category: "cli-adversarial",
      severity: "blocker" as const,
      status:
        findings.some((f) => f.severity === "blocker" || f.severity === "major")
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
 * DOT label escaping test cases.
 * Each case is a node name that would produce broken DOT syntax if unescaped.
 */
export const DOT_LABEL_TEST_CASES = [
  { id: "double-quote", value: 'foo"bar', description: 'Double quote in label' },
  { id: "backslash", value: "foo\\bar", description: "Backslash in label" },
  { id: "angle-brackets", value: "foo<bar>", description: "Angle brackets in label" },
  { id: "curly-braces", value: "foo{bar}", description: "Curly braces in label" },
  { id: "pipe", value: "foo|bar", description: "Pipe character in label" },
  { id: "newline", value: "foo\nbar", description: "Newline in label" },
];

/**
 * Generates a minimal DOT-safe label from a raw string.
 * This mirrors what a correct DOT label escaper should do.
 */
export function escapeDotLabel(raw: string): string {
  return raw
    .replace(/\\/g, "\\\\")
    .replace(/"/g, '\\"')
    .replace(/\n/g, "\\n")
    .replace(/\r/g, "\\r")
    .replace(/[<>{}|]/g, (c) => `\\${c}`);
}

/**
 * Checks that DOT label escaping handles all special characters correctly.
 * This is a pure logic check — does not invoke the CLI.
 */
export async function checkDotLabelEscaping(): Promise<SecurityCheckResult> {
  const started = new Date();
  const findings = [];

  for (const { id, value, description } of DOT_LABEL_TEST_CASES) {
    const escaped = escapeDotLabel(value);

    // A valid escaped label must not contain unescaped special chars.
    // We verify the escaper produces output that differs from the input for problematic chars.
    if (value.includes('"') && escaped === value) {
      findings.push(
        makeFinding({
          id: `dot-label-${id}`,
          title: `DOT label escaper did not escape: ${description}`,
          severity: "major",
          category: "cli-adversarial",
          description: `Label '${value}' was not escaped. This would produce broken DOT syntax.`,
          recommendation: "All special characters in DOT labels must be properly escaped.",
        })
      );
    }

    // Verify the escaped label can be safely embedded in a DOT node declaration.
    const dotSnippet = `"${escaped}"`;
    // A correct snippet must not have unescaped double-quotes inside (except the wrappers).
    const inner = dotSnippet.slice(1, -1);
    const hasUnescapedQuote = inner.replace(/\\"/g, "").includes('"');
    if (hasUnescapedQuote) {
      findings.push(
        makeFinding({
          id: `dot-label-unescaped-${id}`,
          title: `DOT label contains unescaped double quote after escaping: ${description}`,
          severity: "major",
          category: "cli-adversarial",
          description: `Escaped value '${escaped}' still contains an unescaped double-quote.`,
          recommendation: "Double-quotes inside DOT labels must be escaped as \\\".",
        })
      );
    }
  }

  const finished = new Date();
  return {
    id: "graphviz-label-escaping",
    name: "Graph labels escape special characters correctly",
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
}
