import { normalizeProjectRelativePath } from "./taskPaths.js";
import {
  DEFAULT_PATCH_BOUNDS,
  type ParsedPatchFile,
  type PatchBounds,
  type PatchFileStatus,
  type PatchPolicyRejection,
  type PatchPolicyResult
} from "./patchTypes.js";

const MAX_REPORTED_REJECTIONS = 20;
const SYMLINK_MODE = "120000";
const GITLINK_MODE = "160000";

export type PatchPolicyOptions = {
  /** Hard boundary: a patch touching any of these files is rejected. Matched after normalization. */
  protectedFiles: readonly string[];
  bounds?: Readonly<PatchBounds>;
};

function describeStatus(file: ParsedPatchFile): PatchFileStatus {
  if (file.isNew || (file.oldPath === null && file.newPath !== null)) return "added";
  if (file.isDelete || (file.newPath === null && file.oldPath !== null)) return "deleted";
  return "modified";
}

/**
 * Applies the Lab's patch policy to a parsed diff. Everything a patch could use to escape the benchmark
 * copy or to alter protected files is rejected here, before Git sees the patch. A file outside the task's
 * allowed edit scope is NOT rejected: such edits are legitimate evidence for later measurement.
 */
export function validatePatchPolicy(files: readonly ParsedPatchFile[], options: PatchPolicyOptions): PatchPolicyResult {
  const bounds = options.bounds ?? DEFAULT_PATCH_BOUNDS;
  const rejections: PatchPolicyRejection[] = [];
  const reject = (rejection: PatchPolicyRejection): void => {
    if (rejections.length < MAX_REPORTED_REJECTIONS) rejections.push(rejection);
  };
  const protectedSet = new Set<string>();
  for (const entry of options.protectedFiles) {
    const normalized = normalizeProjectRelativePath(entry);
    if (normalized.ok) protectedSet.add(normalized.path);
  }

  const accepted = new Map<string, PatchFileStatus>();
  for (const file of files) {
    const label = file.newPath ?? file.oldPath ?? file.gitHeaderPath ?? undefined;
    if (file.binary) reject({ code: "BINARY_PATCH", path: label, message: "binary patches are not accepted." });
    if (file.rename || file.copy) reject({ code: "RENAME_OR_COPY", path: label, message: "rename and copy patches are not accepted." });
    if (file.oldPath !== null && file.newPath !== null && file.oldPath !== file.newPath) {
      reject({ code: "PATH_MISMATCH", path: label, message: "the old and new paths differ." });
    }
    if (file.oldMode === SYMLINK_MODE || file.newMode === SYMLINK_MODE) {
      reject({ code: "SYMLINK_MODE", path: label, message: "symbolic-link entries are not accepted." });
    }
    if (file.oldMode === GITLINK_MODE || file.newMode === GITLINK_MODE || file.subproject) {
      reject({ code: "SUBMODULE", path: label, message: "submodule/gitlink changes are not accepted." });
    }

    const candidates = new Set(
      [file.oldPath, file.newPath, file.oldPath === null && file.newPath === null ? file.gitHeaderPath : null].filter(
        (value): value is string => value !== null
      )
    );
    for (const candidate of candidates) {
      const normalized = normalizeProjectRelativePath(candidate);
      if (!normalized.ok) {
        reject({ code: "UNSAFE_PATH", message: `unsafe patch path (${normalized.code}).` });
        continue;
      }
      if (protectedSet.has(normalized.path)) {
        reject({ code: "PROTECTED_PATH", path: normalized.path, message: "the patch touches a protected file." });
      }
      accepted.set(normalized.path, describeStatus(file));
    }
  }

  if (accepted.size > bounds.maxChangedPaths) {
    rejections.unshift({ code: "TOO_MANY_PATHS", message: `the patch changes more than ${bounds.maxChangedPaths} paths.` });
  }
  if (rejections.length > 0) return { ok: false, rejections: rejections.slice(0, MAX_REPORTED_REJECTIONS) };
  return { ok: true, files: [...accepted].map(([path, status]) => ({ path, status })).sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0)) };
}
