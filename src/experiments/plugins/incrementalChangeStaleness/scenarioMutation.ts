import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { resolveWithinRoot } from "../../../core/pathSafety.js";
import type { IncrementalChangeStalenessMutationFile } from "./scenarioTypes.js";

function sha256Hex(data: Buffer): string {
  return createHash("sha256").update(data).digest("hex");
}

/**
 * Applies one scenario's ordered, literal replacement operations to in-memory
 * text. Every preimage must match exactly once at the point it is applied;
 * this never touches the filesystem.
 */
export function applyMutationOperations(
  text: string,
  operations: IncrementalChangeStalenessMutationFile["operations"]
): string {
  let mutated = text;
  for (const [index, operation] of operations.entries()) {
    const occurrences = countOccurrences(mutated, operation.expectedPreimage);
    if (occurrences === 0) {
      throw new Error(`operation ${index}: expectedPreimage not found: ${JSON.stringify(operation.expectedPreimage)}.`);
    }
    if (occurrences > 1) {
      throw new Error(`operation ${index}: expectedPreimage matches ${occurrences} times; it must match exactly once: ${JSON.stringify(operation.expectedPreimage)}.`);
    }
    mutated = mutated.split(operation.expectedPreimage).join(operation.replacement);
  }
  return mutated;
}

function countOccurrences(text: string, needle: string): number {
  if (needle.length === 0) {
    return 0;
  }
  return text.split(needle).length - 1;
}

export type MutationFileValidationResult = {
  errors: string[];
  /** In-memory post-mutation text, present only when validation fully succeeded. */
  mutatedText?: string;
};

/**
 * Validates one controlled mutation file declaration against the real,
 * on-disk canonical benchmark file:
 *  - the resolved path stays within the benchmark project root;
 *  - the resolved path is covered by one of the case's configured indexed
 *    source roots;
 *  - the current canonical SHA-256 equals `expectedPreSha256`;
 *  - the ordered operations apply cleanly to in-memory text;
 *  - the resulting in-memory SHA-256 equals `expectedPostSha256`.
 *
 * This function only reads the canonical file; it never writes to disk, so
 * canonical benchmark source/test files remain byte-for-byte unchanged.
 */
export async function validateMutationFile(
  label: string,
  file: IncrementalChangeStalenessMutationFile,
  projectAbsoluteRoot: string,
  caseSourceRoots: readonly string[]
): Promise<MutationFileValidationResult> {
  const errors: string[] = [];

  if (typeof file.path !== "string" || file.path.length === 0) {
    return { errors: [`${label}: mutation file path must be a nonempty string.`] };
  }
  if (path.isAbsolute(file.path) || file.path.includes("..")) {
    return { errors: [`${label}: mutation file path must be a safe project-relative path: ${file.path}.`] };
  }

  const normalizedFilePath = file.path.replace(/\\/g, "/");
  const covered = caseSourceRoots.some((root) => {
    const normalizedRoot = root.replace(/\\/g, "/").replace(/\/+$/, "");
    return normalizedFilePath === normalizedRoot || normalizedFilePath.startsWith(`${normalizedRoot}/`);
  });
  if (!covered) {
    errors.push(`${label}: mutation file path ${file.path} is not covered by the referenced case's indexed source roots (${caseSourceRoots.join(", ")}).`);
  }

  let absolutePath: string;
  try {
    absolutePath = resolveWithinRoot(projectAbsoluteRoot, file.path);
  } catch (error) {
    return { errors: [`${label}: ${(error as Error).message}`] };
  }

  if (typeof file.expectedPreSha256 !== "string" || !/^[0-9a-f]{64}$/.test(file.expectedPreSha256)) {
    errors.push(`${label}: expectedPreSha256 must be a lowercase 64-character hex SHA-256 string.`);
  }
  if (typeof file.expectedPostSha256 !== "string" || !/^[0-9a-f]{64}$/.test(file.expectedPostSha256)) {
    errors.push(`${label}: expectedPostSha256 must be a lowercase 64-character hex SHA-256 string.`);
  }
  if (!Array.isArray(file.operations) || file.operations.length === 0) {
    errors.push(`${label}: operations must be a nonempty array.`);
  }

  if (errors.length > 0) {
    return { errors };
  }

  let buffer: Buffer;
  try {
    buffer = await readFile(absolutePath);
  } catch (error) {
    return { errors: [`${label}: unable to read mutation file ${file.path}: ${(error as Error).message}`] };
  }

  const actualPreSha256 = sha256Hex(buffer);
  if (actualPreSha256 !== file.expectedPreSha256) {
    errors.push(`${label}: expectedPreSha256 ${file.expectedPreSha256} does not match actual canonical file SHA-256 ${actualPreSha256}.`);
    return { errors };
  }

  let mutatedText: string;
  try {
    mutatedText = applyMutationOperations(buffer.toString("utf8"), file.operations);
  } catch (error) {
    errors.push(`${label}: ${(error as Error).message}`);
    return { errors };
  }

  const actualPostSha256 = sha256Hex(Buffer.from(mutatedText, "utf8"));
  if (actualPostSha256 !== file.expectedPostSha256) {
    errors.push(`${label}: expectedPostSha256 ${file.expectedPostSha256} does not match computed in-memory post-mutation SHA-256 ${actualPostSha256}.`);
    return { errors };
  }

  return { errors: [], mutatedText };
}
