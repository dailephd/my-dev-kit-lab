import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import type { DisposableTreatmentTargetV1, IncrementalChangeStalenessTreatmentId } from "./disposableTarget.js";
import { resolveWithinDisposableTarget } from "./disposableTarget.js";
import { applyMutationOperations, isPathCoveredBySourceRoots, sha256Hex } from "./scenarioMutation.js";
import type { IncrementalChangeStalenessMutationFile, IncrementalChangeStalenessScenario } from "./scenarioTypes.js";

export const INCREMENTAL_CHANGE_STALENESS_MUTATION_RECEIPT_SCHEMA_VERSION = "1.0.0";

export type IncrementalChangeStalenessMutationStatus = "applied" | "rejected";

/**
 * Bounded per-file execution evidence: hashes and status only, never full
 * original or mutated source contents (the scenario catalog remains the
 * authority for exact replacement text).
 */
export type IncrementalChangeStalenessMutationFileReceipt = {
  path: string;
  expectedPreSha256: string;
  observedPreSha256: string | null;
  operationCount: number;
  expectedPostSha256: string;
  observedPostSha256: string | null;
  written: boolean;
  error?: string;
};

export type IncrementalChangeStalenessMutationReceiptV1 = {
  schemaVersion: string;
  scenarioId: string;
  treatmentId: IncrementalChangeStalenessTreatmentId;
  benchmarkProjectId: string;
  status: IncrementalChangeStalenessMutationStatus;
  files: IncrementalChangeStalenessMutationFileReceipt[];
  errors: string[];
};

function canonicalBenchmarkProjectsRoot(repoRoot: string): string {
  return path.resolve(repoRoot, "benchmarks/projects");
}

function isWithin(root: string, candidate: string): boolean {
  const relative = path.relative(root, candidate);
  return relative !== "" && !relative.startsWith("..") && !path.isAbsolute(relative);
}

type PlannedWrite = {
  fileDeclaration: IncrementalChangeStalenessMutationFile;
  absolutePath: string;
  mutatedBuffer: Buffer;
};

/**
 * Executes one scenario's already-validated mutation plan against ONE
 * disposable treatment copy. Re-validates every guard at execution time
 * (path containment/coverage, pre-hash, ordered exact-preimage replacement,
 * post-hash) rather than trusting that Batch 1 catalog validation still
 * holds, because a disposable copy can drift between creation and mutation.
 *
 * Two-phase: every file is fully validated and its post-mutation bytes
 * computed in memory BEFORE any filesystem write begins. Writes only start
 * once the complete plan is internally valid. If a later write/verification
 * fails, files already written and verified remain recorded as such; the
 * overall receipt status is "rejected" and no file is misreported as
 * successfully mutated.
 */
export async function executeIncrementalChangeStalenessMutation(
  scenario: IncrementalChangeStalenessScenario,
  target: DisposableTreatmentTargetV1,
  caseSourceRoots: readonly string[],
  repoRoot: string
): Promise<IncrementalChangeStalenessMutationReceiptV1> {
  const base = (): Omit<IncrementalChangeStalenessMutationReceiptV1, "status" | "files" | "errors"> => ({
    schemaVersion: INCREMENTAL_CHANGE_STALENESS_MUTATION_RECEIPT_SCHEMA_VERSION,
    scenarioId: scenario.id,
    treatmentId: target.treatmentId,
    benchmarkProjectId: target.benchmarkProjectId
  });

  const canonicalRoot = canonicalBenchmarkProjectsRoot(repoRoot);
  if (isWithin(canonicalRoot, path.resolve(target.targetRoot)) || path.resolve(target.targetRoot) === canonicalRoot) {
    return {
      ...base(),
      status: "rejected",
      files: [],
      errors: [`Refusing to mutate a canonical benchmark target directly: ${target.targetRoot}.`]
    };
  }

  const fileReceipts: IncrementalChangeStalenessMutationFileReceipt[] = [];
  const plannedWrites: PlannedWrite[] = [];
  const errors: string[] = [];

  // Phase 1: validate every file and compute post-mutation bytes in memory. No writes yet.
  for (const fileDeclaration of scenario.mutation.files) {
    const label = `${scenario.id}/${target.treatmentId}: ${fileDeclaration.path}`;
    const receipt: IncrementalChangeStalenessMutationFileReceipt = {
      path: fileDeclaration.path,
      expectedPreSha256: fileDeclaration.expectedPreSha256,
      observedPreSha256: null,
      operationCount: fileDeclaration.operations.length,
      expectedPostSha256: fileDeclaration.expectedPostSha256,
      observedPostSha256: null,
      written: false
    };

    if (!isPathCoveredBySourceRoots(fileDeclaration.path, caseSourceRoots)) {
      receipt.error = `${label}: path is not covered by the referenced case's indexed source roots.`;
      errors.push(receipt.error);
      fileReceipts.push(receipt);
      return { ...base(), status: "rejected", files: fileReceipts, errors };
    }

    let absolutePath: string;
    try {
      absolutePath = await resolveWithinDisposableTarget(target, fileDeclaration.path);
    } catch (error) {
      receipt.error = `${label}: ${(error as Error).message}`;
      errors.push(receipt.error);
      fileReceipts.push(receipt);
      return { ...base(), status: "rejected", files: fileReceipts, errors };
    }

    let buffer: Buffer;
    try {
      buffer = await readFile(absolutePath);
    } catch (error) {
      receipt.error = `${label}: unable to read disposable file: ${(error as Error).message}`;
      errors.push(receipt.error);
      fileReceipts.push(receipt);
      return { ...base(), status: "rejected", files: fileReceipts, errors };
    }

    const observedPreSha256 = sha256Hex(buffer);
    receipt.observedPreSha256 = observedPreSha256;
    if (observedPreSha256 !== fileDeclaration.expectedPreSha256) {
      receipt.error = `${label}: expectedPreSha256 ${fileDeclaration.expectedPreSha256} does not match observed ${observedPreSha256}.`;
      errors.push(receipt.error);
      fileReceipts.push(receipt);
      return { ...base(), status: "rejected", files: fileReceipts, errors };
    }

    let mutatedText: string;
    try {
      mutatedText = applyMutationOperations(buffer.toString("utf8"), fileDeclaration.operations);
    } catch (error) {
      receipt.error = `${label}: ${(error as Error).message}`;
      errors.push(receipt.error);
      fileReceipts.push(receipt);
      return { ...base(), status: "rejected", files: fileReceipts, errors };
    }

    const mutatedBuffer = Buffer.from(mutatedText, "utf8");
    const computedPostSha256 = sha256Hex(mutatedBuffer);
    if (computedPostSha256 !== fileDeclaration.expectedPostSha256) {
      receipt.error = `${label}: expectedPostSha256 ${fileDeclaration.expectedPostSha256} does not match computed in-memory post-mutation SHA-256 ${computedPostSha256}.`;
      errors.push(receipt.error);
      fileReceipts.push(receipt);
      return { ...base(), status: "rejected", files: fileReceipts, errors };
    }

    fileReceipts.push(receipt);
    plannedWrites.push({ fileDeclaration, absolutePath, mutatedBuffer });
  }

  // Phase 2: every file validated. Write, then re-read/re-hash to verify the actual on-disk result.
  for (const [index, planned] of plannedWrites.entries()) {
    const receipt = fileReceipts[index];
    const label = `${scenario.id}/${target.treatmentId}: ${planned.fileDeclaration.path}`;
    try {
      await writeFile(planned.absolutePath, planned.mutatedBuffer);
    } catch (error) {
      receipt.error = `${label}: write failed: ${(error as Error).message}`;
      errors.push(receipt.error);
      return { ...base(), status: "rejected", files: fileReceipts, errors };
    }

    let rereadBuffer: Buffer;
    try {
      rereadBuffer = await readFile(planned.absolutePath);
    } catch (error) {
      receipt.error = `${label}: post-write re-read failed: ${(error as Error).message}`;
      errors.push(receipt.error);
      return { ...base(), status: "rejected", files: fileReceipts, errors };
    }

    const observedPostSha256 = sha256Hex(rereadBuffer);
    receipt.observedPostSha256 = observedPostSha256;
    if (observedPostSha256 !== planned.fileDeclaration.expectedPostSha256) {
      receipt.error = `${label}: post-write SHA-256 ${observedPostSha256} does not match expected ${planned.fileDeclaration.expectedPostSha256}.`;
      errors.push(receipt.error);
      return { ...base(), status: "rejected", files: fileReceipts, errors };
    }

    receipt.written = true;
  }

  return { ...base(), status: "applied", files: fileReceipts, errors: [] };
}
