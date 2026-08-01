// v0.4.5 Batch 4: bounded end-to-end fixture loader (section 22). Loads a frozen
// context-integrity ecosystem fixture (failed-run or corrected-replay) through the existing
// Batch 1 producer readers and Batch 3 run-integrity reader, verifies hashes, and rejects
// path traversal. It never recalculates metrics itself -- evaluation happens through the
// existing evaluateProducerReadinessBridge, called by the test/consumer, not by this loader.
import { readFile } from "node:fs/promises";
import path from "node:path";
import type { ContextCapsule, OrchestratorRunIntegrityEvidenceV1, RetrievalAuditRecord } from "../upstreamArtifacts/index.js";
import { readMyDevKitContextCapsuleV1 } from "../upstreamArtifacts/readMyDevKitContextCapsuleV1.js";
import { readMyDevKitRetrievalAuditRecordV1 } from "../upstreamArtifacts/readMyDevKitRetrievalAuditRecordV1.js";
import { readOrchestratorRunIntegrityEvidenceV1 } from "../upstreamArtifacts/readOrchestratorRunIntegrityV1.js";
import type { EcosystemFixtureManifestV1 } from "./manifestTypes.js";
import { isSafeFixtureRelativePath, validateEcosystemFixtureManifest } from "./validateManifest.js";
import { verifyFixtureHashes, type FixtureHashVerificationResult } from "./verifyFixtureHashes.js";

export interface ContextIntegrityFixtureLoadResult {
  ok: boolean;
  manifest: EcosystemFixtureManifestV1 | null;
  hashVerification: FixtureHashVerificationResult | null;
  implementationCapsule: ContextCapsule | null;
  implementationAudit: RetrievalAuditRecord | null;
  runIntegrityEvidence: OrchestratorRunIntegrityEvidenceV1 | null;
  issues: string[];
}

function findEntry(manifest: EcosystemFixtureManifestV1, role: string) {
  return manifest.artifacts.find((a) => a.role === role && a.evaluationUse);
}

export async function loadContextIntegrityFixture(fixtureRoot: string, manifestPath: string): Promise<ContextIntegrityFixtureLoadResult> {
  const issues: string[] = [];

  let manifestRaw: unknown;
  try {
    manifestRaw = JSON.parse(await readFile(manifestPath, "utf8"));
  } catch (error) {
    return {
      ok: false,
      manifest: null,
      hashVerification: null,
      implementationCapsule: null,
      implementationAudit: null,
      runIntegrityEvidence: null,
      issues: [`Manifest at "${manifestPath}" could not be read or parsed: ${(error as Error).message}`]
    };
  }

  const manifestResult = validateEcosystemFixtureManifest(manifestRaw);
  if (!manifestResult.ok) {
    return {
      ok: false,
      manifest: null,
      hashVerification: null,
      implementationCapsule: null,
      implementationAudit: null,
      runIntegrityEvidence: null,
      issues: manifestResult.issues.map((i) => `[${i.code}] ${i.fieldPath}: ${i.message}`)
    };
  }
  const manifest = manifestResult.manifest;

  const hashVerification = await verifyFixtureHashes(manifest, fixtureRoot);
  if (!hashVerification.ok) {
    issues.push(...hashVerification.issues.map((i) => `[${i.code}] ${i.fixtureRelativePath}: ${i.message}`));
  }

  function resolveSafe(relativePath: string): string | null {
    if (!isSafeFixtureRelativePath(relativePath)) {
      issues.push(`Refused to resolve unsafe fixture-relative path "${relativePath}".`);
      return null;
    }
    return path.resolve(fixtureRoot, relativePath);
  }

  let implementationCapsule: ContextCapsule | null = null;
  const capsuleEntry = findEntry(manifest, "context-capsule");
  if (capsuleEntry) {
    const resolved = resolveSafe(capsuleEntry.fixtureRelativePath);
    if (resolved) {
      const result = await readMyDevKitContextCapsuleV1(resolved);
      if (result.ok) implementationCapsule = result.artifact;
      else issues.push(`context-capsule reader failed for "${capsuleEntry.fixtureRelativePath}": [${result.code}] ${result.message}`);
    }
  }

  let implementationAudit: RetrievalAuditRecord | null = null;
  const auditEntry = findEntry(manifest, "retrieval-audit-record");
  if (auditEntry) {
    const resolved = resolveSafe(auditEntry.fixtureRelativePath);
    if (resolved) {
      const result = await readMyDevKitRetrievalAuditRecordV1(resolved);
      if (result.ok) implementationAudit = result.artifact;
      else issues.push(`retrieval-audit-record reader failed for "${auditEntry.fixtureRelativePath}": [${result.code}] ${result.message}`);
    }
  }

  let runIntegrityEvidence: OrchestratorRunIntegrityEvidenceV1 | null = null;
  const runIntegrityEntry = findEntry(manifest, "run-integrity-evidence");
  if (runIntegrityEntry) {
    const resolved = resolveSafe(runIntegrityEntry.fixtureRelativePath);
    if (resolved) {
      const result = await readOrchestratorRunIntegrityEvidenceV1(resolved);
      if (result.ok) runIntegrityEvidence = result.artifact;
      else issues.push(`run-integrity-evidence reader failed for "${runIntegrityEntry.fixtureRelativePath}": [${result.code}] ${result.message}`);
    }
  }

  return {
    ok: issues.length === 0,
    manifest,
    hashVerification,
    implementationCapsule,
    implementationAudit,
    runIntegrityEvidence,
    issues
  };
}
