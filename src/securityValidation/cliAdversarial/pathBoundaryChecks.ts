import { spawn } from "node:child_process";
import path from "node:path";
import type { SecurityCheckResult } from "../types.js";
import type { AdversarialCliTarget } from "./adversarialCliConfig.js";
import { buildCliCommand } from "./adversarialCliConfig.js";
import type { PathTestInput } from "./pathCases.js";
import { makeFinding, runAdversarialCheck, skippedCheck } from "./runAdversarialCheck.js";
import { createTempWorkspace, diffSnapshots, snapshotDir } from "./tempWorkspace.js";

// ---------------------------------------------------------------------------
// Path traversal checks
// ---------------------------------------------------------------------------

/**
 * Checks that a path traversal input to --root does not allow reads or writes
 * outside the declared workspace boundary.
 *
 * The check runs the fake (or real) CLI with a traversal path as --root and
 * verifies no files escaped the temp workspace.
 */
export async function checkRootPathTraversal(
  target: AdversarialCliTarget,
  testInput: PathTestInput
): Promise<SecurityCheckResult> {
  const workspace = createTempWorkspace("p4-root-");
  try {
    const beforeOutside = snapshotDir(workspace.outsideDir);

    const { command, args } = buildCliCommand(target, [
      "--root",
      testInput.value,
      "--out",
      workspace.outputDir,
    ]);

    const result = await runAdversarialCheck({
      id: `path-traversal-root-${testInput.id}`,
      name: `Path traversal via --root: ${testInput.description}`,
      category: "cli-adversarial",
      severity: "blocker",
      command,
      args,
      cwd: workspace.root,
      timeoutMs: target.timeoutMs,
      evaluate: (cmdResult) => {
        const findings = [];
        // Check 1: No files appeared in the outside sentinel dir.
        const afterOutside = snapshotDir(workspace.outsideDir);
        const outsideDiff = diffSnapshots(beforeOutside, afterOutside);
        if (outsideDiff.added.length > 0 || outsideDiff.modified.length > 0) {
          findings.push(
            makeFinding({
              id: `path-traversal-root-${testInput.id}-escape`,
              title: "Write escaped workspace via --root traversal",
              severity: "blocker",
              category: "cli-adversarial",
              description: `CLI wrote files outside workspace: ${outsideDiff.added.join(", ")}`,
              evidence: `command: ${[cmdResult.command, ...cmdResult.args].join(" ")}`,
              recommendation: "Validate --root argument against an allowed prefix before use.",
            })
          );
        }
        // Spawn error is informational only — traversal to a non-existent path is expected.
        return findings;
      },
    });

    return result;
  } finally {
    await workspace.cleanup();
  }
}

/**
 * Checks that a path traversal input to --out does not write outside the workspace.
 */
export async function checkOutPathTraversal(
  target: AdversarialCliTarget,
  testInput: PathTestInput
): Promise<SecurityCheckResult> {
  const workspace = createTempWorkspace("p4-out-");
  try {
    const beforeOutside = snapshotDir(workspace.outsideDir);

    // Build an escaped --out path that points outside the workspace.
    // We use the actual outsideDir path so we can check for writes there.
    const escapedOut = testInput.value.startsWith("/") || /^[A-Za-z]:\\/.test(testInput.value)
      ? testInput.value  // absolute path given in test input
      : path.resolve(workspace.outputDir, testInput.value); // resolve relative from output

    const { command, args } = buildCliCommand(target, [
      "--root",
      workspace.sourceDir,
      "--out",
      escapedOut,
    ]);

    const result = await runAdversarialCheck({
      id: `path-traversal-out-${testInput.id}`,
      name: `Path traversal via --out: ${testInput.description}`,
      category: "cli-adversarial",
      severity: "blocker",
      command,
      args,
      cwd: workspace.root,
      timeoutMs: target.timeoutMs,
      evaluate: (cmdResult) => {
        const findings = [];
        const afterOutside = snapshotDir(workspace.outsideDir);
        const outsideDiff = diffSnapshots(beforeOutside, afterOutside);
        if (outsideDiff.added.length > 0 || outsideDiff.modified.length > 0) {
          findings.push(
            makeFinding({
              id: `path-traversal-out-${testInput.id}-escape`,
              title: "Write escaped workspace via --out traversal",
              severity: "blocker",
              category: "cli-adversarial",
              description: `CLI wrote outside workspace: ${outsideDiff.added.join(", ")}`,
              evidence: `--out value: ${escapedOut}, stdout: ${cmdResult.stdout.slice(0, 200)}`,
              recommendation: "Validate --out argument is within an allowed prefix before writing.",
            })
          );
        }
        return findings;
      },
    });

    return result;
  } finally {
    await workspace.cleanup();
  }
}

/**
 * Checks that a path traversal input to --index does not allow writes outside workspace.
 */
export async function checkIndexPathTraversal(
  target: AdversarialCliTarget,
  testInput: PathTestInput
): Promise<SecurityCheckResult> {
  const workspace = createTempWorkspace("p4-idx-");
  try {
    const beforeOutside = snapshotDir(workspace.outsideDir);

    const escapedIndex = testInput.value.startsWith("/") || /^[A-Za-z]:\\/.test(testInput.value)
      ? testInput.value
      : path.resolve(workspace.indexDir, testInput.value);

    const { command, args } = buildCliCommand(target, [
      "--root",
      workspace.sourceDir,
      "--index",
      escapedIndex,
    ]);

    const result = await runAdversarialCheck({
      id: `path-traversal-index-${testInput.id}`,
      name: `Path traversal via --index: ${testInput.description}`,
      category: "cli-adversarial",
      severity: "blocker",
      command,
      args,
      cwd: workspace.root,
      timeoutMs: target.timeoutMs,
      evaluate: (cmdResult) => {
        const findings = [];
        const afterOutside = snapshotDir(workspace.outsideDir);
        const outsideDiff = diffSnapshots(beforeOutside, afterOutside);
        if (outsideDiff.added.length > 0 || outsideDiff.modified.length > 0) {
          findings.push(
            makeFinding({
              id: `path-traversal-index-${testInput.id}-escape`,
              title: "Write escaped workspace via --index traversal",
              severity: "blocker",
              category: "cli-adversarial",
              description: `CLI wrote outside workspace: ${outsideDiff.added.join(", ")}`,
              evidence: `--index value: ${escapedIndex}, stdout: ${cmdResult.stdout.slice(0, 200)}`,
              recommendation: "Validate --index argument is within an allowed prefix.",
            })
          );
        }
        return findings;
      },
    });

    return result;
  } finally {
    await workspace.cleanup();
  }
}

// ---------------------------------------------------------------------------
// Safe path handling checks
// ---------------------------------------------------------------------------

/**
 * Runs the CLI with a path containing spaces and verifies it succeeds.
 * Safe paths with spaces must not cause crashes or spawn failures.
 */
export async function checkPathWithSpaces(
  target: AdversarialCliTarget
): Promise<SecurityCheckResult> {
  const workspace = createTempWorkspace("p4-spaces-");
  try {
    // Create a subdirectory with a space in its name.
    const spacedOut = path.join(workspace.outputDir, "output with spaces");

    const { command, args } = buildCliCommand(target, [
      "--root",
      workspace.sourceDir,
      "--out",
      spacedOut,
    ]);

    return await runAdversarialCheck({
      id: "path-with-spaces",
      name: "Paths with spaces are handled as literal strings",
      category: "cli-adversarial",
      severity: "major",
      command,
      args,
      cwd: workspace.root,
      timeoutMs: target.timeoutMs,
      evaluate: (cmdResult) => {
        if (cmdResult.spawnError) {
          return [
            makeFinding({
              id: "path-spaces-spawn-error",
              title: "CLI spawn failed for path with spaces",
              severity: "major",
              category: "cli-adversarial",
              description: `Spawn error: ${cmdResult.spawnError}`,
              recommendation: "Ensure CLI invocation uses argument arrays, not shell strings.",
            }),
          ];
        }
        // Non-zero exit for a path-with-spaces input is a finding.
        if (cmdResult.exitCode !== 0 && !cmdResult.timedOut) {
          return [
            makeFinding({
              id: "path-spaces-exit-nonzero",
              title: "CLI exited non-zero for path with spaces",
              severity: "major",
              category: "cli-adversarial",
              description: `Exit code: ${cmdResult.exitCode}, stderr: ${cmdResult.stderr.slice(0, 300)}`,
              recommendation: "Spaces in paths must be handled as literal characters.",
            }),
          ];
        }
        return [];
      },
    });
  } finally {
    await workspace.cleanup();
  }
}

/**
 * Checks that the CLI handles Unicode in output path correctly (no crash).
 */
export async function checkUnicodePath(
  target: AdversarialCliTarget,
  unicodeSubdir: string
): Promise<SecurityCheckResult> {
  const workspace = createTempWorkspace("p4-unicode-");
  try {
    const unicodeOut = path.join(workspace.outputDir, unicodeSubdir);

    const { command, args } = buildCliCommand(target, [
      "--root",
      workspace.sourceDir,
      "--out",
      unicodeOut,
    ]);

    return await runAdversarialCheck({
      id: `unicode-path-${unicodeSubdir.replace(/[^a-z0-9]/gi, "-")}`,
      name: `Unicode path handling: "${unicodeSubdir}"`,
      category: "cli-adversarial",
      severity: "minor",
      command,
      args,
      cwd: workspace.root,
      timeoutMs: target.timeoutMs,
      evaluate: (cmdResult) => {
        if (cmdResult.spawnError) {
          return [
            makeFinding({
              id: `unicode-spawn-error-${unicodeSubdir}`,
              title: "CLI spawn failed for Unicode path",
              severity: "minor",
              category: "cli-adversarial",
              description: `Spawn error with Unicode path "${unicodeSubdir}": ${cmdResult.spawnError}`,
              recommendation: "Ensure CLI handles Unicode paths without platform-specific crashes.",
            }),
          ];
        }
        return [];
      },
    });
  } finally {
    await workspace.cleanup();
  }
}

/**
 * Checks that the CLI handles an absolute path that stays within
 * the temp workspace correctly (safe absolute paths should work).
 */
export async function checkSafeAbsolutePath(
  target: AdversarialCliTarget
): Promise<SecurityCheckResult> {
  const workspace = createTempWorkspace("p4-abs-");
  try {
    // Use the outputDir by its absolute path (should be accepted).
    const { command, args } = buildCliCommand(target, [
      "--root",
      path.resolve(workspace.sourceDir),
      "--out",
      path.resolve(workspace.outputDir),
    ]);

    return await runAdversarialCheck({
      id: "safe-absolute-path",
      name: "Safe absolute path within workspace is accepted",
      category: "cli-adversarial",
      severity: "informational",
      command,
      args,
      cwd: workspace.root,
      timeoutMs: target.timeoutMs,
      evaluate: (cmdResult) => {
        if (cmdResult.spawnError) {
          return [
            makeFinding({
              id: "safe-abs-spawn-error",
              title: "CLI spawn failed for safe absolute path",
              severity: "minor",
              category: "cli-adversarial",
              description: `Spawn error: ${cmdResult.spawnError}`,
              recommendation: "Investigate CLI invocation for absolute path handling.",
            }),
          ];
        }
        return [];
      },
    });
  } finally {
    await workspace.cleanup();
  }
}

// ---------------------------------------------------------------------------
// Harness escape detection (infrastructure test)
// ---------------------------------------------------------------------------

/**
 * Uses fake-adversarial-cli --escape-to to verify the harness correctly
 * detects writes that land outside the declared output directory.
 *
 * This is a harness SELF-TEST, not a test of the real CLI.
 * Only runs against the fake CLI target.
 */
export async function checkHarnessEscapeDetection(
  target: AdversarialCliTarget
): Promise<SecurityCheckResult> {
  if (target.isRealTarget) {
    return skippedCheck({
      id: "harness-escape-detection",
      name: "Harness escape detection self-test",
      category: "cli-adversarial",
      reason: "Escape detection self-test only runs against the fake CLI fixture.",
    });
  }

  const workspace = createTempWorkspace("p4-escape-");
  try {
    const beforeOutside = snapshotDir(workspace.outsideDir);

    // Run fake CLI with --escape-to pointing to outsideDir.
    const { command, args } = buildCliCommand(target, [
      "--root",
      workspace.sourceDir,
      "--out",
      workspace.outputDir,
      "--escape-to",
      workspace.outsideDir,
    ]);

    const cmdResult = await runAndCaptureRaw(command, args, workspace.root, target.timeoutMs);
    const afterOutside = snapshotDir(workspace.outsideDir);
    const outsideDiff = diffSnapshots(beforeOutside, afterOutside);

    // We EXPECT the escape to be detected (fake CLI wrote there intentionally).
    const now = new Date().toISOString();
    if (outsideDiff.added.length > 0 || outsideDiff.modified.length > 0) {
      // Detection works correctly: the harness saw the escape.
      return {
        id: "harness-escape-detection",
        name: "Harness escape detection self-test",
        category: "cli-adversarial",
        status: "passed",
        severity: "informational",
        startedAt: now,
        finishedAt: now,
        durationMs: cmdResult.durationMs,
        findings: [],
      };
    } else {
      // Escape not detected — harness detection infrastructure is broken.
      return {
        id: "harness-escape-detection",
        name: "Harness escape detection self-test",
        category: "cli-adversarial",
        status: "failed",
        severity: "major",
        startedAt: now,
        finishedAt: now,
        durationMs: cmdResult.durationMs,
        findings: [
          makeFinding({
            id: "harness-detection-broken",
            title: "Harness escape detection did not detect expected write",
            severity: "major",
            category: "cli-adversarial",
            description:
              "The fake CLI wrote to outsideDir but the harness did not detect it. " +
              "The file boundary detection mechanism may be broken.",
            recommendation: "Inspect snapshotDir and diffSnapshots logic.",
          }),
        ],
      };
    }
  } finally {
    await workspace.cleanup();
  }
}

async function runAndCaptureRaw(
  command: string,
  args: string[],
  cwd: string,
  timeoutMs: number
): Promise<{ durationMs: number }> {
  const started = Date.now();
  return new Promise((resolve) => {
    let settled = false;
    let timeout: NodeJS.Timeout | undefined;
    let child;
    try {
      child = spawn(command, args, {
        cwd,
        shell: false,
        stdio: ["ignore", "ignore", "ignore"],
        env: { ...process.env },
      });
    } catch {
      resolve({ durationMs: Date.now() - started });
      return;
    }
    if (timeoutMs > 0) {
      timeout = setTimeout(() => {
        try { child.kill(); } catch { /* ignore */ }
      }, timeoutMs);
    }
    child.on("close", () => {
      if (settled) return;
      settled = true;
      if (timeout) clearTimeout(timeout);
      resolve({ durationMs: Date.now() - started });
    });
    child.on("error", () => {
      if (settled) return;
      settled = true;
      if (timeout) clearTimeout(timeout);
      resolve({ durationMs: Date.now() - started });
    });
  });
}
