import path from "node:path";
import type { InventoryEntryStats, LocalRepositorySubjectFsIo, LocalRepositorySubjectInventory } from "./inventory.js";
import type { LocalRepositorySubjectCaseV1 } from "./types.js";

function isWithinCanonicalRoot(filePath: string, root: string): boolean {
  return root === "." || filePath === root || filePath.startsWith(`${root}/`);
}

async function describeUnavailableFile(repositoryRoot: string, filePath: string, io: LocalRepositorySubjectFsIo): Promise<string> {
  let current = repositoryRoot;
  const segments = filePath.split("/");
  for (let index = 0; index < segments.length; index += 1) {
    current = path.join(current, segments[index]);
    let stats: InventoryEntryStats;
    try {
      stats = await io.lstat(current);
    } catch {
      return "does not exist";
    }
    if (stats.isSymbolicLink()) return "is or passes through a symlink";
    if (index === segments.length - 1 && !stats.isFile()) return "is not a regular file";
  }
  return "is not eligible subject material";
}

/**
 * Validates every required expected file of every case against the safe inventory. A required file is never
 * silently dropped: ignored, oversized, symlinked, missing, non-regular, or out-of-root files each produce an error.
 */
export async function validateExpectedFiles(
  repositoryRoot: string,
  cases: readonly LocalRepositorySubjectCaseV1[],
  inventory: LocalRepositorySubjectInventory,
  io: LocalRepositorySubjectFsIo
): Promise<string[]> {
  const eligible = new Set(inventory.eligibleFiles.map((file) => file.path));
  const errors: string[] = [];
  for (let caseIndex = 0; caseIndex < cases.length; caseIndex += 1) {
    const subjectCase = cases[caseIndex];
    for (let fileIndex = 0; fileIndex < subjectCase.expectedFiles.length; fileIndex += 1) {
      const filePath = subjectCase.expectedFiles[fileIndex];
      const label = `config.cases[${caseIndex}].expectedFiles[${fileIndex}]`;
      if (!subjectCase.sourceRoots.some((root) => isWithinCanonicalRoot(filePath, root))) {
        errors.push(`${label}: expected file is outside the case source roots (${JSON.stringify(filePath)}).`);
      } else if (inventory.ignoredFiles.has(filePath)) {
        errors.push(`${label}: expected file is ignored by Git (${JSON.stringify(filePath)}).`);
      } else if (inventory.oversizedFiles.has(filePath)) {
        errors.push(`${label}: expected file exceeds the maximum file size policy (${JSON.stringify(filePath)}).`);
      } else if (!eligible.has(filePath)) {
        errors.push(`${label}: expected file ${await describeUnavailableFile(repositoryRoot, filePath, io)} (${JSON.stringify(filePath)}).`);
      }
    }
  }
  return errors;
}
