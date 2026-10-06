import path from "node:path";
import type { LocalRepositorySubject } from "../../../evaluation/localRepositorySubject/index.js";
import { validateRetrievalPrecisionRecallCase } from "../../../evaluation/retrievalQuality/index.js";
import { buildMyDevKitIndex } from "../../../evaluation/runMyDevKitRetrieval.js";
import { captureTargetSnapshot, compareTargetSnapshots } from "../../../evaluation/targetImmutability/index.js";
import type { V043TargetImmutabilityComparisonV1, V043TargetSnapshotResult } from "../../../evaluation/targetImmutability/index.js";
import { LocalSubjectExecutionError, type LocalSubjectExecutionIssue } from "../contextWindowScaling/localSubjectErrors.js";
import { deriveGuidedIndexExclusions } from "../contextWindowScaling/localSubjectExclusions.js";
import {
  assertWorkRootOutsideTarget,
  createPrivateScratch,
  defaultPrivateScratchIo,
  removePrivateScratch,
  type PrivateScratchIo
} from "../contextWindowScaling/localSubjectScratch.js";
import { executeRetrievalQueryStrategyCaseFromPreparedIndex } from "./execution.js";
import type { RetrievalQueryStrategyComparisonCaseEvidenceV1 } from "./types.js";

export type RetrievalQueryStrategyLocalSubjectExecutionResult = {
  /** Unprojected, in-memory case evidence. It must go through the privacy projection before any persistence. */
  caseEvidence: RetrievalQueryStrategyComparisonCaseEvidenceV1[];
  /** Privacy-lean immutability outcome; the full comparison is only attached to a failure. */
  immutability: { status: "unchanged"; preExistingGitStatusEntryCount: number; newMutationCount: 0 };
};

/** Test seams only; production callers use the real owners. */
export type RetrievalQueryStrategyLocalSubjectDependencies = {
  buildIndex: typeof buildMyDevKitIndex;
  executeCase: typeof executeRetrievalQueryStrategyCaseFromPreparedIndex;
};

export type RetrievalQueryStrategyLocalSubjectExecutionArgs = {
  subject: LocalRepositorySubject;
  kitCommand: string;
  /** Lab-owned directory that must be outside the subject repository; the private scratch is created inside it. */
  workRoot: string;
  dependencies?: Partial<RetrievalQueryStrategyLocalSubjectDependencies>;
  /** Test seam for scratch removal. */
  scratchIo?: PrivateScratchIo;
};

/**
 * Counts distinct repository-relative file identities exposed by the seven strategy-neutral evidence objects that lie
 * outside the eligible subject universe. It inspects every non-null evidence file path and evidence symbol file, never
 * source text, command output or node IDs. Only the count leaves this function; an offending identity is never named.
 */
export function countRetrievalQueryStrategyFilesOutsideEligibleUniverse(
  caseEvidence: RetrievalQueryStrategyComparisonCaseEvidenceV1,
  eligibleFiles: ReadonlySet<string>
): number {
  const identities = new Set<string>();
  for (const treatment of caseEvidence.treatments) {
    if (treatment.evidence === null) continue;
    for (const file of treatment.evidence.files) identities.add(file.path);
    for (const symbol of treatment.evidence.symbols) {
      if (symbol.file !== null) identities.add(symbol.file);
    }
  }
  return [...identities].filter((identity) => !eligibleFiles.has(identity)).length;
}

/**
 * Runs a loaded local subject through the seven-strategy comparison. One private base index per configured case (each
 * case keeps its own exact source roots), all seven treatments from that one base, a private scratch outside the
 * target, and pre/post target-immutability enforcement. It performs NO durable artifact writes; success is returned
 * only when every safety gate passed. A mutated target is never reverted. Issue messages are fixed text and counts.
 */
export async function executeLocalRepositorySubjectRetrievalQueryStrategyComparison(
  args: RetrievalQueryStrategyLocalSubjectExecutionArgs
): Promise<RetrievalQueryStrategyLocalSubjectExecutionResult> {
  const { subject } = args;
  const buildIndex = args.dependencies?.buildIndex ?? buildMyDevKitIndex;
  const executeCase = args.dependencies?.executeCase ?? executeRetrievalQueryStrategyCaseFromPreparedIndex;

  await assertWorkRootOutsideTarget(args.workRoot, subject.repositoryRoot);
  const guidedExclusions = deriveGuidedIndexExclusions({
    eligibleFiles: subject.eligibleFiles,
    excludedFiles: [...subject.runtimeSafetyExclusions.gitIgnoredFiles, ...subject.runtimeSafetyExclusions.oversizedFiles]
  });

  if (subject.evaluationCases.some((evaluationCase) => validateRetrievalPrecisionRecallCase(evaluationCase).length > 0)) {
    throw new LocalSubjectExecutionError([
      { code: "GROUND_TRUTH_INVALID", message: "retrieval comparison ground truth is incomplete for configured case(s)." }
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
  const caseEvidence: RetrievalQueryStrategyComparisonCaseEvidenceV1[] = [];
  const eligible = new Set(subject.eligibleFiles);

  for (const [position, evaluationCase] of subject.evaluationCases.entries()) {
    // Short, fixed segments: private case or repository names never become directory names.
    const caseIndexRoot = path.join(scratch.path, `i${position + 1}`);
    const baseIndexDir = path.join(caseIndexRoot, "base");
    const commandsRoot = path.join(scratch.path, `c${position + 1}`);
    try {
      // requireKit: false keeps a failed index as a result we can classify instead of an arbitrary thrown message.
      const build = await buildIndex({
        target: { absoluteTargetRoot: evaluationCase.absoluteTargetRoot, sourceRoots: [...evaluationCase.sourceRoots] },
        kitCommand: args.kitCommand,
        indexDir: baseIndexDir,
        commandsDir: path.join(commandsRoot, "index"),
        requireKit: false,
        excludePaths: guidedExclusions
      });
      if (!build.ok) {
        issues.push({ code: "EXECUTION_FAILED", message: "retrieval comparison index preparation failed for a configured case." });
        break;
      }
      const evidence = await executeCase({
        evaluationCase,
        kitCommand: args.kitCommand,
        baseIndexDir,
        commandsDir: path.join(commandsRoot, "retrieval"),
        semanticIndexesRoot: path.join(caseIndexRoot, "strategies")
      });
      const outside = countRetrievalQueryStrategyFilesOutsideEligibleUniverse(evidence, eligible);
      if (outside > 0) {
        issues.push({
          code: "RETRIEVAL_OUTSIDE_ELIGIBLE_UNIVERSE",
          message: `retrieval comparison exposed ${outside} file identit${outside === 1 ? "y" : "ies"} outside the eligible subject universe.`
        });
        break;
      }
      caseEvidence.push(evidence);
    } catch {
      issues.push({ code: "EXECUTION_FAILED", message: "retrieval comparison execution failed for a configured case." });
      break;
    }
  }

  // Attempted even after a primary failure so a target mutation is never masked.
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
