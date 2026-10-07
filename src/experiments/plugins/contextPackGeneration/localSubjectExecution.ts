import path from "node:path";
import type { LocalRepositorySubject } from "../../../evaluation/localRepositorySubject/index.js";
import { validateRetrievalPrecisionRecallCase } from "../../../evaluation/retrievalQuality/index.js";
import { buildMyDevKitIndex } from "../../../evaluation/runMyDevKitRetrieval.js";
import { runRawFullFileBaseline } from "../../../evaluation/runRawFullFileBaseline.js";
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
import { executeContextPackGeneration, type ContextPackGenerationDependencies } from "./execution.js";
import type { ContextPackGenerationCaseResult } from "./executionTypes.js";

export type ContextPackLocalSubjectExecutionResult = {
  /** Unprojected, in-memory results (real identities and the real pack). They must be projected before any persistence. */
  results: ContextPackGenerationCaseResult[];
  /** Privacy-lean immutability outcome; the full comparison is only attached to a failure. */
  immutability: { status: "unchanged"; preExistingGitStatusEntryCount: number; newMutationCount: 0 };
};

export type ContextPackLocalSubjectExecutionArgs = {
  subject: LocalRepositorySubject;
  kitCommand: string;
  /** Lab-owned directory that must be outside the subject repository; the private scratch is created inside it. */
  workRoot: string;
  /** Test seams only; production callers use the real execution owners. */
  dependencies?: Partial<ContextPackGenerationDependencies>;
  /** Test seam for scratch removal. */
  scratchIo?: PrivateScratchIo;
};

/** Repository path carried by a `file:<path>` or `symbol:<path>#<name>` node ID; null when the ID has no such shape. */
export function repositoryPathOfNodeId(nodeId: string): string | null {
  const match = /^(?:file|symbol):([^#]+)(?:#.*)?$/.exec(nodeId);
  return match ? match[1] : null;
}

/** Every real repository path identity one case result exposes through either treatment or the in-memory pack. */
export function collectContextPackFileIdentities(result: ContextPackGenerationCaseResult): Set<string> {
  const identities = new Set<string>();
  for (const treatment of result.evidence.treatments) {
    for (const file of treatment.includedFiles) identities.add(file);
    for (const file of treatment.identityEvidence?.files ?? []) identities.add(file);
    for (const symbol of treatment.identityEvidence?.symbols ?? []) {
      if (symbol.file !== undefined) identities.add(symbol.file);
    }
  }
  const pack = result.pack;
  if (pack !== null) {
    for (const file of pack.files) identities.add(file.path);
    for (const symbol of pack.symbols) {
      if (symbol.file !== null) identities.add(symbol.file);
    }
    for (const slice of pack.sourceSlices) identities.add(slice.file);
    for (const test of pack.tests) identities.add(test.path);
    for (const relationship of pack.callRelationships) {
      for (const endpoint of [relationship.fromNodeId, relationship.toNodeId]) {
        const endpointPath = repositoryPathOfNodeId(endpoint);
        if (endpointPath !== null) identities.add(endpointPath);
      }
    }
  }
  return identities;
}

/** Counts distinct file identities outside the eligible universe. Only the count leaves this function. */
export function countContextPackFilesOutsideEligibleUniverse(result: ContextPackGenerationCaseResult, eligibleFiles: ReadonlySet<string>): number {
  return [...collectContextPackFileIdentities(result)].filter((identity) => !eligibleFiles.has(identity)).length;
}

const FATAL_CASE_ERROR_CODES = new Set(["ground-truth-invalid", "project-group-inconsistent", "project-index-failed"]);

/**
 * Runs a loaded local subject through the two-treatment context-pack experiment. One private base index per configured
 * case (each case keeps its own exact source roots), a private scratch outside the target, guided exclusions so the index
 * never sees ineligible files, the raw baseline restricted to the eligible universe, and pre/post target-immutability
 * enforcement. It performs NO durable writes; success is returned only when every safety gate passed. A mutated target
 * is never reverted. Issue messages are fixed text and counts.
 */
export async function executeLocalRepositorySubjectContextPackGeneration(
  args: ContextPackLocalSubjectExecutionArgs
): Promise<ContextPackLocalSubjectExecutionResult> {
  const { subject } = args;
  await assertWorkRootOutsideTarget(args.workRoot, subject.repositoryRoot);
  const guidedExclusions = deriveGuidedIndexExclusions({
    eligibleFiles: subject.eligibleFiles,
    excludedFiles: [...subject.runtimeSafetyExclusions.gitIgnoredFiles, ...subject.runtimeSafetyExclusions.oversizedFiles]
  });

  if (subject.evaluationCases.some((evaluationCase) => validateRetrievalPrecisionRecallCase(evaluationCase).length > 0)) {
    throw new LocalSubjectExecutionError([
      { code: "GROUND_TRUTH_INVALID", message: "context-pack ground truth is incomplete for configured case(s)." }
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
  const results: ContextPackGenerationCaseResult[] = [];
  const eligible = new Set(subject.eligibleFiles);
  const baseBuildIndex = args.dependencies?.buildIndex;
  const baseRawBaseline = args.dependencies?.runRawBaseline ?? runRawFullFileBaseline;

  for (const [position, evaluationCase] of subject.evaluationCases.entries()) {
    try {
      // The experiment owner writes its indexes and command output below the case's own scratch directory (short fixed segment).
      const [caseResult] = await executeContextPackGeneration({
        cases: [evaluationCase],
        kitCommand: args.kitCommand,
        outputRoot: path.join(scratch.path, `p${position + 1}`),
        dependencies: {
          ...args.dependencies,
          // Guided exclusions keep ignored and oversized files out of the index; the raw baseline reads only eligible files.
          buildIndex: async (options) => {
            return (baseBuildIndex ?? buildMyDevKitIndex)({ ...options, excludePaths: guidedExclusions });
          },
          runRawBaseline: (rawCase) => baseRawBaseline(rawCase, { eligibleFiles: subject.eligibleFiles })
        }
      });
      if (caseResult.evidence.treatments.some((treatment) => treatment.errors.some((error) => FATAL_CASE_ERROR_CODES.has(error.code)))) {
        issues.push({ code: "EXECUTION_FAILED", message: "context-pack index preparation failed for a configured case." });
        break;
      }
      const outside = countContextPackFilesOutsideEligibleUniverse(caseResult, eligible);
      if (outside > 0) {
        issues.push({
          code: "RETRIEVAL_OUTSIDE_ELIGIBLE_UNIVERSE",
          message: `context-pack generation exposed ${outside} file identit${outside === 1 ? "y" : "ies"} outside the eligible subject universe.`
        });
        break;
      }
      results.push(caseResult);
    } catch {
      issues.push({ code: "EXECUTION_FAILED", message: "context-pack execution failed for a configured case." });
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
    results,
    immutability: { status: "unchanged", preExistingGitStatusEntryCount: comparison.preExistingGitStatusEntryCount, newMutationCount: 0 }
  };
}
