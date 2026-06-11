import { readFile } from "node:fs/promises";
import path from "node:path";
import { resolveWithinRoot } from "../core/pathSafety.js";
import { validateAnswerKey } from "./benchmarkMetadata.js";
import type { BenchmarkProjectProfile, EvaluationCase, EvaluationCaseInput } from "./types.js";

export type ReadEvaluationCasesOptions = {
  projectProfiles?: BenchmarkProjectProfile[];
  requireProjectProfileRef?: boolean;
};

export async function readEvaluationCases(
  casesPath: string,
  repoRoot = process.cwd(),
  options: ReadEvaluationCasesOptions = {}
): Promise<EvaluationCase[]> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(await readFile(casesPath, "utf8"));
  } catch (error) {
    throw new Error(`Failed to parse evaluation cases: ${(error as Error).message}`);
  }

  if (!Array.isArray(parsed)) {
    throw new Error("Evaluation cases file must contain an array.");
  }

  const ids = new Set<string>();
  return parsed.map((value, index) => {
    if (!value || typeof value !== "object") {
      throw new Error(`Invalid evaluation case at index ${index}.`);
    }
    const candidate = value as Record<string, unknown>;
    const requiredStringFields = ["id", "title", "benchmarkProject", "targetRoot", "query"];
    for (const field of requiredStringFields) {
      if (typeof candidate[field] !== "string" || candidate[field] === "") {
        throw new Error(`Missing required field: ${field}`);
      }
    }
    const requiredArrayFields = ["sourceRoots", "expectedFiles", "expectedSymbols", "rawIncludeGlobs"];
    for (const field of requiredArrayFields) {
      if (!Array.isArray(candidate[field])) {
        throw new Error(`Missing required field: ${field}`);
      }
    }

    const input = candidate as unknown as EvaluationCaseInput;
    if (ids.has(input.id)) {
      throw new Error(`Duplicate evaluation case id: ${input.id}`);
    }
    ids.add(input.id);

    if (candidate.answerKey !== undefined) {
      const answerKeyErrors = validateAnswerKey(candidate.answerKey, `evaluation case ${input.id}`);
      if (answerKeyErrors.length > 0) {
        throw new Error(answerKeyErrors.join("\n"));
      }
    }

    if (options.requireProjectProfileRef === true) {
      if (typeof input.projectProfileRef !== "string" || input.projectProfileRef.length === 0) {
        throw new Error(`evaluation case ${input.id}: missing projectProfileRef.`);
      }
      const profileIds = new Set((options.projectProfiles ?? []).map((profile) => profile.projectId));
      if (!profileIds.has(input.projectProfileRef)) {
        throw new Error(`evaluation case ${input.id}: unknown projectProfileRef ${input.projectProfileRef}.`);
      }
    }

    return {
      ...input,
      absoluteTargetRoot: resolveWithinRoot(path.resolve(repoRoot), input.targetRoot)
    };
  });
}
