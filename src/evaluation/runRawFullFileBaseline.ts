import { lstatSync, readFileSync, statSync } from "node:fs";
import { collectFilesForGlobs, selectRelativePathsForGlobs } from "../core/fileGlobs.js";
import { resolveWithinRoot } from "../core/pathSafety.js";
import { countEstimatedTokens, countTextChars, tokenCountMethod } from "../core/countTokens.js";
import type { EvaluationCase, RawFullFileBaselineResult } from "./types.js";

export type RawFullFileBaselineOptions = {
  /**
   * Repository-relative regular files that are the only files allowed to be opened (for example a local subject's
   * Batch 1 eligible files). When supplied, the raw globs are matched against this list instead of walking the
   * target, so ignored, oversized, symlinked and out-of-universe files are never discovered or read.
   */
  eligibleFiles?: readonly string[];
};

export async function runRawFullFileBaseline(
  evaluationCase: EvaluationCase,
  options: RawFullFileBaselineOptions = {}
): Promise<RawFullFileBaselineResult> {
  const started = Date.now();
  let stats;
  try {
    stats = statSync(evaluationCase.absoluteTargetRoot);
  } catch {
    throw new Error(`Target root does not exist: ${evaluationCase.targetRoot}`);
  }
  if (!stats.isDirectory()) {
    throw new Error(`Target root is not a directory: ${evaluationCase.targetRoot}`);
  }

  const files =
    options.eligibleFiles === undefined
      ? collectFilesForGlobs(evaluationCase.absoluteTargetRoot, evaluationCase.rawIncludeGlobs)
      : selectEligibleFiles(evaluationCase, options.eligibleFiles);
  const contextText = files
    .map(({ absolutePath, relativePath }) => `=== FILE: ${relativePath} ===\n${readFileSync(absolutePath, "utf8")}\n`)
    .join("\n");

  return {
    caseId: evaluationCase.id,
    targetRoot: evaluationCase.absoluteTargetRoot,
    filesIncluded: files.map((file) => file.relativePath),
    totalFiles: files.length,
    totalChars: countTextChars(contextText),
    totalEstimatedTokens: countEstimatedTokens(contextText),
    tokenCountMethod,
    contextText,
    durationMs: Date.now() - started
  };
}

function selectEligibleFiles(
  evaluationCase: EvaluationCase,
  eligibleFiles: readonly string[]
): { absolutePath: string; relativePath: string }[] {
  return selectRelativePathsForGlobs(eligibleFiles, evaluationCase.rawIncludeGlobs).map((relativePath) => {
    const absolutePath = resolveWithinRoot(evaluationCase.absoluteTargetRoot, relativePath);
    // The eligible list was built earlier; refuse a file that has since been swapped for a link or removed.
    const stats = lstatSync(absolutePath, { throwIfNoEntry: false });
    if (!stats || stats.isSymbolicLink() || !stats.isFile()) {
      throw new Error(`Eligible file is no longer a regular file: ${relativePath}`);
    }
    return { absolutePath, relativePath };
  });
}
