import { parseLocalRepositorySubjectConfig } from "./config.js";
import { buildLocalRepositorySubjectEvaluationCases } from "./evaluationCase.js";
import { validateExpectedFiles } from "./expectedFiles.js";
import { readRepositoryIdentity } from "./gitRepository.js";
import {
  buildLocalRepositorySubjectInventory,
  defaultLocalRepositorySubjectFsIo,
  validateSourceRootOnDisk,
} from "./inventory.js";
import type { LocalRepositorySubjectFsIo } from "./inventory.js";
import { buildLocalRepositorySubjectManifest } from "./manifest.js";
import {
  DEFAULT_LOCAL_REPOSITORY_SUBJECT_MAX_FILE_BYTES,
  LocalRepositorySubjectConfigError,
  logicalTargetRootForSubject,
} from "./types.js";
import type { LocalRepositorySubject } from "./types.js";

export type LoadLocalRepositorySubjectOptions = {
  /** Unvalidated config input (parsed JSON). */
  config: unknown;
  /** Physical path of the selected Git worktree root. */
  repositoryPath: string;
  /** Internal test seam; no public override exists in Batch 1. Defaults to the operational 1 MiB policy. */
  maxFileBytes?: number;
  io?: LocalRepositorySubjectFsIo;
};

/**
 * Loads a local repository subject in the frozen safety order: validate config, identify the Git repository,
 * validate source roots on disk, inventory (without reading contents), validate required files, then build the
 * privacy-safe manifest and in-memory EvaluationCase objects. Never mutates the subject repository.
 */
export async function loadLocalRepositorySubject(options: LoadLocalRepositorySubjectOptions): Promise<LocalRepositorySubject> {
  const maxFileBytes = options.maxFileBytes ?? DEFAULT_LOCAL_REPOSITORY_SUBJECT_MAX_FILE_BYTES;
  if (!Number.isSafeInteger(maxFileBytes) || maxFileBytes < 1) {
    throw new LocalRepositorySubjectConfigError([`policy.maxFileBytes: must be a positive safe integer (received ${String(maxFileBytes)}).`]);
  }
  const io = options.io ?? defaultLocalRepositorySubjectFsIo;

  const config = parseLocalRepositorySubjectConfig(options.config);
  const { repositoryRoot, identity } = await readRepositoryIdentity(options.repositoryPath);

  const rootErrors: string[] = [];
  for (let caseIndex = 0; caseIndex < config.cases.length; caseIndex += 1) {
    const roots = config.cases[caseIndex].sourceRoots;
    for (let rootIndex = 0; rootIndex < roots.length; rootIndex += 1) {
      rootErrors.push(
        ...(await validateSourceRootOnDisk(repositoryRoot, roots[rootIndex], `config.cases[${caseIndex}].sourceRoots[${rootIndex}]`, io))
      );
    }
  }
  if (rootErrors.length > 0) throw new LocalRepositorySubjectConfigError(rootErrors);

  const unionRoots = [...new Set(config.cases.flatMap((subjectCase) => subjectCase.sourceRoots))];
  const inventory = await buildLocalRepositorySubjectInventory(repositoryRoot, unionRoots, maxFileBytes, io);

  const expectedFileErrors = await validateExpectedFiles(repositoryRoot, config.cases, inventory, io);
  if (expectedFileErrors.length > 0) throw new LocalRepositorySubjectConfigError(expectedFileErrors);

  const manifest = buildLocalRepositorySubjectManifest(config, identity, maxFileBytes, inventory);
  return {
    subjectId: config.subjectId,
    logicalTargetRoot: logicalTargetRootForSubject(config.subjectId),
    repositoryRoot,
    manifest,
    evaluationCases: buildLocalRepositorySubjectEvaluationCases(config, repositoryRoot),
    eligibleFiles: inventory.eligibleFiles.map((file) => file.path),
  };
}
