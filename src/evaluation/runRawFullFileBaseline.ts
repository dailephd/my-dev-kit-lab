import { readFileSync, statSync } from "node:fs";
import { collectFilesForGlobs } from "../core/fileGlobs.js";
import { countEstimatedTokens, countTextChars, tokenCountMethod } from "../core/countTokens.js";
import type { EvaluationCase, RawFullFileBaselineResult } from "./types.js";

export async function runRawFullFileBaseline(evaluationCase: EvaluationCase): Promise<RawFullFileBaselineResult> {
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

  const files = collectFilesForGlobs(evaluationCase.absoluteTargetRoot, evaluationCase.rawIncludeGlobs);
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
