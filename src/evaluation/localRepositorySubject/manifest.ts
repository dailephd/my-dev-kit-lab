import type { LocalRepositorySubjectInventory } from "./inventory.js";
import {
  LOCAL_REPOSITORY_SUBJECT_MANIFEST_SCHEMA_ID,
  LOCAL_REPOSITORY_SUBJECT_MANIFEST_SCHEMA_VERSION,
  LOCAL_REPOSITORY_SUBJECT_SAFETY_POLICY_VERSION,
  compareCodeUnits,
  logicalTargetRootForSubject,
} from "./types.js";
import type {
  LocalRepositoryIdentity,
  LocalRepositorySubjectConfigV1,
  LocalRepositorySubjectExtensionSummaryEntry,
  LocalRepositorySubjectManifestV1,
} from "./types.js";

/** Lowercase text after the last "." of the basename; "(none)" when absent or only a leading dot. */
export function extensionOf(filePath: string): string {
  const base = filePath.slice(filePath.lastIndexOf("/") + 1);
  const dot = base.lastIndexOf(".");
  if (dot <= 0 || dot === base.length - 1) return "(none)";
  return base.slice(dot + 1).toLowerCase();
}

function summarizeExtensions(filePaths: readonly string[]): LocalRepositorySubjectExtensionSummaryEntry[] {
  const counts = new Map<string, number>();
  for (const filePath of filePaths) {
    const extension = extensionOf(filePath);
    counts.set(extension, (counts.get(extension) ?? 0) + 1);
  }
  return [...counts.entries()]
    .sort(([left], [right]) => compareCodeUnits(left, right))
    .map(([extension, fileCount]) => ({ extension, fileCount }));
}

/** Builds the privacy-safe manifest model. Inputs that are runtime-only (paths, file lists) are reduced to aggregates. */
export function buildLocalRepositorySubjectManifest(
  config: LocalRepositorySubjectConfigV1,
  identity: LocalRepositoryIdentity,
  maxFileBytes: number,
  inventory: LocalRepositorySubjectInventory
): LocalRepositorySubjectManifestV1 {
  const sourceRoots = [...new Set(config.cases.flatMap((subjectCase) => subjectCase.sourceRoots))].sort(compareCodeUnits);
  return {
    schemaId: LOCAL_REPOSITORY_SUBJECT_MANIFEST_SCHEMA_ID,
    schemaVersion: LOCAL_REPOSITORY_SUBJECT_MANIFEST_SCHEMA_VERSION,
    subjectId: config.subjectId,
    logicalTargetRoot: logicalTargetRootForSubject(config.subjectId),
    repository: { commit: identity.commit, branch: identity.branch, workingTreeDirty: identity.workingTreeDirty },
    safetyPolicy: {
      version: LOCAL_REPOSITORY_SUBJECT_SAFETY_POLICY_VERSION,
      maxFileBytes,
      gitIgnoreAuthority: "git",
      symlinkPolicy: "excluded-not-followed",
    },
    sourceRoots,
    caseCount: config.cases.length,
    caseIds: config.cases.map((subjectCase) => subjectCase.id),
    inventory: {
      eligibleFileCount: inventory.counts.eligibleFileCount,
      eligibleByteCount: inventory.counts.eligibleByteCount,
      gitIgnoredCount: inventory.counts.gitIgnoredCount,
      oversizedCount: inventory.counts.oversizedCount,
      symlinkCount: inventory.counts.symlinkCount,
      otherExcludedCount: inventory.counts.otherExcludedCount,
      extensionSummary: summarizeExtensions(inventory.eligibleFiles.map((file) => file.path)),
    },
  };
}

/** Deterministic serialization (fixed key order from the builder, LF terminated). */
export function serializeLocalRepositorySubjectManifest(manifest: LocalRepositorySubjectManifestV1): string {
  return `${JSON.stringify(manifest, null, 2)}\n`;
}
