import { existsSync, mkdirSync, realpathSync } from "node:fs";
import path from "node:path";
import { relativeWithinRoot, resolveWithinRoot } from "../../../core/pathSafety.js";
import { materializeSyntheticRepository, planSyntheticRepositories } from "../../../evaluation/syntheticRepository/index.js";
import type { BenchmarkProjectProfile, EvaluationCase } from "../../../evaluation/types.js";
import { resolveScalingProjectProfiles } from "./projectProfile.js";

/**
 * Stable child of the experiment output root that owns every generated repository. Batch 2 lays each case out
 * beneath it as `<case id>/repository` plus a sibling manifest. It never collides with the execution artifact,
 * reports, `guided/`, `agents/` or `charts/`.
 */
export const SYNTHETIC_REPOSITORIES_OUTPUT_SUBDIRECTORY = "synthetic-repositories";

/** Bounded per-case projection of one Batch 2 materialization, so a caller never has to rescan the filesystem. */
export type PreparedSyntheticCase = {
  caseId: string;
  generationIdentity: string;
  repositoryContentIdentity: string;
  /** Physical runtime location; never persisted in the execution artifact. */
  repositoryRoot: string;
  manifestPath: string;
  evaluationCase: EvaluationCase;
  reusedExistingMaterialization: boolean;
};

export type PreparedSyntheticContextWindowScalingInputs = {
  /** Existing EvaluationCase objects in Batch 1 normalized (case id code-unit) order, ready for `inputs.cases`. */
  cases: EvaluationCase[];
  /** Plugin-local profiles derived in memory from the generated cases, ready for `inputs.projectProfiles`. */
  projectProfiles: BenchmarkProjectProfile[];
  materializations: PreparedSyntheticCase[];
  /** `<experiment output>/synthetic-repositories`. */
  syntheticOutputRoot: string;
};

/**
 * Internal input source for context-window-scaling: Batch 1 config -> plans -> Batch 2 materializations ->
 * EvaluationCase[] -> in-memory project profiles. It owns only that sequencing; planning, rendering, manifests,
 * profile derivation and execution all stay with their existing owners, and generated repositories are not
 * serialized into bundled case JSON (readEvaluationCases is deliberately not used).
 *
 * Fail closed: an invalid or empty config, a planner failure, a materialization collision or a verification
 * failure throws the owning typed error before any case exists. All plans are computed before the first
 * repository is written. Repeating the call with the same config and output root reuses the existing
 * materializations (Batch 2 idempotence) and returns the same identities and order.
 *
 * The caller must supply the final experiment output root; the public command resolves it before calling this
 * and passes the same root to the generic runner.
 */
export function prepareSyntheticContextWindowScalingInputs(args: {
  syntheticRepositoryConfig: unknown;
  outputRoot: string;
}): PreparedSyntheticContextWindowScalingInputs {
  const plans = planSyntheticRepositories(args.syntheticRepositoryConfig);
  const syntheticOutputRoot = resolveWithinRoot(args.outputRoot, SYNTHETIC_REPOSITORIES_OUTPUT_SUBDIRECTORY);
  assertStaysInsideOutputRoot(args.outputRoot, syntheticOutputRoot);
  const materializations: PreparedSyntheticCase[] = plans.map((plan) => {
    const materialized = materializeSyntheticRepository(plan, syntheticOutputRoot);
    return {
      caseId: plan.caseId,
      generationIdentity: plan.generationIdentity,
      repositoryContentIdentity: materialized.manifest.repositoryContentIdentity,
      repositoryRoot: materialized.repositoryRoot,
      manifestPath: materialized.manifestPath,
      evaluationCase: materialized.evaluationCase,
      reusedExistingMaterialization: materialized.reusedExistingMaterialization,
    };
  });
  const cases = materializations.map((entry) => entry.evaluationCase);
  return { cases, projectProfiles: resolveScalingProjectProfiles(cases, []), materializations, syntheticOutputRoot };
}

/** A pre-existing synthetic subtree that is a link resolving elsewhere must not redirect generation out of the experiment output. */
function assertStaysInsideOutputRoot(outputRoot: string, syntheticOutputRoot: string): void {
  mkdirSync(path.resolve(outputRoot), { recursive: true });
  if (!existsSync(syntheticOutputRoot)) return;
  try {
    relativeWithinRoot(realpathSync(path.resolve(outputRoot)), realpathSync(syntheticOutputRoot));
  } catch {
    throw new Error(`Synthetic repository output ${SYNTHETIC_REPOSITORIES_OUTPUT_SUBDIRECTORY} resolves outside the experiment output root.`);
  }
}
