import { spawn } from "node:child_process";
import path from "node:path";
import type { SecurityCheckResult } from "../types.js";
import type { AdversarialCliTarget } from "./adversarialCliConfig.js";
import { buildCliCommand } from "./adversarialCliConfig.js";
import type { PathTestInput } from "./pathCases.js";
import { makeFinding, runAdversarialCheck, skippedCheck } from "./runAdversarialCheck.js";
import { createTempWorkspace, diffSnapshots, snapshotDir, snapshotTreeStrict } from "./tempWorkspace.js";
import type { TempWorkspace } from "./tempWorkspace.js";
import { classifyTraversalValue, proveContainment } from "./traversalContainment.js";

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
 * Shared mechanism for the --out and --index traversal checks.
 *
 * A traversing value is only handed to the CLI when its attempted destination
 * is proven (before launch) to stay inside a NEW disposable enclosure that
 * nests the workspace deep enough for the value. The whole enclosure is
 * snapshotted before and after the run, so a write to the ACTUAL attempted
 * destination is detected even when the unrelated outsideDir sentinel is
 * untouched. Values that cannot be confined are not executed and are reported
 * as skipped with a BLOCKED_BEFORE_LAUNCH reason, never as passed.
 */
type TraversalFlagConfig = {
  flag: "--out" | "--index";
  workspacePrefix: string;
  idStem: "path-traversal-out" | "path-traversal-index";
  nameStem: string;
  title: string;
  recommendation: string;
  declaredDir: (workspace: TempWorkspace) => string;
};

const OUT_TRAVERSAL: TraversalFlagConfig = {
  flag: "--out",
  workspacePrefix: "p4-out-",
  idStem: "path-traversal-out",
  nameStem: "Path traversal via --out",
  title: "Write escaped workspace via --out traversal",
  recommendation: "Validate --out argument is within an allowed prefix before writing.",
  declaredDir: (workspace) => workspace.outputDir,
};

const INDEX_TRAVERSAL: TraversalFlagConfig = {
  flag: "--index",
  workspacePrefix: "p4-idx-",
  idStem: "path-traversal-index",
  nameStem: "Path traversal via --index",
  title: "Write escaped workspace via --index traversal",
  recommendation: "Validate --index argument is within an allowed prefix.",
  declaredDir: (workspace) => workspace.indexDir,
};

function isUnder(relativePath: string, relativeDir: string): boolean {
  return relativePath === relativeDir || relativePath.startsWith(relativeDir + path.sep);
}

async function checkContainedTraversal(
  config: TraversalFlagConfig,
  target: AdversarialCliTarget,
  testInput: PathTestInput
): Promise<SecurityCheckResult> {
  const id = `${config.idStem}-${testInput.id}`;
  const name = `${config.nameStem}: ${testInput.description}`;
  const blocked = (reason: string): SecurityCheckResult =>
    skippedCheck({
      id,
      name,
      category: "cli-adversarial",
      reason: `BLOCKED_BEFORE_LAUNCH: ${reason}`,
    });

  const plan = classifyTraversalValue(testInput.value);
  if (plan.kind === "refused") return blocked(plan.reason);

  const workspace = createTempWorkspace(config.workspacePrefix, { nestDepth: plan.nestDepth });
  try {
    const enclosureDir = workspace.enclosureDir as string;
    const declaredDir = config.declaredDir(workspace);
    const proof = proveContainment({
      value: testInput.value,
      baseDir: declaredDir,
      enclosureDir,
      declaredDir,
    });
    if (!proof.ok) return blocked(proof.reason);

    let before;
    try {
      before = snapshotTreeStrict(enclosureDir);
    } catch (error) {
      return blocked(`enclosure is not inspectable before launch: ${error instanceof Error ? error.message : String(error)}`);
    }

    const { command, args } = buildCliCommand(target, [
      "--root",
      workspace.sourceDir,
      config.flag,
      proof.destination,
    ]);
    const allowedRelative = path.relative(proof.enclosure, proof.declared);

    return await runAdversarialCheck({
      id,
      name,
      category: "cli-adversarial",
      severity: "blocker",
      command,
      args,
      cwd: workspace.root,
      timeoutMs: target.timeoutMs,
      evaluate: (cmdResult) => {
        const findings = [];
        // A child that never produced an exit code (and did not time out) did
        // not execute; the runner reports asynchronous spawn failures this way.
        if (cmdResult.spawnError || (cmdResult.exitCode === null && !cmdResult.timedOut)) {
          findings.push(
            makeFinding({
              id: `${id}-not-executed`,
              title: `CLI did not run for ${config.flag} traversal check`,
              severity: "major",
              category: "cli-adversarial",
              description: `Spawn error: ${cmdResult.spawnError ?? cmdResult.stderr.slice(0, 200)}`,
              evidence: `${config.flag} value: ${proof.destination}`,
              recommendation: "Fix the CLI invocation so the traversal check actually executes.",
            })
          );
        }
        let after;
        try {
          after = snapshotTreeStrict(enclosureDir);
        } catch (error) {
          findings.push(
            makeFinding({
              id: `${id}-inspection-lost`,
              title: `Cannot inspect enclosure after ${config.flag} traversal`,
              severity: "blocker",
              category: "cli-adversarial",
              description: `Post-run snapshot failed: ${error instanceof Error ? error.message : String(error)}`,
              evidence: `${config.flag} value: ${proof.destination}`,
              recommendation: "Treat the traversal outcome as unknown; investigate before release.",
            })
          );
          return findings;
        }
        const diff = diffSnapshots(before, after);
        const outside = (list: string[]) => list.filter((rel) => !isUnder(rel, allowedRelative));
        const added = outside(diff.added);
        const modified = outside(diff.modified);
        const removed = outside(diff.removed);
        if (added.length + modified.length + removed.length > 0) {
          const changed = [...added, ...modified, ...removed].map((rel) => path.join(proof.enclosure, rel));
          findings.push(
            makeFinding({
              id: `${id}-escape`,
              title: config.title,
              severity: "blocker",
              category: "cli-adversarial",
              description:
                `CLI wrote outside workspace: added [${added.join(", ")}], modified [${modified.join(", ")}], removed [${removed.join(", ")}]`,
              evidence: `${config.flag} value: ${proof.destination}, stdout: ${cmdResult.stdout.slice(0, 200)}`,
              affectedFiles: changed,
              recommendation: config.recommendation,
            })
          );
        }
        return findings;
      },
    });
  } finally {
    await workspace.cleanup();
  }
}

/**
 * Checks that a path traversal input to --out does not write outside the declared output directory.
 */
export async function checkOutPathTraversal(
  target: AdversarialCliTarget,
  testInput: PathTestInput
): Promise<SecurityCheckResult> {
  return checkContainedTraversal(OUT_TRAVERSAL, target, testInput);
}

/**
 * Checks that a path traversal input to --index does not write outside the declared index directory.
 */
export async function checkIndexPathTraversal(
  target: AdversarialCliTarget,
  testInput: PathTestInput
): Promise<SecurityCheckResult> {
  return checkContainedTraversal(INDEX_TRAVERSAL, target, testInput);
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
