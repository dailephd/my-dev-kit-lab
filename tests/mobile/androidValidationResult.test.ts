import { describe, expect, it } from "vitest";
import {
  ANDROID_VALIDATION_ARTIFACT_TYPE,
  ANDROID_VALIDATION_SCHEMA_VERSION,
  ANDROID_VERDICT_NOT_CALCULATED,
  type AndroidValidationResult,
} from "../../src/mobile/android/validation/result.js";
import { createAndroidProfile } from "../../src/mobile/android/profile.js";
import { createAndroidTargetMetadata } from "../../src/mobile/android/targetMetadata.js";
import { resolveLocalProjectTarget } from "../../src/core/localProjectTarget.js";
import path from "node:path";

const TOOL_ROOT = path.resolve(__dirname, "..", "..");

function buildResult(): AndroidValidationResult {
  const local = resolveLocalProjectTarget(undefined, TOOL_ROOT);
  const profile = createAndroidProfile({ detectionConfidence: "unknown" });
  const detection = {
    detected: false,
    confidence: "unknown" as const,
    evidence: [],
    projectKind: "unknown" as const,
    uiToolkit: "uncertain" as const,
    hasGradleWrapper: false,
    gradleSettingsFiles: [],
    rootBuildFiles: [],
    versionCatalogFiles: [],
    modules: [],
    applicationModules: [],
    libraryModules: [],
    manifestPaths: [],
    javaSourceRoots: [],
    kotlinSourceRoots: [],
    unitTestSourceRoots: [],
    instrumentedTestSourceRoots: [],
    partialOrUnsupportedStructure: false,
    warnings: [],
  };
  const target = createAndroidTargetMetadata({ local, androidProfile: profile, detection });

  return {
    schemaVersion: ANDROID_VALIDATION_SCHEMA_VERSION,
    artifactType: ANDROID_VALIDATION_ARTIFACT_TYPE,
    tool: { toolRoot: TOOL_ROOT, toolPackageName: "@dailephd/my-dev-kit-lab", toolPackageVersion: "0.4.0" },
    target,
    profile,
    detection,
    manifests: [],
    gradle: {
      wrapper: { present: false },
      settingsFiles: [],
      rootBuildFiles: [],
      moduleBuildFiles: [],
      pluginEvidence: {},
      modules: [],
      metadataConfidence: "unknown",
      parseWarnings: [],
      unsupportedExpressions: [],
    },
    checks: [],
    findings: [],
    skippedChecks: [],
    warnings: [],
    errors: [],
    releaseMetadataSummary: { available: false, note: "not implemented in this batch" },
    playReadinessSummary: { available: false, note: "not implemented in this batch" },
    verdict: ANDROID_VERDICT_NOT_CALCULATED,
    reportReferences: [],
    startedAt: "2026-01-01T00:00:00.000Z",
    finishedAt: "2026-01-01T00:00:01.000Z",
    durationMs: 1000,
  };
}

// ANDROID-B1-08: Android validation results serialize deterministically and
// retain schema version, artifact type, target metadata, detection, checks,
// findings, warnings, skips, and report references.
describe("android validation result contract — ANDROID-B1-08", () => {
  it("carries a stable schema version and artifact type", () => {
    const result = buildResult();
    expect(result.schemaVersion).toBe("android-validation-v1");
    expect(result.artifactType).toBe("android-validation-result");
  });

  it("never asserts a release verdict in this batch", () => {
    const result = buildResult();
    expect(result.verdict).toBe("not-calculated");
  });

  it("serializes to JSON deterministically for equivalent input", () => {
    const first = JSON.stringify(buildResult());
    const second = JSON.stringify(buildResult());
    expect(first).toBe(second);
  });

  it("retains target metadata, checks, findings, warnings, and skipped checks through serialization", () => {
    const result = buildResult();
    const roundTripped = JSON.parse(JSON.stringify(result)) as AndroidValidationResult;

    expect(roundTripped.target.local.toolRoot).toBe(result.target.local.toolRoot);
    expect(roundTripped.checks).toEqual(result.checks);
    expect(roundTripped.findings).toEqual(result.findings);
    expect(roundTripped.warnings).toEqual(result.warnings);
    expect(roundTripped.skippedChecks).toEqual(result.skippedChecks);
    expect(roundTripped.reportReferences).toEqual(result.reportReferences);
  });
});
