import path from "node:path";
import { relativeWithinRoot } from "../../../core/pathSafety.js";
import type { LocalRepositorySubject } from "../../../evaluation/localRepositorySubject/index.js";
import { normalizeRetrievedRepositoryPath, validateRetrievalPrecisionRecallCase } from "../../../evaluation/retrievalQuality/index.js";
import { buildMyDevKitIndex, runMyDevKitRetrievalFromIndex } from "../../../evaluation/runMyDevKitRetrieval.js";
import { captureTargetSnapshot, compareTargetSnapshots } from "../../../evaluation/targetImmutability/index.js";
import type { V043TargetImmutabilityComparisonV1, V043TargetSnapshotResult } from "../../../evaluation/targetImmutability/index.js";
import type { MyDevKitRetrievalResult } from "../../../evaluation/types.js";
import { LocalSubjectExecutionError, type LocalSubjectExecutionIssue } from "../contextWindowScaling/localSubjectErrors.js";
import { deriveGuidedIndexExclusions } from "../contextWindowScaling/localSubjectExclusions.js";
import {
  assertWorkRootOutsideTarget,
  createPrivateScratch,
  defaultPrivateScratchIo,
  removePrivateScratch,
  type PrivateScratchIo
} from "../contextWindowScaling/localSubjectScratch.js";
import { buildCaseEvidenceFromRetrieval, type RetrievalPrecisionRecallDependencies } from "./execution.js";
import type { RetrievalPrecisionRecallCaseEvidenceV1 } from "./types.js";

export type RetrievalLocalSubjectExecutionResult = {
  /** Unprojected, in-memory case evidence. It must go through the privacy projection before any persistence. */
  caseEvidence: RetrievalPrecisionRecallCaseEvidenceV1[];
  /** Privacy-lean immutability outcome; the full comparison is only attached to a failure. */
  immutability: { status: "unchanged"; preExistingGitStatusEntryCount: number; newMutationCount: 0 };
};

export type RetrievalLocalSubjectExecutionArgs = {
  subject: LocalRepositorySubject;
  kitCommand: string;
  /** Lab-owned directory that must be outside the subject repository; the private scratch is created inside it. */
  workRoot: string;
  /** Test seam only: substitutes the two existing lifecycle owners. Production callers never pass it. */
  dependencies?: Partial<RetrievalPrecisionRecallDependencies>;
  /** Test seam for scratch removal. */
  scratchIo?: PrivateScratchIo;
};

function toRepositoryRelative(repositoryRoot: string, file: string): string {
  if (path.isAbsolute(file)) {
    try {
      return relativeWithinRoot(repositoryRoot, file);
    } catch {
      return file.replace(/\\/g, "/");
    }
  }
  return normalizeRetrievedRepositoryPath(file) ?? file.replace(/\\/g, "/");
}

/**
 * Counts distinct retrieved identities outside the eligible subject universe. It inspects every file identity the
 * retrieval exposes: evidence files, evidence symbol files, the selected file, and the files read. Only the count
 * leaves this function; an offending identity is never named.
 */
export function countRetrievedIdentitiesOutsideEligibleUniverse(
  retrieval: MyDevKitRetrievalResult,
  eligibleFiles: ReadonlySet<string>,
  repositoryRoot: string
): number {
  const identities = new Set<string>();
  for (const file of retrieval.retrievalEvidence?.files ?? []) identities.add(toRepositoryRelative(repositoryRoot, file.path));
  for (const symbol of retrieval.retrievalEvidence?.symbols ?? []) {
    if (symbol.file !== undefined) identities.add(toRepositoryRelative(repositoryRoot, symbol.file));
  }
  if (retrieval.selectedFile) identities.add(toRepositoryRelative(repositoryRoot, retrieval.selectedFile));
  for (const file of retrieval.filesRead) identities.add(toRepositoryRelative(repositoryRoot, file));
  return [...identities].filter((identity) => !eligibleFiles.has(identity)).length;
}

/**
 * Internal programmatic seam: runs a loaded local subject through the existing index and retrieval owners, one
 * private index per configured case (each case keeps its own exact source roots), with a private scratch outside the
 * target and pre/post target-immutability enforcement. Order: validate work root, derive exclusions, validate
 * ground truth, capture before, create scratch, execute cases, capture after, compare, remove scratch, then decide.
 * Success is returned only when every safety gate passed. A mutated target is never reverted.
 *
 * Every issue message is safe by construction: fixed text plus logical case ids and counts, never a file name,
 * symbol, fact id, path, or caught error text.
 */
export async function executeLocalRepositorySubjectRetrievalPrecisionRecall(
  args: RetrievalLocalSubjectExecutionArgs
): Promise<RetrievalLocalSubjectExecutionResult> {
  const { subject } = args;
  const buildIndex = args.dependencies?.buildIndex ?? buildMyDevKitIndex;
  const retrieveFromIndex = args.dependencies?.retrieveFromIndex ?? runMyDevKitRetrievalFromIndex;

  await assertWorkRootOutsideTarget(args.workRoot, subject.repositoryRoot);
  const guidedExclusions = deriveGuidedIndexExclusions({
    eligibleFiles: subject.eligibleFiles,
    excludedFiles: [...subject.runtimeSafetyExclusions.gitIgnoredFiles, ...subject.runtimeSafetyExclusions.oversizedFiles]
  });

  const invalidCaseIds = subject.evaluationCases.filter((evaluationCase) => validateRetrievalPrecisionRecallCase(evaluationCase).length > 0).map((evaluationCase) => evaluationCase.id);
  if (invalidCaseIds.length > 0) {
    throw new LocalSubjectExecutionError([
      { code: "GROUND_TRUTH_INVALID", message: `retrieval ground truth is incomplete for case(s): ${invalidCaseIds.join(", ")}.` }
    ]);
  }

  const snapshotConfig = { targetRootPath: subject.repositoryRoot, relativeFilePaths: subject.eligibleFiles };
  const snapshotOptions = { externalLocalSafe: { maxHashedFileBytes: subject.manifest.safetyPolicy.maxFileBytes } };
  const before: V043TargetSnapshotResult = await captureTargetSnapshot(snapshotConfig, snapshotOptions);
  if (!before.ok) {
    throw new LocalSubjectExecutionError([{ code: "BEFORE_SNAPSHOT_FAILED", message: `target snapshot before execution failed (${before.code}).` }]);
  }

  const scratch = await createPrivateScratch(args.workRoot, subject.repositoryRoot);
  const issues: LocalSubjectExecutionIssue[] = [];
  const caseEvidence: RetrievalPrecisionRecallCaseEvidenceV1[] = [];
  const eligible = new Set(subject.eligibleFiles);

  for (const [position, evaluationCase] of subject.evaluationCases.entries()) {
    // Short, fixed segments: private case or repository names never become directory names.
    const indexDir = path.join(scratch.path, `i${position + 1}`);
    const commandsDir = path.join(scratch.path, `c${position + 1}`);
    try {
      // requireKit: false keeps a failed index as a result we can classify instead of an arbitrary thrown message.
      const build = await buildIndex({
        target: { absoluteTargetRoot: evaluationCase.absoluteTargetRoot, sourceRoots: [...evaluationCase.sourceRoots] },
        kitCommand: args.kitCommand,
        indexDir,
        commandsDir: path.join(commandsDir, "index"),
        requireKit: false,
        excludePaths: guidedExclusions
      });
      if (!build.ok) {
        issues.push({ code: "EXECUTION_FAILED", message: `case ${evaluationCase.id}: the my-dev-kit index could not be prepared.` });
        break;
      }
      const retrieval = await retrieveFromIndex({
        evaluationCase,
        kitCommand: args.kitCommand,
        indexDir,
        commandsDir: path.join(commandsDir, "retrieval"),
        requireKit: false
      });
      const outside = countRetrievedIdentitiesOutsideEligibleUniverse(retrieval, eligible, subject.repositoryRoot);
      if (outside > 0) {
        issues.push({
          code: "RETRIEVAL_OUTSIDE_ELIGIBLE_UNIVERSE",
          message: `case ${evaluationCase.id}: retrieval exposed ${outside} file identit${outside === 1 ? "y" : "ies"} outside the eligible subject universe.`
        });
        break;
      }
      caseEvidence.push(buildCaseEvidenceFromRetrieval(evaluationCase, retrieval));
    } catch {
      issues.push({ code: "EXECUTION_FAILED", message: `case ${evaluationCase.id}: execution threw before completing (details withheld).` });
      break;
    }
  }

  let comparison: V043TargetImmutabilityComparisonV1 | null = null;
  const after = await captureTargetSnapshot(snapshotConfig, snapshotOptions);
  if (!after.ok) {
    issues.push({ code: "AFTER_SNAPSHOT_FAILED", message: `target snapshot after execution failed (${after.code}).` });
  } else {
    comparison = compareTargetSnapshots(before.snapshot, after.snapshot);
    if (comparison.status === "mutated") {
      issues.push({ code: "TARGET_MUTATED", message: "the target changed during execution; it was not restored." });
    }
  }

  const cleanupFailure = await removePrivateScratch(scratch, args.scratchIo ?? defaultPrivateScratchIo);
  if (cleanupFailure) {
    issues.push({ code: "SCRATCH_CLEANUP_FAILED", message: "the private scratch could not be removed." });
  }

  if (issues.length > 0 || !comparison) {
    throw new LocalSubjectExecutionError(issues.length > 0 ? issues : [{ code: "EXECUTION_FAILED", message: "execution did not complete." }], {
      immutability: comparison
    });
  }
  return {
    caseEvidence,
    immutability: { status: "unchanged", preExistingGitStatusEntryCount: comparison.preExistingGitStatusEntryCount, newMutationCount: 0 }
  };
}
