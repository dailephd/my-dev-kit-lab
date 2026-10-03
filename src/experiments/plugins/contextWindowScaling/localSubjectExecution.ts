import path from "node:path";
import { relativeWithinRoot } from "../../../core/pathSafety.js";
import type { LocalRepositorySubject } from "../../../evaluation/localRepositorySubject/index.js";
import { runMyDevKitRetrieval } from "../../../evaluation/runMyDevKitRetrieval.js";
import { runRawFullFileBaseline } from "../../../evaluation/runRawFullFileBaseline.js";
import { captureTargetSnapshot, compareTargetSnapshots } from "../../../evaluation/targetImmutability/index.js";
import type {
  V043TargetImmutabilityComparisonV1,
  V043TargetSnapshotResult,
} from "../../../evaluation/targetImmutability/index.js";
import {
  executeContextWindowScalingCases,
  type ContextWindowScalingDependencies,
} from "./execution.js";
import type { CaseExecutionEvidenceV1 } from "./executionArtifact.js";
import {
  LocalSubjectExecutionError,
  redactPrivatePaths,
  type LocalSubjectExecutionIssue,
} from "./localSubjectErrors.js";
import { deriveGuidedIndexExclusions } from "./localSubjectExclusions.js";
import {
  assertWorkRootOutsideTarget,
  createPrivateScratch,
  defaultPrivateScratchIo,
  removePrivateScratch,
  type PrivateScratchIo,
} from "./localSubjectScratch.js";
import { resolveScalingProjectProfiles } from "./projectProfile.js";
import type { ContextBudgetTokens } from "./types.js";

export type LocalSubjectExecutionResult = {
  /** Existing per-case execution evidence, produced by the unchanged context-window core. */
  caseEvidence: CaseExecutionEvidenceV1[];
  /** Privacy-lean immutability outcome; the full comparison is only attached to a failure. */
  immutability: {
    status: "unchanged";
    preExistingGitStatusEntryCount: number;
    newMutationCount: 0;
  };
};

export type LocalSubjectExecutionArgs = {
  subject: LocalRepositorySubject;
  contextBudgets: readonly ContextBudgetTokens[];
  kitCommand: string;
  /** Lab-owned directory that must be outside the subject repository; the private scratch is created inside it. */
  workRoot: string;
  env?: NodeJS.ProcessEnv;
  /**
   * Existing injectable seam of the execution core. Entries override the safe local constructors, so this exists
   * for fault injection in tests, not for production callers.
   */
  dependencies?: Partial<ContextWindowScalingDependencies>;
  /** Test seam for scratch removal. */
  scratchIo?: PrivateScratchIo;
};

function toRepositoryRelative(repositoryRoot: string, file: string): string {
  const slashed = file.replace(/\\/g, "/");
  if (path.isAbsolute(file)) {
    try {
      return relativeWithinRoot(repositoryRoot, file);
    } catch {
      return slashed;
    }
  }
  return slashed.replace(/^\.\//, "");
}

/** Safe local constructors: raw context from eligible files only; guided retrieval over the original root. */
function createSafeLocalDependencies(
  subject: LocalRepositorySubject,
  guidedExclusions: readonly string[]
): Pick<ContextWindowScalingDependencies, "constructRawContext" | "constructGuidedContext"> {
  const eligible = new Set(subject.eligibleFiles);
  return {
    constructRawContext: (evaluationCase) => runRawFullFileBaseline(evaluationCase, { eligibleFiles: subject.eligibleFiles }),
    constructGuidedContext: async ({ evaluationCase, kitCommand, outputDir }) => {
      const result = await runMyDevKitRetrieval({
        evaluationCase,
        kitCommand,
        outputDir,
        requireKit: false,
        excludePaths: guidedExclusions,
      });
      const returned = [...result.filesRead, ...(result.selectedFile ? [result.selectedFile] : [])];
      const outside = returned.filter((file) => !eligible.has(toRepositoryRelative(subject.repositoryRoot, file)));
      if (outside.length > 0) {
        throw new Error(
          `Guided retrieval returned ${outside.length} file(s) outside the eligible subject universe: ${outside
            .map((file) => toRepositoryRelative(subject.repositoryRoot, file))
            .join(", ")}`
        );
      }
      return result;
    },
  };
}

/**
 * Internal programmatic seam: runs a loaded Batch 1 local subject through the existing context-window core with
 * safe raw and guided constructors, a private scratch outside the target, and pre/post target-immutability
 * enforcement. Order: validate work root, derive exclusions, capture before, create scratch, execute, capture after,
 * compare, remove scratch, then decide. Success is returned only when execution, immutability and cleanup all pass.
 * A mutated target is never reverted.
 */
export async function executeLocalRepositorySubjectContextWindowScaling(
  args: LocalSubjectExecutionArgs
): Promise<LocalSubjectExecutionResult> {
  const { subject } = args;
  await assertWorkRootOutsideTarget(args.workRoot, subject.repositoryRoot);
  const guidedExclusions = deriveGuidedIndexExclusions({
    eligibleFiles: subject.eligibleFiles,
    excludedFiles: [...subject.runtimeSafetyExclusions.gitIgnoredFiles, ...subject.runtimeSafetyExclusions.oversizedFiles],
  });

  const snapshotConfig = { targetRootPath: subject.repositoryRoot, relativeFilePaths: subject.eligibleFiles };
  const snapshotOptions = { externalLocalSafe: { maxHashedFileBytes: subject.manifest.safetyPolicy.maxFileBytes } };
  const before: V043TargetSnapshotResult = await captureTargetSnapshot(snapshotConfig, snapshotOptions);
  if (!before.ok) {
    throw new LocalSubjectExecutionError([
      { code: "BEFORE_SNAPSHOT_FAILED", message: `target snapshot before execution failed (${before.code}).` },
    ]);
  }

  const scratch = await createPrivateScratch(args.workRoot, subject.repositoryRoot);
  const privatePaths = [subject.repositoryRoot, scratch.path, path.resolve(args.workRoot)];
  const redact = (message: string): string => redactPrivatePaths(message, privatePaths);
  const issues: LocalSubjectExecutionIssue[] = [];
  let caseEvidence: CaseExecutionEvidenceV1[] | null = null;

  try {
    const projectProfiles = resolveScalingProjectProfiles(subject.evaluationCases, [], { eligibleFiles: subject.eligibleFiles });
    caseEvidence = await executeContextWindowScalingCases({
      cases: subject.evaluationCases,
      contextBudgets: args.contextBudgets,
      kitCommand: args.kitCommand,
      outputRoot: scratch.path,
      projectProfiles,
      cwd: scratch.path,
      env: args.env,
      dependencies: { ...createSafeLocalDependencies(subject, guidedExclusions), ...args.dependencies },
    });
  } catch (error) {
    issues.push({
      code: "EXECUTION_FAILED",
      message: redact(`execution threw: ${error instanceof Error ? error.message : String(error)}`),
    });
  }

  if (caseEvidence) {
    for (const caseResult of caseEvidence) {
      for (const treatment of caseResult.treatments) {
        if (treatment.status === "failed" || treatment.errors.length > 0) {
          issues.push({
            code: "EXECUTION_FAILED",
            message: redact(
              `case ${caseResult.caseId} treatment ${treatment.variantId} failed: ${treatment.errors
                .map((entry) => `${entry.code}: ${entry.message}`)
                .join("; ")}`
            ),
          });
        }
      }
    }
  }

  let comparison: V043TargetImmutabilityComparisonV1 | null = null;
  const after = await captureTargetSnapshot(snapshotConfig, snapshotOptions);
  if (!after.ok) {
    issues.push({ code: "AFTER_SNAPSHOT_FAILED", message: `target snapshot after execution failed (${after.code}).` });
  } else {
    comparison = compareTargetSnapshots(before.snapshot, after.snapshot);
    if (comparison.status === "mutated") {
      issues.push({
        code: "TARGET_MUTATED",
        message: `the target changed during execution (${comparison.mutations.map((mutation) => mutation.id).join(", ")}); it was not restored.`,
      });
    }
  }

  const cleanupFailure = await removePrivateScratch(scratch, args.scratchIo ?? defaultPrivateScratchIo);
  if (cleanupFailure) {
    issues.push({ code: "SCRATCH_CLEANUP_FAILED", message: redact(cleanupFailure) });
  }

  if (issues.length > 0 || !caseEvidence || !comparison) {
    throw new LocalSubjectExecutionError(issues, { caseEvidence, immutability: comparison });
  }
  return {
    caseEvidence,
    immutability: {
      status: "unchanged",
      preExistingGitStatusEntryCount: comparison.preExistingGitStatusEntryCount,
      newMutationCount: 0,
    },
  };
}
