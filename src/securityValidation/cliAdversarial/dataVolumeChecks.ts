import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import type { SecurityCheckResult } from "../types.js";
import type { AdversarialCliTarget } from "./adversarialCliConfig.js";
import { buildCliCommand } from "./adversarialCliConfig.js";
import { makeFinding, runAdversarialCheck } from "./runAdversarialCheck.js";
import { createTempWorkspace, diffSnapshots, snapshotDir } from "./tempWorkspace.js";

// ---------------------------------------------------------------------------
// Data-volume smoke checks
//
// Verifies that the CLI handles unusually large inputs without crashing
// or corrupting source files. Tests are bounded to stay CI-fast.
//
// Smoke-level targets:
//   - Large source file: 5,000 lines (≈ 100KB)
//   - Many files: 100 source files in the workspace
//   - Deeply nested directory: 10 levels of subdirectories
// ---------------------------------------------------------------------------

const LARGE_FILE_LINES = 5_000;
const MANY_FILES_COUNT = 100;
const DEEP_NESTING_LEVELS = 10;

function generateLargeFileContent(lineCount: number): string {
  const lines: string[] = [];
  for (let i = 0; i < lineCount; i++) {
    lines.push(`export const value_${i} = ${i}; // line ${i} of large file`);
  }
  return lines.join("\n") + "\n";
}

function populateManyFiles(dir: string, count: number): void {
  mkdirSync(dir, { recursive: true });
  for (let i = 0; i < count; i++) {
    const filename = `module_${String(i).padStart(4, "0")}.ts`;
    writeFileSync(
      path.join(dir, filename),
      `export const id = ${i};\nexport function fn_${i}() { return id; }\n`,
      "utf8"
    );
  }
}

function populateDeepNesting(baseDir: string, levels: number): void {
  let current = baseDir;
  for (let i = 0; i < levels; i++) {
    current = path.join(current, `level_${i}`);
    mkdirSync(current, { recursive: true });
    writeFileSync(
      path.join(current, `deep_${i}.ts`),
      `export const depth = ${i};\n`,
      "utf8"
    );
  }
}

// ---------------------------------------------------------------------------
// Exported checks
// ---------------------------------------------------------------------------

/**
 * Checks that the CLI handles a workspace with a large source file (5,000 lines)
 * without hanging, crashing, or modifying the source file.
 */
export async function checkHugeSourceFile(
  target: AdversarialCliTarget
): Promise<SecurityCheckResult> {
  const workspace = createTempWorkspace("p5-large-file-");
  try {
    // Place a large file in the source directory.
    const largeFilePath = path.join(workspace.sourceDir, "large-module.ts");
    writeFileSync(largeFilePath, generateLargeFileContent(LARGE_FILE_LINES), "utf8");

    const beforeSource = snapshotDir(workspace.sourceDir);

    const { command, args } = buildCliCommand(target, [
      "--root",
      workspace.sourceDir,
      "--out",
      workspace.outputDir,
    ]);

    return await runAdversarialCheck({
      id: "huge-source-file",
      name: `Large source file (${LARGE_FILE_LINES} lines) is handled safely`,
      category: "cli-adversarial",
      severity: "major",
      command,
      args,
      cwd: workspace.root,
      timeoutMs: target.timeoutMs,
      evaluate: () => {
        const afterSource = snapshotDir(workspace.sourceDir);
        const diff = diffSnapshots(beforeSource, afterSource);
        const problems = [...diff.modified, ...diff.removed];
        if (problems.length > 0) {
          return [
            makeFinding({
              id: "large-file-source-modified",
              title: "Source files were modified while processing a large file",
              severity: "blocker",
              category: "cli-adversarial",
              description: `Source files modified: ${problems.join(", ")}`,
              affectedFiles: problems,
              recommendation:
                "CLI must treat large source files as read-only, same as any other source file.",
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
 * Checks that the CLI handles a workspace with many files (100 source files)
 * without crashing or corrupting source files.
 */
export async function checkManyFiles(
  target: AdversarialCliTarget
): Promise<SecurityCheckResult> {
  const workspace = createTempWorkspace("p5-many-files-");
  try {
    // Add many files to the source directory.
    populateManyFiles(workspace.sourceDir, MANY_FILES_COUNT);

    const beforeSource = snapshotDir(workspace.sourceDir);

    const { command, args } = buildCliCommand(target, [
      "--root",
      workspace.sourceDir,
      "--out",
      workspace.outputDir,
    ]);

    return await runAdversarialCheck({
      id: "many-graph-nodes-edges",
      name: `Many files (${MANY_FILES_COUNT}) in workspace are handled safely`,
      category: "cli-adversarial",
      severity: "major",
      command,
      args,
      cwd: workspace.root,
      timeoutMs: target.timeoutMs,
      evaluate: () => {
        const afterSource = snapshotDir(workspace.sourceDir);
        const diff = diffSnapshots(beforeSource, afterSource);
        const problems = [...diff.modified, ...diff.removed];
        if (problems.length > 0) {
          return [
            makeFinding({
              id: "many-files-source-modified",
              title: "Source files were modified in a many-file workspace",
              severity: "blocker",
              category: "cli-adversarial",
              description: `${problems.length} source files were modified or removed: ${problems.slice(0, 5).join(", ")}${problems.length > 5 ? " ..." : ""}`,
              affectedFiles: problems,
              recommendation:
                "CLI must treat all source files as read-only regardless of workspace size.",
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
 * Checks that the CLI handles a deeply nested directory structure safely.
 */
export async function checkDeeplyNestedSource(
  target: AdversarialCliTarget
): Promise<SecurityCheckResult> {
  const workspace = createTempWorkspace("p5-deep-nest-");
  try {
    // Add deeply nested directories to the source directory.
    populateDeepNesting(workspace.sourceDir, DEEP_NESTING_LEVELS);

    const beforeSource = snapshotDir(workspace.sourceDir);

    const { command, args } = buildCliCommand(target, [
      "--root",
      workspace.sourceDir,
      "--out",
      workspace.outputDir,
    ]);

    return await runAdversarialCheck({
      id: "deeply-nested-tsx",
      name: `Deeply nested source (${DEEP_NESTING_LEVELS} levels) is handled safely`,
      category: "cli-adversarial",
      severity: "minor",
      command,
      args,
      cwd: workspace.root,
      timeoutMs: target.timeoutMs,
      evaluate: () => {
        const afterSource = snapshotDir(workspace.sourceDir);
        const diff = diffSnapshots(beforeSource, afterSource);
        const problems = [...diff.modified, ...diff.removed];
        if (problems.length > 0) {
          return [
            makeFinding({
              id: "deep-nest-source-modified",
              title: "Source files were modified in a deeply nested workspace",
              severity: "blocker",
              category: "cli-adversarial",
              description: `Source files modified: ${problems.join(", ")}`,
              affectedFiles: problems,
              recommendation:
                "CLI must treat deeply nested source directories as read-only.",
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
