import { lstatSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, renameSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { relativeWithinRoot, resolveWithinRoot } from "../../core/pathSafety.js";
import { buildSyntheticEvaluationCase } from "./evaluationCase.js";
import {
  SYNTHETIC_REPOSITORY_MANIFEST_FILE_NAME,
  SYNTHETIC_REPOSITORY_REPOSITORY_DIRECTORY,
  buildSyntheticRepositoryManifest,
  serializeSyntheticRepositoryManifest,
} from "./manifest.js";
import type { SyntheticRepositoryManifestV1 } from "./manifest.js";
import { verifySyntheticRepositoryMaterialization } from "./manifestVerification.js";
import { renderSyntheticRepository } from "./renderRepository.js";
import { SyntheticRepositoryRenderError } from "./renderShared.js";
import { SyntheticRepositoryPlanningError } from "./types.js";
import type { SyntheticRepositoryPlanV1 } from "./types.js";
import { verifySyntheticRepositoryPlan } from "./planning.js";
import type { EvaluationCase } from "../types.js";

export type SyntheticRepositoryMaterializationErrorCode = "invalid-plan" | "render-failed" | "path-escape" | "collision" | "io-failure";

/** Thrown for every materialization failure; `code` classifies it and `errors` carries bounded evidence. */
export class SyntheticRepositoryMaterializationError extends Error {
  readonly code: SyntheticRepositoryMaterializationErrorCode;
  readonly errors: readonly string[];

  constructor(code: SyntheticRepositoryMaterializationErrorCode, errors: readonly string[]) {
    super(`Synthetic repository materialization failed (${code}): ${errors.join("; ")}`);
    this.name = "SyntheticRepositoryMaterializationError";
    this.code = code;
    this.errors = [...errors];
  }
}

export type SyntheticRepositoryMaterialization = {
  plan: SyntheticRepositoryPlanV1;
  manifest: SyntheticRepositoryManifestV1;
  /** Physical runtime path of the manifest (sibling of the repository directory). */
  manifestPath: string;
  /** Physical runtime path of the generated repository; also the EvaluationCase absoluteTargetRoot. */
  repositoryRoot: string;
  evaluationCase: EvaluationCase;
  reusedExistingMaterialization: boolean;
};

/** Injectable I/O seam so failure cleanup can be exercised; defaults to node:fs. */
export type SyntheticRepositoryMaterializationIo = {
  writeFile: (absolutePath: string, bytes: Buffer) => void;
};

const STAGING_PREFIX = ".synthetic-staging-";

function withinRealRoot(realRoot: string, candidate: string): boolean {
  try {
    relativeWithinRoot(realRoot, realpathSync(candidate));
    return true;
  } catch {
    return false;
  }
}

function exists(target: string): boolean {
  try {
    lstatSync(target);
    return true;
  } catch {
    return false;
  }
}

function describeExisting(
  caseDirectory: string,
  expectedManifestText: string
): { reusable: true } | { reusable: false; reasons: string[] } {
  const stats = lstatSync(caseDirectory);
  if (stats.isSymbolicLink() || !stats.isDirectory()) return { reusable: false, reasons: ["existing output child is not a plain directory."] };
  const manifestPath = path.join(caseDirectory, SYNTHETIC_REPOSITORY_MANIFEST_FILE_NAME);
  const repositoryRoot = path.join(caseDirectory, SYNTHETIC_REPOSITORY_REPOSITORY_DIRECTORY);
  let manifestText: string;
  try {
    manifestText = readFileSync(manifestPath, "utf8");
  } catch {
    return { reusable: false, reasons: ["existing output child has no readable synthetic manifest."] };
  }
  if (manifestText !== expectedManifestText) {
    return { reusable: false, reasons: ["existing manifest differs from the manifest of the requested generation."] };
  }
  const repositoryStats = exists(repositoryRoot) ? lstatSync(repositoryRoot) : undefined;
  if (!repositoryStats || repositoryStats.isSymbolicLink() || !repositoryStats.isDirectory()) {
    return { reusable: false, reasons: ["existing repository directory is missing or not a plain directory."] };
  }
  const verification = verifySyntheticRepositoryMaterialization({ manifestPath, repositoryRoot });
  if (!verification.ok) return { reusable: false, reasons: verification.issues };
  return { reusable: true };
}

/**
 * Materializes a frozen Batch 1 plan below `outputRoot/<caseId>/` as `repository/` plus a sibling
 * `synthetic-repository-manifest.json`. The plan is the single semantic source of truth: it is verified, never
 * re-planned or repaired. A deterministic existing directory is reused only when its manifest and every file
 * match the requested generation exactly; any other existing child is a collision. Writes go to an owned staging
 * directory that is verified and then renamed into place; on failure only that staging directory is removed.
 */
export function materializeSyntheticRepository(
  plan: SyntheticRepositoryPlanV1,
  outputRoot: string,
  io: Partial<SyntheticRepositoryMaterializationIo> = {}
): SyntheticRepositoryMaterialization {
  try {
    verifySyntheticRepositoryPlan(plan);
  } catch (error) {
    if (error instanceof SyntheticRepositoryPlanningError) throw new SyntheticRepositoryMaterializationError("invalid-plan", error.errors);
    throw error;
  }

  let files;
  try {
    files = renderSyntheticRepository(plan);
  } catch (error) {
    if (error instanceof SyntheticRepositoryRenderError) throw new SyntheticRepositoryMaterializationError("render-failed", error.errors);
    throw error;
  }
  const manifest = buildSyntheticRepositoryManifest(plan, files);
  const manifestText = serializeSyntheticRepositoryManifest(manifest);

  let realRoot: string;
  try {
    mkdirSync(path.resolve(outputRoot), { recursive: true });
    realRoot = realpathSync(path.resolve(outputRoot));
  } catch (error) {
    throw new SyntheticRepositoryMaterializationError("io-failure", [`output root is not usable: ${error instanceof Error ? error.message : String(error)}`]);
  }
  let caseDirectory: string;
  try {
    caseDirectory = resolveWithinRoot(realRoot, plan.caseId);
  } catch (error) {
    throw new SyntheticRepositoryMaterializationError("path-escape", [error instanceof Error ? error.message : String(error)]);
  }
  const result = (reused: boolean): SyntheticRepositoryMaterialization => {
    const repositoryRoot = path.join(caseDirectory, SYNTHETIC_REPOSITORY_REPOSITORY_DIRECTORY);
    return {
      plan,
      manifest,
      manifestPath: path.join(caseDirectory, SYNTHETIC_REPOSITORY_MANIFEST_FILE_NAME),
      repositoryRoot,
      evaluationCase: buildSyntheticEvaluationCase(plan, manifest, repositoryRoot),
      reusedExistingMaterialization: reused,
    };
  };

  if (exists(caseDirectory)) {
    if (!withinRealRoot(realRoot, caseDirectory)) {
      throw new SyntheticRepositoryMaterializationError("path-escape", ["existing output child resolves outside the output root."]);
    }
    const existing = describeExisting(caseDirectory, manifestText);
    if (!existing.reusable) {
      throw new SyntheticRepositoryMaterializationError("collision", [
        `output child ${plan.caseId} already exists and is not an exact materialization of this generation; nothing was changed.`,
        ...existing.reasons,
      ]);
    }
    return result(true);
  }

  const writeFile = io.writeFile ?? ((absolutePath: string, bytes: Buffer): void => writeFileSync(absolutePath, bytes, { flag: "wx" }));
  let staging: string | undefined;
  try {
    staging = mkdtempSync(path.join(realRoot, STAGING_PREFIX));
    if (!withinRealRoot(realRoot, staging)) throw new SyntheticRepositoryMaterializationError("path-escape", ["staging directory resolves outside the output root."]);
    const stagedRepository = path.join(staging, SYNTHETIC_REPOSITORY_REPOSITORY_DIRECTORY);
    mkdirSync(stagedRepository);
    for (const file of files) {
      let target: string;
      try {
        target = resolveWithinRoot(stagedRepository, file.path);
      } catch (error) {
        throw new SyntheticRepositoryMaterializationError("path-escape", [error instanceof Error ? error.message : String(error)]);
      }
      mkdirSync(path.dirname(target), { recursive: true });
      writeFile(target, Buffer.from(file.content, "utf8"));
    }
    const stagedManifest = path.join(staging, SYNTHETIC_REPOSITORY_MANIFEST_FILE_NAME);
    writeFile(stagedManifest, Buffer.from(manifestText, "utf8"));

    const verification = verifySyntheticRepositoryMaterialization({ manifestPath: stagedManifest, repositoryRoot: stagedRepository });
    if (!verification.ok) throw new SyntheticRepositoryMaterializationError("io-failure", ["staged files failed manifest verification.", ...verification.issues]);
    if (exists(caseDirectory)) {
      throw new SyntheticRepositoryMaterializationError("collision", [`output child ${plan.caseId} appeared during materialization; nothing was overwritten.`]);
    }
    renameSync(staging, caseDirectory);
    staging = undefined;
  } catch (error) {
    if (staging !== undefined) rmSync(staging, { recursive: true, force: true });
    if (error instanceof SyntheticRepositoryMaterializationError) throw error;
    throw new SyntheticRepositoryMaterializationError("io-failure", [error instanceof Error ? error.message : String(error)]);
  }
  return result(false);
}
