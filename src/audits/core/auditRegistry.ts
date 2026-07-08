import type { AuditIssue } from "./auditIssue.js";
import type { AuditConfig } from "./auditConfig.js";
import type { AuditTarget } from "./auditTarget.js";
import type { AuditIncludeArea, AuditType } from "./auditTypes.js";
import type { ProjectInventorySnapshot } from "./projectInventory.js";
import type { SourceOfTruthSnapshot } from "./sourceOfTruth.js";
import {
  STALE_COMMAND_REFERENCE_DETECTOR,
  DOCS_CODE_MISMATCH_DETECTOR,
  PACKAGE_RELEASE_ROT_DETECTOR,
  DUPLICATE_IMPLEMENTATION_DETECTOR,
  DEAD_CODE_CANDIDATE_DETECTOR,
  TEST_ROT_DETECTOR,
  ARCHITECTURE_DRIFT_DETECTOR,
  DEPENDENCY_ENVIRONMENT_ROT_DETECTOR,
  CROSS_PLATFORM_ROT_DETECTOR,
  SECURITY_VALIDATION_ASSUMPTION_ROT_DETECTOR,
} from "../codeRot/codeRotDetectors.js";

// ---------------------------------------------------------------------------
// v0.3.0 Batch 1/2/3 — audit detector contract and registry.
//
// Batch 3 registers the first real code-rot detectors (see
// DEFAULT_AUDIT_REGISTRY below) and extends AuditDetectorContext additively
// with the Batch 2 inventory/sourceOfTruth snapshots so detectors never
// re-scan the project themselves. The remaining code-rot detector families
// (duplicate implementations, dead code, test rot, architecture drift,
// dependency/environment rot, cross-platform rot, security-assumption rot)
// are out of scope for this batch and arrive in later v0.3.0 batches, added
// to the registry without changing this runner/registry contract.
// ---------------------------------------------------------------------------

export type AuditDetectorContext = {
  target: AuditTarget;
  config: AuditConfig;
  // v0.3.0 Batch 3 — pre-computed by the runner before any detector runs
  // (see auditRunner.ts). Detectors must read from here rather than
  // re-scanning the project or re-collecting source-of-truth themselves.
  inventory: ProjectInventorySnapshot;
  sourceOfTruth: SourceOfTruthSnapshot;
};

export type AuditDetectorSkip = { skip: true; reason: string } | { skip: false };

export type AuditDetector = {
  id: string;
  auditType: AuditType;
  title: string;
  description: string;
  supportedIncludeAreas: readonly AuditIncludeArea[];
  run: (ctx: AuditDetectorContext) => Promise<AuditIssue[]> | AuditIssue[];
  shouldSkip?: (ctx: AuditDetectorContext) => AuditDetectorSkip;
  metadata?: Record<string, unknown>;
};

// v0.3.0 Batch 3/4 — code-rot detectors. Batch 4 completes the full
// code-rot detector family planned in docs/ROADMAP.md's v0.3.0 section:
// stale command/workflow reference, docs/code mismatch, package/release
// rot (Batch 3), plus duplicate-implementation, dead-code, test-rot,
// architecture-drift, dependency/environment-rot, cross-platform-rot, and
// security/validation-assumption-rot (Batch 4).
export const DEFAULT_AUDIT_REGISTRY: readonly AuditDetector[] = createAuditRegistry([
  STALE_COMMAND_REFERENCE_DETECTOR,
  DOCS_CODE_MISMATCH_DETECTOR,
  PACKAGE_RELEASE_ROT_DETECTOR,
  DUPLICATE_IMPLEMENTATION_DETECTOR,
  DEAD_CODE_CANDIDATE_DETECTOR,
  TEST_ROT_DETECTOR,
  ARCHITECTURE_DRIFT_DETECTOR,
  DEPENDENCY_ENVIRONMENT_ROT_DETECTOR,
  CROSS_PLATFORM_ROT_DETECTOR,
  SECURITY_VALIDATION_ASSUMPTION_ROT_DETECTOR,
]);

// Validates a detector list has no duplicate ids. Later batches call this
// when assembling their own registries; Batch 1's empty default trivially
// passes.
export function createAuditRegistry(detectors: readonly AuditDetector[]): readonly AuditDetector[] {
  const seen = new Set<string>();
  for (const detector of detectors) {
    if (seen.has(detector.id)) {
      throw new Error(`Duplicate audit detector id: "${detector.id}".`);
    }
    seen.add(detector.id);
  }
  return detectors;
}

// Filters a registry down to detectors matching the selected audit types and
// at least one selected include area. Order is preserved from the input
// registry (deterministic, not re-sorted).
export function selectDetectors(
  registry: readonly AuditDetector[],
  types: readonly AuditType[],
  include: readonly AuditIncludeArea[]
): readonly AuditDetector[] {
  const typeSet = new Set(types);
  const includeSet = new Set(include);
  return registry.filter(
    (detector) => typeSet.has(detector.auditType) && detector.supportedIncludeAreas.some((area) => includeSet.has(area))
  );
}
