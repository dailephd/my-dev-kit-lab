import { spawn } from "node:child_process";
import path from "node:path";
import type { SecurityCheckResult } from "../types.js";
import type { AdversarialCliTarget } from "./adversarialCliConfig.js";
import { buildCliCommand } from "./adversarialCliConfig.js";
import { makeFinding, runAdversarialCheck } from "./runAdversarialCheck.js";
import { createTempWorkspace, diffSnapshots, snapshotDir } from "./tempWorkspace.js";

// ---------------------------------------------------------------------------
// Source read-only boundary checks
// ---------------------------------------------------------------------------

/**
 * Checks that running the CLI does not modify any files in the --root directory.
 * All source files must have the same content before and after the CLI run.
 */
export async function checkSourceFilesNotModified(
  target: AdversarialCliTarget
): Promise<SecurityCheckResult> {
  const workspace = createTempWorkspace("p4-ro-");
  try {
    const beforeSource = snapshotDir(workspace.sourceDir);

    const { command, args } = buildCliCommand(target, [
      "--root",
      workspace.sourceDir,
      "--out",
      workspace.outputDir,
    ]);

    return await runAdversarialCheck({
      id: "source-files-not-modified",
      name: "Source files are not modified during CLI run",
      category: "cli-adversarial",
      severity: "blocker",
      command,
      args,
      cwd: workspace.root,
      timeoutMs: target.timeoutMs,
      evaluate: () => {
        const afterSource = snapshotDir(workspace.sourceDir);
        const diff = diffSnapshots(beforeSource, afterSource);

        const problems = [
          ...diff.modified.map((f) => `modified: ${f}`),
          ...diff.removed.map((f) => `removed: ${f}`),
        ];

        if (problems.length > 0) {
          return [
            makeFinding({
              id: "source-modified",
              title: "Source files were modified by CLI",
              severity: "blocker",
              category: "cli-adversarial",
              description: `CLI modified or deleted source files: ${problems.join(", ")}`,
              affectedFiles: [...diff.modified, ...diff.removed],
              recommendation:
                "CLI must treat --root as read-only. No writes should go to the source directory.",
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
 * Checks that all writes by the CLI are confined to the declared --out directory.
 * No new files should appear in the source directory or outside the workspace.
 */
export async function checkWritesLimitedToOutput(
  target: AdversarialCliTarget
): Promise<SecurityCheckResult> {
  const workspace = createTempWorkspace("p4-wlt-");
  try {
    const beforeSource = snapshotDir(workspace.sourceDir);
    const beforeOutside = snapshotDir(workspace.outsideDir);

    const { command, args } = buildCliCommand(target, [
      "--root",
      workspace.sourceDir,
      "--out",
      workspace.outputDir,
    ]);

    return await runAdversarialCheck({
      id: "writes-limited-to-output",
      name: "All CLI writes are confined to the declared output directory",
      category: "cli-adversarial",
      severity: "blocker",
      command,
      args,
      cwd: workspace.root,
      timeoutMs: target.timeoutMs,
      evaluate: () => {
        const findings = [];

        // Check source dir: no new files, no modifications.
        const afterSource = snapshotDir(workspace.sourceDir);
        const sourceDiff = diffSnapshots(beforeSource, afterSource);
        const sourceProblems = [
          ...sourceDiff.added.map((f) => `added: ${f}`),
          ...sourceDiff.modified.map((f) => `modified: ${f}`),
        ];
        if (sourceProblems.length > 0) {
          findings.push(
            makeFinding({
              id: "write-in-source-dir",
              title: "CLI wrote files into the source directory",
              severity: "blocker",
              category: "cli-adversarial",
              description: `Unexpected writes in source dir: ${sourceProblems.join(", ")}`,
              affectedFiles: [...sourceDiff.added, ...sourceDiff.modified],
              recommendation: "CLI writes must never go to --root source directory.",
            })
          );
        }

        // Check outside dir: nothing should appear there.
        const afterOutside = snapshotDir(workspace.outsideDir);
        const outsideDiff = diffSnapshots(beforeOutside, afterOutside);
        const outsideProblems = [
          ...outsideDiff.added.map((f) => `added: ${f}`),
          ...outsideDiff.modified.map((f) => `modified: ${f}`),
        ];
        if (outsideProblems.length > 0) {
          findings.push(
            makeFinding({
              id: "write-outside-workspace",
              title: "CLI wrote files outside the workspace",
              severity: "blocker",
              category: "cli-adversarial",
              description: `Unexpected writes outside workspace: ${outsideProblems.join(", ")}`,
              affectedFiles: [...outsideDiff.added, ...outsideDiff.modified],
              recommendation:
                "CLI must confine all writes to explicitly declared artifact directories.",
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
 * Checks that running the CLI with --index does not modify source files
 * and does confine writes to the index directory.
 */
export async function checkIndexWriteContainment(
  target: AdversarialCliTarget
): Promise<SecurityCheckResult> {
  const workspace = createTempWorkspace("p4-idx-ro-");
  try {
    const beforeSource = snapshotDir(workspace.sourceDir);
    const beforeOutside = snapshotDir(workspace.outsideDir);

    const { command, args } = buildCliCommand(target, [
      "--root",
      workspace.sourceDir,
      "--index",
      workspace.indexDir,
    ]);

    return await runAdversarialCheck({
      id: "index-write-containment",
      name: "CLI index writes are confined to the declared index directory",
      category: "cli-adversarial",
      severity: "blocker",
      command,
      args,
      cwd: workspace.root,
      timeoutMs: target.timeoutMs,
      evaluate: () => {
        const findings = [];

        const afterSource = snapshotDir(workspace.sourceDir);
        const sourceDiff = diffSnapshots(beforeSource, afterSource);
        const sourceWrites = [...sourceDiff.added, ...sourceDiff.modified];
        if (sourceWrites.length > 0) {
          findings.push(
            makeFinding({
              id: "index-write-in-source",
              title: "Index operation modified source files",
              severity: "blocker",
              category: "cli-adversarial",
              description: `Source files modified: ${sourceWrites.join(", ")}`,
              affectedFiles: sourceWrites,
              recommendation: "Index operation must never write to the source root directory.",
            })
          );
        }

        const afterOutside = snapshotDir(workspace.outsideDir);
        const outsideDiff = diffSnapshots(beforeOutside, afterOutside);
        const outsideWrites = [...outsideDiff.added, ...outsideDiff.modified];
        if (outsideWrites.length > 0) {
          findings.push(
            makeFinding({
              id: "index-write-outside",
              title: "Index operation wrote outside the workspace",
              severity: "blocker",
              category: "cli-adversarial",
              description: `Writes outside workspace: ${outsideWrites.join(", ")}`,
              affectedFiles: outsideWrites,
              recommendation: "Index writes must be confined to the declared --index path.",
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
 * Checks that a simulated artifact refresh/re-index does not delete user source files.
 * Runs the CLI twice and verifies source files survive both runs unchanged.
 */
export async function checkArtifactCleanupSafe(
  target: AdversarialCliTarget
): Promise<SecurityCheckResult> {
  const workspace = createTempWorkspace("p4-cleanup-");
  try {
    // First run — populate output directory.
    const { command: cmd1, args: args1 } = buildCliCommand(target, [
      "--root",
      workspace.sourceDir,
      "--out",
      workspace.outputDir,
    ]);

    await spawnAndWait(cmd1, args1, workspace.root);

    // Snapshot source AFTER first run (baseline for cleanup test).
    const beforeSource = snapshotDir(workspace.sourceDir);
    const beforeOutside = snapshotDir(workspace.outsideDir);

    // Second run — simulates artifact refresh.
    const { command, args } = buildCliCommand(target, [
      "--root",
      workspace.sourceDir,
      "--out",
      workspace.outputDir,
    ]);

    return await runAdversarialCheck({
      id: "generated-cleanup-user-files",
      name: "Generated artifact refresh does not delete user source files",
      category: "artifact-safety",
      severity: "blocker",
      command,
      args,
      cwd: workspace.root,
      timeoutMs: target.timeoutMs,
      evaluate: () => {
        const findings = [];

        const afterSource = snapshotDir(workspace.sourceDir);
        const sourceDiff = diffSnapshots(beforeSource, afterSource);

        const deletedSource = sourceDiff.removed;
        if (deletedSource.length > 0) {
          findings.push(
            makeFinding({
              id: "cleanup-deleted-source",
              title: "Artifact refresh deleted user source files",
              severity: "blocker",
              category: "artifact-safety",
              description: `Source files deleted during refresh: ${deletedSource.join(", ")}`,
              affectedFiles: deletedSource,
              recommendation:
                "Generated artifact cleanup must be scoped to the declared output/index path only.",
            })
          );
        }

        const modifiedSource = sourceDiff.modified;
        if (modifiedSource.length > 0) {
          findings.push(
            makeFinding({
              id: "cleanup-modified-source",
              title: "Artifact refresh modified user source files",
              severity: "blocker",
              category: "artifact-safety",
              description: `Source files modified during refresh: ${modifiedSource.join(", ")}`,
              affectedFiles: modifiedSource,
              recommendation: "Artifact refresh must never write to the source directory.",
            })
          );
        }

        const afterOutside = snapshotDir(workspace.outsideDir);
        const outsideDiff = diffSnapshots(beforeOutside, afterOutside);
        if (outsideDiff.modified.length > 0 || outsideDiff.removed.length > 0) {
          findings.push(
            makeFinding({
              id: "cleanup-outside-impact",
              title: "Artifact refresh affected files outside workspace",
              severity: "blocker",
              category: "artifact-safety",
              description: `Files outside workspace were affected during refresh: ${[...outsideDiff.modified, ...outsideDiff.removed].join(", ")}`,
              recommendation: "Refresh cleanup must be strictly scoped to output directories.",
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

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

function spawnAndWait(command: string, args: string[], cwd: string): Promise<void> {
  return new Promise<void>((resolve) => {
    let child;
    try {
      child = spawn(command, args, {
        cwd,
        shell: false,
        stdio: ["ignore", "ignore", "ignore"],
        env: { ...process.env },
      });
    } catch {
      resolve();
      return;
    }
    child.on("close", () => resolve());
    child.on("error", () => resolve());
  });
}
