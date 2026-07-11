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
import { auditAndroidNetworkSecurity } from "../advancedSecurity/networkSecurity/checkResult.js";
import { auditAndroidBackupConfiguration } from "../advancedSecurity/backupConfiguration/checkResult.js";
import { auditAndroidReleaseConfiguration } from "../advancedSecurity/releaseConfiguration/checkResult.js";
import { auditAndroidSecretCandidates } from "../advancedSecurity/secretCandidates/checkResult.js";
import { auditAndroidSigningConfiguration } from "../advancedSecurity/signingConfiguration/checkResult.js";
import { auditAndroidWebViewSecurity } from "../advancedSecurity/webview/checkResult.js";
import { auditAndroidFileProviders } from "../advancedSecurity/fileProvider/checkResult.js";
import { auditAndroidSensitiveStorage } from "../advancedSecurity/sensitiveStorage/checkResult.js";
import { auditAndroidSensitiveLogging } from "../advancedSecurity/sensitiveLogging/checkResult.js";
import { auditAndroidClipboardSecurity } from "../advancedSecurity/clipboard/checkResult.js";
import { auditAndroidFirebaseGoogleServices } from "../advancedSecurity/firebaseGoogle/checkResult.js";
import { runRequestedAndroidExternalTools } from "../advancedSecurity/externalTools/runRequestedAndroidExternalTools.js";
import { createRealExternalToolExecutor } from "../advancedSecurity/externalTools/runBoundedExternalTool.js";
import { createRealGradleCommandExecutor } from "../gradle/validate/executor.js";
import type { AndroidExternalToolNetworkPolicy, ExternalToolExecutor } from "../advancedSecurity/externalTools/types.js";
import type { AndroidManifestParseEntry } from "../manifest/parseAndroidManifest.js";
import type { AndroidDetectionResult } from "../detection.js";

// ---------------------------------------------------------------------------
// v0.4.1 Batch 8 — active integration of the eleven Batch 2-6 standalone
// advanced Android checks and the Batch 7 optional external-tool dispatcher.
//
// Each advanced-check invocation is wrapped in `runIsolatedCheck` so that an
// unexpected exception from any single analyzer never discards results
// already gathered from earlier checks (agents.txt Batch 8 section 9.3) —
// this mirrors the existing convention that every analyzer already returns a
// well-formed AndroidCheckResult rather than throwing, but adds a defensive
// boundary here in case that invariant is ever violated by a future change.
// ---------------------------------------------------------------------------

type AdvancedCheckDescriptor = { id: string; category: AndroidCheckResult["category"]; title: string; run: () => AndroidCheckResult };

function runIsolatedCheck(descriptor: AdvancedCheckDescriptor): AndroidCheckResult {
  try {
    return descriptor.run();
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return {
      id: descriptor.id,
      category: descriptor.category,
      title: descriptor.title,
      status: "error",
      requirementLevel: "optional",
      ran: false,
      skipped: false,
      evidence: [],
      findings: [],
      warnings: [],
      errors: [`Advanced check raised an unexpected error: ${message}`],
      sourcePaths: [],
      confidence: "unknown",
      environmentRequirements: [],
      candidateEvidence: [],
    };
  }
}

function buildAdvancedSecurityChecks(
  targetRoot: string,
  detection: AndroidDetectionResult,
  manifestEntries: AndroidManifestParseEntry[],
  gradleModules: ReturnType<typeof readAndroidGradleMetadata>["modules"]
): AndroidCheckResult[] {
  // Fixed order (agents.txt Batch 8 section 9.1) — never alphabetical, never
  // derived from filesystem/object iteration.
  const descriptors: AdvancedCheckDescriptor[] = [
    { id: "android-network-security-audit", category: "android-network-security", title: "Android Network Security Config audit", run: () => auditAndroidNetworkSecurity(targetRoot, detection, manifestEntries) },
    { id: "android-backup-configuration-audit", category: "android-backup-configuration", title: "Android backup configuration audit", run: () => auditAndroidBackupConfiguration(targetRoot, detection, manifestEntries) },
    { id: "android-release-configuration-audit", category: "android-release-configuration", title: "Android release configuration audit", run: () => auditAndroidReleaseConfiguration(targetRoot, detection, manifestEntries, gradleModules) },
    { id: "android-secret-candidates-audit", category: "android-secret-candidates", title: "Android hardcoded secret-candidate audit", run: () => auditAndroidSecretCandidates(targetRoot, detection) },
    { id: "android-signing-configuration-audit", category: "android-signing-configuration", title: "Android signing configuration audit", run: () => auditAndroidSigningConfiguration(targetRoot, detection, gradleModules) },
    { id: "android-webview-security-audit", category: "android-webview", title: "Android WebView security audit", run: () => auditAndroidWebViewSecurity(targetRoot, detection) },
    { id: "android-file-provider-audit", category: "android-file-provider", title: "Android FileProvider security audit", run: () => auditAndroidFileProviders(targetRoot, detection, manifestEntries) },
    { id: "android-sensitive-storage-audit", category: "android-sensitive-storage", title: "Android sensitive-storage audit", run: () => auditAndroidSensitiveStorage(targetRoot, detection) },
    { id: "android-sensitive-logging-audit", category: "android-sensitive-logging", title: "Android sensitive-logging audit", run: () => auditAndroidSensitiveLogging(targetRoot, detection) },
    { id: "android-clipboard-security-audit", category: "android-clipboard", title: "Android clipboard security audit", run: () => auditAndroidClipboardSecurity(targetRoot, detection) },
    { id: "android-firebase-google-services-audit", category: "android-firebase-google-services", title: "Android Firebase/Google services audit", run: () => auditAndroidFirebaseGoogleServices(targetRoot, detection) },
  ];
  return descriptors.map(runIsolatedCheck);
}

// Memoizes by Gradle operation id: the fixed allowlist (operations.ts) maps
// each operation id to fixed args, so within one validation run the same
// operation id always means the same command — caching by id is safe and
// prevents running `lintDebug` twice when both --android-gradle-operations
// lint-debug and --android-external-tools android-lint are requested
// together (agents.txt Batch 8 section 10.6).
function createDedupingGradleExecutor(base: GradleCommandExecutor): GradleCommandExecutor {
  const cache = new Map<string, ReturnType<GradleCommandExecutor>>();
  return (plan) => {
    const cached = cache.get(plan.operationId);
    if (cached) return cached;
    const promise = base(plan);
    cache.set(plan.operationId, promise);
    return promise;
  };
}

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
  // v0.4.1 Batch 8 — additive external-tool integration. Omitted/empty
  // requestedExternalToolIds executes zero external tools (same "no request,
  // no execution" convention as requestedGradleOperationIds).
  requestedExternalToolIds?: string[];
  externalNetworkPolicy?: AndroidExternalToolNetworkPolicy;
  externalToolArtifactRoot?: string;
  externalToolExecutors?: {
    semgrep?: ExternalToolExecutor;
    osv?: ExternalToolExecutor;
    androidLint?: GradleCommandExecutor;
    dependencyCheck?: ExternalToolExecutor;
  };
  javaAvailable?: boolean;
  lintTaskAvailable?: boolean;
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

  // Shared, deduping Gradle executor: reused for both --android-gradle-
  // operations and (if android-lint is also externally requested) the
  // Batch 7 Android Lint adapter, so `lintDebug` never runs twice for one
  // validation run (agents.txt Batch 8 section 10.6).
  const sharedGradleExecutor = createDedupingGradleExecutor(options.gradleExecutor ?? createRealGradleCommandExecutor());

  // 15-16. Optional Gradle operations — never run unless explicitly requested.
  const requestedOperationIds = options.requestedGradleOperationIds ?? [];
  const gradleOperationResults: AndroidCheckResult[] =
    requestedOperationIds.length > 0
      ? await runOptionalGradleValidation({
          enabled: true,
          targetRoot: resolvedTargetRoot,
          detection,
          operationIds: requestedOperationIds,
          executor: sharedGradleExecutor,
          allowWithoutTaskDiscovery: options.allowGradleWithoutTaskDiscovery,
          platform: options.platform,
        })
      : [];

  // v0.4.1 Batch 8 — eleven internal advanced Android checks, active by
  // default (agents.txt Batch 8 section 9.1). Sequential, fixed order,
  // isolated per-check via runIsolatedCheck. Never executes a process or
  // touches the network.
  const advancedSecurityChecks = buildAdvancedSecurityChecks(resolvedTargetRoot, detection, manifestEntries, gradle.modules);

  // v0.4.1 Batch 8 — optional external-tool integration. Never executes
  // unless requestedExternalToolIds is non-empty (same "no request, no
  // execution" convention as Gradle operations). Wrapped in try/catch so a
  // dispatcher-level failure (e.g. an unknown tool id slipping past CLI
  // validation in a programmatic caller) cannot discard the checks already
  // gathered above.
  const requestedExternalToolIds = options.requestedExternalToolIds ?? [];
  let externalToolChecks: AndroidCheckResult[] = [];
  if (requestedExternalToolIds.length > 0) {
    try {
      externalToolChecks = await runRequestedAndroidExternalTools({
        request: {
          requestedTools: requestedExternalToolIds,
          targetRoot: resolvedTargetRoot,
          artifactRoot: options.externalToolArtifactRoot ?? path.join(options.toolRoot, "reports", "security", "external-tools"),
          networkPolicy: options.externalNetworkPolicy ?? "deny",
        },
        detection,
        executors: {
          semgrep: options.externalToolExecutors?.semgrep ?? createRealExternalToolExecutor(),
          osv: options.externalToolExecutors?.osv ?? createRealExternalToolExecutor(),
          androidLint: options.externalToolExecutors?.androidLint ?? sharedGradleExecutor,
          dependencyCheck: options.externalToolExecutors?.dependencyCheck ?? createRealExternalToolExecutor(),
        },
        javaAvailable: options.javaAvailable,
        lintTaskAvailable: options.lintTaskAvailable,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      externalToolChecks = [
        {
          id: "android-external-tools-dispatch",
          category: "android-semgrep",
          title: "External security-tool dispatch",
          status: "error",
          requirementLevel: "optional",
          ran: false,
          skipped: false,
          evidence: [],
          findings: [],
          warnings: [],
          errors: [`External-tool dispatch raised an unexpected error: ${message}`],
          sourcePaths: [],
          confidence: "unknown",
          environmentRequirements: [],
          candidateEvidence: [],
        },
      ];
    }
  }

  // 17. Target mutation evidence — captured after every process this run may
  // have executed (Gradle operations, advanced checks, and external tools),
  // so the static-only path also proves it made no changes.
  const snapshotAfter = captureTargetSnapshot(resolvedTargetRoot, hasGit);
  const targetMutation = buildTargetMutationReport(snapshotBefore, snapshotAfter);
  const immutabilityCheck = buildAndroidTargetImmutabilityCheckResult(targetMutation);

  // 18. Assemble checks/findings in deterministic order (agents.txt Batch 8
  // section 11.1): the existing v0.4.0 check order is preserved exactly
  // (ending with immutabilityCheck, as before), and the eleven advanced
  // checks and any requested external tools are APPENDED after it — never
  // interleaved into the existing order.
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
    ...advancedSecurityChecks,
    ...externalToolChecks,
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
