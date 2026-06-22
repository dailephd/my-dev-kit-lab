import path from "node:path";
import type { SecurityCheckResult } from "../types.js";
import type { AdversarialCliTarget } from "./adversarialCliConfig.js";
import { buildCliCommand } from "./adversarialCliConfig.js";
import {
  MALFORMED_CODE_GRAPH_CASES,
  MALFORMED_MANIFEST_CASES,
  UNSUPPORTED_SCHEMA_VERSION_CASES,
  placeMalformedCodeGraph,
  placeMalformedManifest,
  placeUnsupportedSchemaManifest,
} from "./malformedArtifactFixtures.js";
import { makeFinding, runAdversarialCheck } from "./runAdversarialCheck.js";
import { createTempWorkspace, diffSnapshots, snapshotDir } from "./tempWorkspace.js";

// ---------------------------------------------------------------------------
// Malformed artifact checks
//
// Each check pre-places a malformed artifact in the index directory, then
// runs the CLI against it. Expected behavior:
//   - Fake CLI: always writes a valid manifest.json on top → passes (baseline)
//   - Real CLI: either handles the malformed artifact safely or fails clearly
//
// In both cases, source files must remain unmodified.
// ---------------------------------------------------------------------------

/**
 * Checks that the CLI handles a pre-placed malformed manifest.json safely.
 * Runs one representative malformed case (truncated JSON) as the primary check.
 */
export async function checkMalformedManifest(
  target: AdversarialCliTarget
): Promise<SecurityCheckResult> {
  const workspace = createTempWorkspace("p5-mf-manifest-");
  try {
    // Pre-place the most adversarial malformed manifest.
    const testCase = MALFORMED_MANIFEST_CASES.find((c) => c.id === "truncated-json")!;
    placeMalformedManifest(workspace.indexDir, testCase.content);

    const beforeSource = snapshotDir(workspace.sourceDir);

    const { command, args } = buildCliCommand(target, [
      "--root",
      workspace.sourceDir,
      "--index",
      workspace.indexDir,
    ]);

    return await runAdversarialCheck({
      id: "malformed-manifest-json",
      name: "Malformed manifest.json is handled safely",
      category: "artifact-safety",
      severity: "major",
      command,
      args,
      cwd: workspace.root,
      timeoutMs: target.timeoutMs,
      evaluate: () => {
        const afterSource = snapshotDir(workspace.sourceDir);
        const sourceDiff = diffSnapshots(beforeSource, afterSource);
        const sourceProblems = [...sourceDiff.modified, ...sourceDiff.removed];
        if (sourceProblems.length > 0) {
          return [
            makeFinding({
              id: "malformed-manifest-source-modified",
              title: "Source files were modified while handling malformed manifest",
              severity: "blocker",
              category: "artifact-safety",
              description: `CLI modified source files while handling a malformed manifest: ${sourceProblems.join(", ")}`,
              affectedFiles: sourceProblems,
              recommendation:
                "CLI must not write to the source directory even when encountering malformed artifacts.",
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
 * Checks all malformed manifest cases in sequence.
 * Returns a single check result; any source modification is a finding.
 */
export async function checkAllMalformedManifestCases(
  target: AdversarialCliTarget
): Promise<SecurityCheckResult> {
  const workspace = createTempWorkspace("p5-mf-all-");
  try {
    const findings = [];
    for (const testCase of MALFORMED_MANIFEST_CASES) {
      placeMalformedManifest(workspace.indexDir, testCase.content);
      const beforeSource = snapshotDir(workspace.sourceDir);

      const { command, args } = buildCliCommand(target, [
        "--root",
        workspace.sourceDir,
        "--index",
        workspace.indexDir,
      ]);

      const result = await runAdversarialCheck({
        id: `malformed-manifest-${testCase.id}`,
        name: `Malformed manifest case: ${testCase.description}`,
        category: "artifact-safety",
        severity: "major",
        command,
        args,
        cwd: workspace.root,
        timeoutMs: target.timeoutMs,
        evaluate: () => {
          const afterSource = snapshotDir(workspace.sourceDir);
          const sourceDiff = diffSnapshots(beforeSource, afterSource);
          const sourceProblems = [...sourceDiff.modified, ...sourceDiff.removed];
          if (sourceProblems.length > 0) {
            return [
              makeFinding({
                id: `malformed-manifest-${testCase.id}-source-modified`,
                title: `Source modified for malformed manifest case: ${testCase.id}`,
                severity: "blocker",
                category: "artifact-safety",
                description: `Case '${testCase.id}': source files modified: ${sourceProblems.join(", ")}`,
                affectedFiles: sourceProblems,
                recommendation:
                  "Source directory must remain read-only even with malformed artifacts.",
              }),
            ];
          }
          return [];
        },
      });

      findings.push(...result.findings);
    }

    // Return a summary check result.
    return {
      id: "malformed-manifest-all-cases",
      name: "All malformed manifest cases handled safely",
      category: "artifact-safety",
      severity: "major" as const,
      status: findings.some((f) => f.severity === "blocker" || f.severity === "major")
        ? "failed"
        : findings.length > 0
        ? "warning"
        : "passed",
      findings,
      startedAt: new Date().toISOString(),
      finishedAt: new Date().toISOString(),
      durationMs: 0,
    };
  } finally {
    await workspace.cleanup();
  }
}

/**
 * Checks that the CLI handles a pre-placed malformed code-graph.json safely.
 */
export async function checkMalformedCodeGraph(
  target: AdversarialCliTarget
): Promise<SecurityCheckResult> {
  const workspace = createTempWorkspace("p5-mf-graph-");
  try {
    const testCase = MALFORMED_CODE_GRAPH_CASES[0];
    placeMalformedCodeGraph(workspace.indexDir, testCase.content);

    const beforeSource = snapshotDir(workspace.sourceDir);

    const { command, args } = buildCliCommand(target, [
      "--root",
      workspace.sourceDir,
      "--index",
      workspace.indexDir,
    ]);

    return await runAdversarialCheck({
      id: "malformed-code-graph-json",
      name: "Malformed code-graph.json is handled safely",
      category: "artifact-safety",
      severity: "major",
      command,
      args,
      cwd: workspace.root,
      timeoutMs: target.timeoutMs,
      evaluate: () => {
        const afterSource = snapshotDir(workspace.sourceDir);
        const sourceDiff = diffSnapshots(beforeSource, afterSource);
        const sourceProblems = [...sourceDiff.modified, ...sourceDiff.removed];
        if (sourceProblems.length > 0) {
          return [
            makeFinding({
              id: "malformed-graph-source-modified",
              title: "Source files modified while handling malformed code graph",
              severity: "blocker",
              category: "artifact-safety",
              description: `Source files affected: ${sourceProblems.join(", ")}`,
              affectedFiles: sourceProblems,
              recommendation:
                "Source directory must remain read-only even with malformed graph artifacts.",
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
 * Checks that the CLI handles an artifact with an unsupported schema version safely.
 */
export async function checkUnsupportedSchemaVersion(
  target: AdversarialCliTarget
): Promise<SecurityCheckResult> {
  const workspace = createTempWorkspace("p5-schema-ver-");
  try {
    const testCase = UNSUPPORTED_SCHEMA_VERSION_CASES.find((c) => c.id === "future-version")!;
    placeUnsupportedSchemaManifest(workspace.indexDir, testCase.content);

    const beforeSource = snapshotDir(workspace.sourceDir);

    const { command, args } = buildCliCommand(target, [
      "--root",
      workspace.sourceDir,
      "--index",
      workspace.indexDir,
    ]);

    return await runAdversarialCheck({
      id: "unsupported-schema-version",
      name: "Unsupported schema version produces a clear error",
      category: "artifact-safety",
      severity: "major",
      command,
      args,
      cwd: workspace.root,
      timeoutMs: target.timeoutMs,
      evaluate: () => {
        const afterSource = snapshotDir(workspace.sourceDir);
        const sourceDiff = diffSnapshots(beforeSource, afterSource);
        const sourceProblems = [...sourceDiff.modified, ...sourceDiff.removed];
        if (sourceProblems.length > 0) {
          return [
            makeFinding({
              id: "schema-version-source-modified",
              title: "Source files modified while handling unsupported schema version",
              severity: "blocker",
              category: "artifact-safety",
              description: `Source files affected: ${sourceProblems.join(", ")}`,
              affectedFiles: sourceProblems,
              recommendation:
                "Source directory must remain read-only even when the schema version is unsupported.",
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
 * Checks that the CLI handles a missing index directory gracefully.
 * The CLI should either create the directory or fail with a clear error.
 */
export async function checkMissingIndexDirectory(
  target: AdversarialCliTarget
): Promise<SecurityCheckResult> {
  const workspace = createTempWorkspace("p5-missing-idx-");
  try {
    // Use a non-existent subdirectory inside the workspace root.
    const missingIndexDir = path.join(workspace.root, "nonexistent-index-dir");
    const beforeSource = snapshotDir(workspace.sourceDir);

    const { command, args } = buildCliCommand(target, [
      "--root",
      workspace.sourceDir,
      "--index",
      missingIndexDir,
    ]);

    return await runAdversarialCheck({
      id: "missing-index-directory",
      name: "Missing index directory is handled gracefully",
      category: "artifact-safety",
      severity: "minor",
      command,
      args,
      cwd: workspace.root,
      timeoutMs: target.timeoutMs,
      evaluate: () => {
        // Source files must not be modified regardless of whether the CLI succeeded.
        const afterSource = snapshotDir(workspace.sourceDir);
        const sourceDiff = diffSnapshots(beforeSource, afterSource);
        const sourceProblems = [...sourceDiff.modified, ...sourceDiff.removed];
        if (sourceProblems.length > 0) {
          return [
            makeFinding({
              id: "missing-index-source-modified",
              title: "Source files modified when index directory was missing",
              severity: "blocker",
              category: "artifact-safety",
              description: `Source files affected: ${sourceProblems.join(", ")}`,
              affectedFiles: sourceProblems,
              recommendation:
                "Source directory must remain read-only regardless of index directory state.",
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
