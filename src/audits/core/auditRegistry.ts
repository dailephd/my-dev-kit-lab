import type { AuditIssue } from "./auditIssue.js";
import type { AuditConfig } from "./auditConfig.js";
import type { AuditTarget } from "./auditTarget.js";
import type { AuditIncludeArea, AuditType } from "./auditTypes.js";
import type { ProjectInventorySnapshot } from "./projectInventory.js";
import type { SourceOfTruthSnapshot } from "./sourceOfTruth.js";
import type { SourceFactsSnapshot } from "./sourceFacts.js";
import type { KitSourceReader } from "./kitSourceProvider.js";
import { MAX_READ_BYTES as DEAD_CODE_MAX_READ_BYTES } from "../codeRot/detectors/deadCodeCandidateDetector.js";
import { MAX_READ_BYTES as TEST_ROT_MAX_READ_BYTES } from "../codeRot/detectors/testRotDetector.js";
import { KitSourceEvidenceAcquisitionError, type KitCapabilityName } from "./kitSourceEvidence.js";
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
  // v0.3.1 Batch 2 -- optional/additive: the runner always populates this
  // (see auditRunner.ts), but it stays optional here so existing detector
  // tests that build a literal AuditDetectorContext without it keep
  // type-checking unchanged. No current detector reads this field yet.
  sourceFacts?: SourceFactsSnapshot;
  kitSourceReader?: KitSourceReader;
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

// v0.10.0 Gate 3 -- frozen Gate 1 detector classification.
//
// Only these detectors consume parser-derived source evidence and therefore
// need the managed Kit provider. Every other registered detector (including
// architecture-drift and security-validation-assumption-rot, which keep
// Lab-owned inventory and live path-existence checks) runs without Kit.
// `capabilities` is the Kit capability set the detector's source-fact
// decisions need; `includeScriptsRoot` marks detectors whose evidence
// contract reaches the scripts root.
export type KitSourceEvidenceRequirement = {
  readonly capabilities: readonly KitCapabilityName[];
  readonly includeScriptsRoot: boolean;
};

export const KIT_SOURCE_EVIDENCE_REQUIREMENTS: Readonly<Record<string, KitSourceEvidenceRequirement>> = {
  "docs-code-mismatch": { capabilities: ["declarations"], includeScriptsRoot: false },
  "duplicate-implementation-candidate": { capabilities: ["declarations"], includeScriptsRoot: false },
  "dead-code-candidate": { capabilities: ["declarations", "imports"], includeScriptsRoot: true },
  "test-rot": { capabilities: ["imports"], includeScriptsRoot: false },
  "cross-platform-rot": { capabilities: [], includeScriptsRoot: false },
};

export const NON_SOURCE_DETECTOR_IDS: readonly string[] = [
  "stale-command-reference",
  "package-release-rot",
  "dependency-environment-rot",
  "security-validation-assumption-rot",
  "architecture-drift",
];

export function detectorRequiresKitSourceEvidence(detectorId: string): boolean {
  return Object.prototype.hasOwnProperty.call(KIT_SOURCE_EVIDENCE_REQUIREMENTS, detectorId);
}

export type KitSourceEvidenceSelectionRequirement = {
  required: boolean;
  detectorIds: string[];
  capabilities: KitCapabilityName[];
  includeScriptsRoot: boolean;
};

// Union of the Kit requirements of the already-selected detectors. A selection
// with no source-dependent detector requires no Kit evidence at all.
export function resolveKitSourceEvidenceRequirement(
  selected: readonly Pick<AuditDetector, "id">[]
): KitSourceEvidenceSelectionRequirement {
  const detectorIds = selected.map((detector) => detector.id).filter(detectorRequiresKitSourceEvidence);
  const capabilities = new Set<KitCapabilityName>();
  let includeScriptsRoot = false;
  for (const id of detectorIds) {
    const requirement = KIT_SOURCE_EVIDENCE_REQUIREMENTS[id]!;
    for (const capability of requirement.capabilities) capabilities.add(capability);
    includeScriptsRoot ||= requirement.includeScriptsRoot;
  }
  return { required: detectorIds.length > 0, detectorIds, capabilities: [...capabilities].sort(), includeScriptsRoot };
}

export type KitRequirementApplicability = "APPLICABLE_REQUIRED" | "APPLICABLE_OPTIONAL" | "NOT_APPLICABLE" | "UNDETERMINED";
export type ApplicableKitFileRequirement = {
  path: string;
  detectorId: string;
  capability: KitCapabilityName;
  applicability: KitRequirementApplicability;
};

// Gate 1 structured-fact scopes. Raw-reader dependencies remain Gate 4 bypasses;
// this does not certify their replacement or change any finding policy.
export function resolveApplicableKitRequirements(
  selected: readonly Pick<AuditDetector, "id">[],
  inventory: ProjectInventorySnapshot,
  include: readonly AuditIncludeArea[]
): { paths: string[]; requirements: ApplicableKitFileRequirement[] } {
  const paths = new Set<string>();
  const requirements: ApplicableKitFileRequirement[] = [];
  const languages = new Set(["typescript", "javascript", "python", "java", "kotlin", "rust"]);
  // The existing JVM docs policy also uses language counts from metadata.
  // A build/config file can activate that gate without supplying any eligible
  // source declarations. Do not certify empty source facts from that signal.
  const docsSelected = selected.some(({ id }) => id === "docs-code-mismatch") && include.includes("docs") && inventory.docsFiles.length > 0;
  const hasJvmInput = inventory.files.some((entry) => (entry.language === "java" || entry.language === "kotlin") &&
    (entry.role === "source" || entry.role === "test"));
  const hasFixtureInputs = inventory.files.some((entry) => entry.relativePath.includes("/fixtures/") || entry.relativePath.startsWith("fixtures/"));
  // Test-rot's bounded predicate loop also reads JSON test inputs. Select their
  // qualified raw content without requiring semantic imports/declarations.
  if (selected.some(({ id }) => id === "test-rot") && include.includes("tests")) {
    for (const entry of inventory.testFiles) {
      if (entry.relativePath.endsWith(".json") && entry.sizeBytes <= TEST_ROT_MAX_READ_BYTES && !entry.relativePath.startsWith("tests/audits/codeRot/")) paths.add(entry.relativePath);
    }
  }
  // Dead-code's reverse-reference and fixture-basename predicates read every
  // applicable test input, including non-semantic JSON. Paths select raw
  // evidence; they do not require declarations or imports from those inputs.
  if (selected.some(({ id }) => id === "dead-code-candidate") &&
      (include.includes("package") || include.includes("tests")) &&
      (include.includes("cli") || include.includes("architecture") ||
        (include.includes("package") && inventory.scriptFiles.length > 0) ||
        (include.includes("tests") && hasFixtureInputs))) {
    for (const entry of inventory.testFiles) {
      if (entry.relativePath.endsWith(".json") && entry.sizeBytes <= DEAD_CODE_MAX_READ_BYTES) paths.add(entry.relativePath);
    }
    // Reverse-reference predicates also read generated/vendor entries in the existing
    // source category. Request raw evidence without making semantic facts apply.
    if (include.includes("cli") || include.includes("architecture") ||
        (include.includes("package") && inventory.scriptFiles.length > 0)) {
      for (const entry of inventory.sourceFiles) {
        if ((entry.role === "generated" || entry.role === "vendor") && languages.has(entry.language) && entry.sizeBytes <= DEAD_CODE_MAX_READ_BYTES) paths.add(entry.relativePath);
      }
    }
  }
  if (docsSelected && !hasJvmInput && (inventory.filesByLanguage.java > 0 || inventory.filesByLanguage.kotlin > 0)) {
    throw new KitSourceEvidenceAcquisitionError("selection-incomplete",
      "docs-code-mismatch JVM applicability is undetermined: language metadata exists but no eligible source/test declaration paths can be established.");
  }
  for (const entry of inventory.files) {
    if (!languages.has(entry.language) || (entry.role !== "source" && entry.role !== "test")) continue;
    const jvm = entry.language === "java" || entry.language === "kotlin";
    for (const { id } of selected) {
      const capabilities: KitCapabilityName[] = [];
      let select = false;
      if (id === "docs-code-mismatch" && jvm && docsSelected) {
        select = true;
        capabilities.push("declarations");
      } else if (id === "duplicate-implementation-candidate" && include.includes("package") && entry.role === "source") {
        select = true;
        capabilities.push("declarations");
      } else if (id === "dead-code-candidate" && (include.includes("package") || include.includes("tests")) &&
        (include.includes("cli") || include.includes("architecture") || (include.includes("package") && inventory.scriptFiles.length > 0) || (include.includes("tests") && hasFixtureInputs && entry.role === "test"))) {
        select = true;
        if (include.includes("cli") || include.includes("architecture") || (include.includes("package") && inventory.scriptFiles.length > 0)) {
          capabilities.push("imports");
          if ((include.includes("cli") || include.includes("architecture")) && entry.role === "source" && (jvm || entry.language === "python")) capabilities.push("declarations");
        }
      } else if (id === "test-rot" && include.includes("tests") && inventory.testFiles.length > 0) {
        // Source files are selected as import-target inventory, not required
        // import observations. Test-rot reads imports only from test files.
        select = true;
        if (entry.role === "test" && entry.sizeBytes <= TEST_ROT_MAX_READ_BYTES && !entry.relativePath.startsWith("tests/audits/codeRot/")) capabilities.push("imports");
      } else if (id === "cross-platform-rot" && include.includes("cli") && entry.role === "source" &&
        entry.relativePath.startsWith("src/audits/") && !entry.relativePath.endsWith("/textLines.ts")) {
        select = true;
      }
      if (select) {
        paths.add(entry.relativePath);
        // Full range coverage enriches provenance; Gate 1 requires only
        // start-line locations for the current structural consumers.
        requirements.push({ path: entry.relativePath, detectorId: id, capability: "source-ranges", applicability: "APPLICABLE_OPTIONAL" });
      }
      for (const capability of KIT_SOURCE_EVIDENCE_REQUIREMENTS[id]?.capabilities ?? []) {
        requirements.push({ path: entry.relativePath, detectorId: id, capability,
          applicability: capabilities.includes(capability) ? "APPLICABLE_REQUIRED" : "NOT_APPLICABLE" });
      }
    }
  }
  return { paths: [...paths].sort(), requirements };
}

export function requiredKitCapabilitiesForPath(requirements: readonly ApplicableKitFileRequirement[], filePath: string): KitCapabilityName[] {
  const relevant = requirements.filter((requirement) => requirement.path === filePath);
  const uncertain = relevant.find((requirement) => requirement.applicability === "UNDETERMINED");
  if (uncertain) throw new KitSourceEvidenceAcquisitionError("capability-insufficient",
    `${uncertain.detectorId} applicability for ${filePath} capability ${uncertain.capability} is undetermined.`);
  return [...new Set(relevant.filter((requirement) => requirement.applicability === "APPLICABLE_REQUIRED")
    .map((requirement) => requirement.capability))].sort();
}

// Only docs declaration matching has an authorized partial-positive route.
// Any other applicable required consumer keeps acquisition strict.
export function allowsKitPartialPositiveDeclarations(requirements: readonly ApplicableKitFileRequirement[], filePath: string): boolean {
  const required = requirements.filter(r => r.path === filePath && r.applicability === "APPLICABLE_REQUIRED");
  return required.length > 0 && required.every(r => r.detectorId === "docs-code-mismatch" && r.capability === "declarations");
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
