import { realpath as nativeRealpath } from "node:fs";
import { lstat, mkdir, mkdtemp, rm } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import { relativeWithinRoot } from "../../../core/pathSafety.js";
import { LocalSubjectExecutionError } from "./localSubjectErrors.js";

const realpath = promisify(nativeRealpath.native);

export type PrivateScratch = { path: string };

/** Test seam for cleanup failure; the default removes the directory recursively. */
export type PrivateScratchIo = {
  removeDirectory(directory: string): Promise<void>;
};

export const defaultPrivateScratchIo: PrivateScratchIo = {
  removeDirectory: (directory) => rm(directory, { recursive: true, force: true }),
};

/** Physical path of a path that may not exist yet: realpath of the deepest existing ancestor plus the remainder. */
async function resolvePhysicalPath(candidate: string): Promise<string> {
  const resolved = path.resolve(candidate);
  const remainder: string[] = [];
  let current = resolved;
  for (;;) {
    try {
      const physical = await realpath(current);
      return remainder.length === 0 ? physical : path.join(physical, ...remainder.reverse());
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      const parent = path.dirname(current);
      if ((code !== "ENOENT" && code !== "ENOTDIR") || parent === current) return resolved;
      remainder.push(path.basename(current));
      current = parent;
    }
  }
}

function isSameOrInside(root: string, candidate: string): boolean {
  try {
    relativeWithinRoot(root, candidate);
    return true;
  } catch {
    return false;
  }
}

/** Rejects a Lab-owned work root that equals or lies inside the target. Performs no writes. */
export async function assertWorkRootOutsideTarget(workRoot: string, targetRoot: string): Promise<void> {
  const physicalTarget = await resolvePhysicalPath(targetRoot);
  const physicalWorkRoot = await resolvePhysicalPath(workRoot);
  if (isSameOrInside(physicalTarget, physicalWorkRoot)) {
    throw new LocalSubjectExecutionError([
      { code: "WORK_ROOT_INSIDE_TARGET", message: "the Lab work root must be outside the local subject repository." },
    ]);
  }
}

/** Creates a short run-owned private scratch directory under the work root and re-verifies it is outside the target. */
export async function createPrivateScratch(workRoot: string, targetRoot: string): Promise<PrivateScratch> {
  await mkdir(path.resolve(workRoot), { recursive: true });
  const scratchPath = await mkdtemp(path.join(await realpath(path.resolve(workRoot)), "s-"));
  if (isSameOrInside(await resolvePhysicalPath(targetRoot), await resolvePhysicalPath(scratchPath))) {
    await rm(scratchPath, { recursive: true, force: true });
    throw new LocalSubjectExecutionError([
      { code: "WORK_ROOT_INSIDE_TARGET", message: "the private scratch directory resolved inside the local subject repository." },
    ]);
  }
  return { path: scratchPath };
}

/**
 * Removes the scratch and verifies it is gone. Returns a failure description instead of throwing so the caller can
 * keep the primary error; never retries and never sleeps.
 */
export async function removePrivateScratch(
  scratch: PrivateScratch,
  io: PrivateScratchIo = defaultPrivateScratchIo
): Promise<string | null> {
  try {
    await io.removeDirectory(scratch.path);
  } catch (error) {
    return `private scratch could not be removed: ${error instanceof Error ? error.message : String(error)}`;
  }
  try {
    await lstat(scratch.path);
    return "private scratch still exists after removal.";
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === "ENOENT" ? null : "private scratch state could not be verified after removal.";
  }
}
