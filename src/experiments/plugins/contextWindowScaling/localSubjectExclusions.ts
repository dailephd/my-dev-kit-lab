import { compareCodeUnits } from "../../../evaluation/localRepositorySubject/index.js";
import { LocalSubjectExecutionError } from "./localSubjectErrors.js";

/** Fail-closed ceilings so the exclusion arguments stay well inside Windows command-line limits. */
export const GUIDED_EXCLUSION_MAX_ENTRIES = 500;
export const GUIDED_EXCLUSION_MAX_CHARACTERS = 24_000;

/**
 * Pure policy: turns Batch 1 runtime exclusion evidence into the exact `--exclude` paths for the guided index.
 *
 * Each excluded file is covered by the shallowest ancestor directory that contains no eligible file (so a fully
 * ignored directory becomes one entry), otherwise by the file path itself. Bare names are never produced because
 * my-dev-kit treats a bare name as "every directory with this name", which would drop eligible material. If the
 * result is too large the call throws instead of truncating: an incomplete exclusion list would be unsafe.
 */
export function deriveGuidedIndexExclusions(input: {
  eligibleFiles: readonly string[];
  excludedFiles: readonly string[];
}): string[] {
  const eligibleDirectories = new Set<string>();
  const eligibleSegments = new Set<string>();
  for (const eligible of input.eligibleFiles) {
    const segments = eligible.split("/");
    segments.forEach((segment) => eligibleSegments.add(segment));
    for (let depth = 1; depth < segments.length; depth += 1) {
      eligibleDirectories.add(segments.slice(0, depth).join("/"));
    }
  }

  const candidates = new Set<string>();
  for (const excluded of input.excludedFiles) {
    const segments = excluded.split("/");
    let covering = excluded;
    for (let depth = 1; depth < segments.length; depth += 1) {
      const directory = segments.slice(0, depth).join("/");
      if (!eligibleDirectories.has(directory)) {
        covering = directory;
        break;
      }
    }
    // A single-segment entry is a name match in my-dev-kit (any depth), and "./name" is silently ignored, so it is
    // only safe when no eligible path uses that name. Otherwise descend to a multi-segment path, which is exact.
    if (!covering.includes("/") && eligibleSegments.has(covering)) {
      if (covering !== excluded && segments.length > 2) {
        covering = segments.slice(0, 2).join("/");
      } else if (covering !== excluded) {
        covering = excluded;
      } else {
        throw new LocalSubjectExecutionError([
          {
            code: "GUIDED_EXCLUSION_UNREPRESENTABLE",
            message: `an excluded top-level entry shares its name with eligible files and cannot be excluded exactly (${excluded}).`,
          },
        ]);
      }
    }
    candidates.add(covering);
  }

  const exclusions = [...candidates]
    .filter((candidate) => {
      const segments = candidate.split("/");
      for (let depth = 1; depth < segments.length; depth += 1) {
        if (candidates.has(segments.slice(0, depth).join("/"))) return false;
      }
      return true;
    })
    .sort(compareCodeUnits);

  const characters = exclusions.reduce((total, entry) => total + entry.length + 1, 0);
  if (exclusions.length > GUIDED_EXCLUSION_MAX_ENTRIES || characters > GUIDED_EXCLUSION_MAX_CHARACTERS) {
    throw new LocalSubjectExecutionError([
      {
        code: "GUIDED_EXCLUSION_LIMIT",
        message: `guided index exclusions exceed the safe limit (${exclusions.length} entries, ${characters} characters).`,
      },
    ]);
  }
  return exclusions;
}
