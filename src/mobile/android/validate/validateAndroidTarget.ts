import fs from "node:fs";
import path from "node:path";
import { resolveLocalProjectTarget } from "../../../core/localProjectTarget.js";
import { detectAndroidProject } from "../detect/detectAndroidProject.js";
import { createAndroidProfile } from "../profile.js";
import { createAndroidTargetMetadata } from "../targetMetadata.js";
import { parseAllAndroidManifests } from "../manifest/parseAndroidManifest.js";
import { auditAndroidPermissions } from "../audit/permissionAudit.js";
import { auditAndroidExportedComponents } from "../audit/exportedComponentAudit.js";
import { auditAndroidIntentFilters } from "../audit/intentFilterAudit.js";
import { auditAndroidDeepLinks } from "../audit/deepLinkAudit.js";
import { readAndroidGradleMetadata } from "../gradle/readAndroidGradleMetadata.js";
import { buildAndroidGradleMetadataCheckResult } from "../gradle/gradleMetadataCheckResult.js";
import { buildAndroidReleaseMetadataSummary } from "../gradle/releaseMetadataSummary.js";
import { runOptionalGradleValidation } from "../gradle/validate/runOptionalGradleValidation.js";
import type { GradleOperationId } from "../gradle/validate/operations.js";
import type { GradleCommandExecutor } from "../gradle/validate/executor.js";
import { captureTargetSnapshot, buildTargetMutationReport } from "../gradle/validate/targetMutation.js";
import { buildAndroidPlayReadinessChecklist } from "./playReadinessChecklist.js";
import { calculateAndroidVerdict } from "./androidVerdict.js";
import {
  buildAndroidDetectionCheckResult,
  buildAndroidManifestParsingCheckResult,
  buildAndroidTargetImmutabilityCheckResult,
} from "./detectionAndImmutabilityCheckResults.js";
import {
  ANDROID_VALIDATION_ARTIFACT_TYPE,
  ANDROID_VALIDATION_SCHEMA_VERSION,
  type AndroidValidationResult,
} from "../validation/result.js";
import type { AndroidCheckResult } from "../validation/checkResult.js";
import type { SecurityFinding } from "../../../securityValidation/types.js";

// ---------------------------------------------------------------------------
// v0.4.0 Batch 5 — Android validation orchestrator (agents.txt Batch 5
// section 8).
//
// Composes Batches 1-4 in the required sequence. Failure isolation: each
// sub-step's evidence is collected independently — a malformed manifest or a
// failed optional Gradle operation never discards evidence already gathered
// from earlier steps (section 8.3). Never writes to the target; the only
// filesystem writes anywhere in this call graph are the read-only git-status
// snapshot (via `git status`, no mutation) and, only when Gradle operations
// are explicitly requested, the operations' own effects (which are the
// caller's explicit request, not something this orchestrator initiates
// unprompted).
// ---------------------------------------------------------------------------

export type ValidateAndroidTargetOptions = {
  toolRoot: string;
  targetPath?: string;
  requestedGradleOperationIds?: GradleOperationId[];
  gradleExecutor?: GradleCommandExecutor;
  allowGradleWithoutTaskDiscovery?: boolean;
  platform?: NodeJS.Platform;
};

function readToolPackageMetadata(toolRoot: string): { toolPackageName: string; toolPackageVersion: string } {
  try {
    const pkgRaw = fs.readFileSync(path.join(toolRoot, "package.json"), "utf8");
    const pkg = JSON.parse(pkgRaw) as { name?: string; version?: string };
    return { toolPackageName: pkg.name ?? "my-dev-kit-lab", toolPackageVersion: pkg.version ?? "unknown" };
  } catch {
    return { toolPackageName: "my-dev-kit-lab", toolPackageVersion: "unknown" };
  }
}

function hasGitDirectory(targetRoot: string): boolean {
  try {
    return fs.existsSync(path.join(targetRoot, ".git"));
  } catch {
    return false;
  }
}

export async function validateAndroidTarget(options: ValidateAndroidTargetOptions): Promise<AndroidValidationResult> {
  const startedAt = new Date().toISOString();
  const startedMs = Date.now();

  // 1. Resolve the local target.
  const local = resolveLocalProjectTarget(options.targetPath, options.toolRoot);
  const resolvedTargetRoot = path.resolve(local.targetRoot);
  const hasGit = local.hasGit || hasGitDirectory(resolvedTargetRoot);

  // 2. Capture initial target snapshot (read-only).
  const snapshotBefore = captureTargetSnapshot(resolvedTargetRoot, hasGit);

  // 3. Detect and classify the Android project.
  const detection = detectAndroidProject(resolvedTargetRoot);

  // 5. Build Android target metadata / profile.
  const androidProfile = createAndroidProfile({
    detectionConfidence: detection.confidence,
    evidence: detection.evidence,
    unsupportedNotes: detection.warnings,
    projectType: detection.projectKind,
    projectSubtype: detection.uiToolkit,
    supportedCapabilities: ["static-detection", "manifest-analysis", "gradle-metadata"],
  });
  const targetMetadata = createAndroidTargetMetadata({ local, androidProfile, detection });

  // 6-7. Parse every discovered manifest independently (module/source-set
  // association preserved by parseAllAndroidManifests itself).
  const manifestEntries = parseAllAndroidManifests(resolvedTargetRoot, detection);
  const manifests = manifestEntries.map((e) => e.manifest);

  // 8-11. Four static audits — failure isolation: each returns its own
  // AndroidCheckResult/findings independently of the others.
  const permissionsCheck = auditAndroidPermissions(detection, manifestEntries);
  const componentsCheck = auditAndroidExportedComponents(detection, manifestEntries);
  const intentFiltersCheck = auditAndroidIntentFilters(detection, manifestEntries);
  const deepLinksCheck = auditAndroidDeepLinks(detection, manifestEntries);

  // 12-14. Static Gradle metadata + release metadata summary.
  const gradle = readAndroidGradleMetadata(resolvedTargetRoot, detection);
  const gradleMetadataCheck = buildAndroidGradleMetadataCheckResult(detection, gradle);
  const releaseMetadata = buildAndroidReleaseMetadataSummary(detection, gradle);

  // Detection + manifest-parsing checks (required families with no prior
  // batch owner).
  const detectionCheck = buildAndroidDetectionCheckResult(detection);
  const manifestParsingCheck = buildAndroidManifestParsingCheckResult(detection, manifestEntries);

  // 15-16. Optional Gradle operations — never run unless explicitly requested.
  const requestedOperationIds = options.requestedGradleOperationIds ?? [];
  const gradleOperationResults: AndroidCheckResult[] =
    requestedOperationIds.length > 0
      ? await runOptionalGradleValidation({
          enabled: true,
          targetRoot: resolvedTargetRoot,
          detection,
          operationIds: requestedOperationIds,
          executor: options.gradleExecutor,
          allowWithoutTaskDiscovery: options.allowGradleWithoutTaskDiscovery,
          platform: options.platform,
        })
      : [];

  // 17. Target mutation evidence — captured regardless of whether Gradle ran,
  // so the static-only path also proves it made no changes.
  const snapshotAfter = captureTargetSnapshot(resolvedTargetRoot, hasGit);
  const targetMutation = buildTargetMutationReport(snapshotBefore, snapshotAfter);
  const immutabilityCheck = buildAndroidTargetImmutabilityCheckResult(targetMutation);

  // 18. Assemble checks/findings in deterministic order (agents.txt section 10.3).
  const checks: AndroidCheckResult[] = [
    detectionCheck,
    manifestParsingCheck,
    permissionsCheck,
    componentsCheck,
    intentFiltersCheck,
    deepLinksCheck,
    gradleMetadataCheck,
    ...gradleOperationResults,
    immutabilityCheck,
  ];

  const findingsById = new Map<string, SecurityFinding>();
  for (const check of checks) {
    for (const finding of check.findings) {
      // Exact-duplicate dedupe by id only (agents.txt section 10.4) —
      // distinct manifests/components/permissions/deep-links always produce
      // distinct ids (see androidFinding.ts's content-derived id builder),
      // so this never collapses genuinely different evidence.
      if (!findingsById.has(finding.id)) {
        findingsById.set(finding.id, finding);
      }
    }
  }
  const findings = [...findingsById.values()].sort((a, b) => a.id.localeCompare(b.id));

  const skippedChecks = checks.flatMap((c) => (c.skipInfo ? [c.skipInfo] : []));
  const warnings = checks.flatMap((c) => c.warnings);
  const errors = checks.flatMap((c) => c.errors);
  const environmentLimitations = [...new Set(checks.flatMap((c) => c.environmentRequirements))];

  // 19. Play-readiness checklist placeholders.
  const isLibraryOnly = detection.projectKind === "library";
  const isNonAndroid = detection.projectKind === "non-android";
  const playReadiness = buildAndroidPlayReadinessChecklist({ isLibraryOnly, isNonAndroid, releaseMetadata, manifests });

  // 20. Verdict.
  const multipleApplicationModules = detection.applicationModules.length > 1;
  const { verdict, recommendedNextStep, reasons } = calculateAndroidVerdict({
    checks,
    findings,
    detection,
    playReadiness,
    targetMutation,
    multipleApplicationModules,
  });

  const finishedAt = new Date().toISOString();
  const durationMs = Date.now() - startedMs;
  const { toolPackageName, toolPackageVersion } = readToolPackageMetadata(options.toolRoot);

  return {
    schemaVersion: ANDROID_VALIDATION_SCHEMA_VERSION,
    artifactType: ANDROID_VALIDATION_ARTIFACT_TYPE,
    tool: { toolRoot: path.resolve(options.toolRoot), toolPackageName, toolPackageVersion },
    target: targetMetadata,
    profile: androidProfile,
    detection,
    manifests,
    gradle,
    checks,
    findings,
    skippedChecks,
    warnings,
    errors,
    releaseMetadataSummary: {
      available: Boolean(releaseMetadata.applicationModulePath),
      note: releaseMetadata.applicationModuleSelectionNote,
    },
    releaseMetadata,
    playReadinessSummary: { available: playReadiness.applicable, note: playReadiness.note },
    playReadiness,
    verdict,
    verdictReasons: reasons,
    recommendedNextStep,
    targetMutationEvidence: targetMutation,
    reportReferences: [],
    startedAt,
    finishedAt,
    durationMs,
  };
}
