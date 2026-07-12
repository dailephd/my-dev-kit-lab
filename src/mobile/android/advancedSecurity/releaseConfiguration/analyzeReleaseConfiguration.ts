import path from "node:path";
import type { SecurityFinding } from "../../../../securityValidation/types.js";
import type { AndroidManifestParseEntry } from "../../manifest/parseAndroidManifest.js";
import type { AndroidGradleBuildTypeInfo, AndroidGradleModuleInfo } from "../../gradle/types.js";
import { makeAndroidFinding } from "../../audit/androidFinding.js";
import { buildAndroidSourceLocation, type AndroidSourceLocation } from "../sourceLocation.js";
import { makeCandidateEvidence, type CandidateEvidence } from "../candidateEvidence.js";
import { extractManifestReleaseEvidence, type ManifestReleaseEvidence } from "./manifestEvidence.js";

// ---------------------------------------------------------------------------
// v0.4.1 Batch 3 — conservative debuggable/testOnly analysis and manifest<->
// Gradle release build-type correlation.
//
// Only explicit manifest debuggable/testOnly=true and a literal Gradle
// release debuggable=true ever become a "major" SecurityFinding — and only
// for application (non-library) modules. Everything else (missing release
// build type, dynamic expressions, conflicts between sources, minification/
// shrink-resources metadata) is CandidateEvidence, plain evidence text, or
// omitted entirely — never a finding (agents.txt Batch 3 sections 9.8/9.9/
// 9.12-9.14/9.17).
// ---------------------------------------------------------------------------

export type AnalyzeReleaseConfigurationResult = {
  manifestEvidence: ManifestReleaseEvidence;
  candidates: CandidateEvidence[];
  findings: SecurityFinding[];
  evidenceText: string[];
};

const RELEASE_BUILD_TYPE_NAME = "release";

function loc(targetRoot: string, absolutePath: string, position?: { line?: number; column?: number }): AndroidSourceLocation {
  return buildAndroidSourceLocation(targetRoot, absolutePath, position);
}

// Exact-name match only (agents.txt Batch 3 section 9.11) — no guessing by
// substring, no flavor/variant evaluation. All matches are preserved (a
// module could in principle declare more than one via extraction quirks);
// ambiguity is never resolved arbitrarily.
function findReleaseLikeBuildTypes(gradleModule: AndroidGradleModuleInfo | undefined): AndroidGradleBuildTypeInfo[] {
  return (gradleModule?.buildTypeDetails ?? []).filter((buildType) => buildType.name === RELEASE_BUILD_TYPE_NAME);
}

export function analyzeApplicationReleaseConfiguration(
  targetRoot: string,
  entry: AndroidManifestParseEntry,
  gradleModules: AndroidGradleModuleInfo[]
): AnalyzeReleaseConfigurationResult {
  const manifestEvidence = extractManifestReleaseEvidence(entry);
  const candidates: CandidateEvidence[] = [];
  const findings: SecurityFinding[] = [];
  const evidenceText: string[] = [];
  const modulePath = entry.modulePath;
  const manifestAbsolutePath = path.join(targetRoot, entry.manifestPath);
  const gradleModule = gradleModules.find((m) => m.path === modulePath);
  // Only suppressed (downgraded to candidate) when a module is confidently
  // library-only — an ambiguous/unknown module type is still treated as an
  // application for conservative reporting purposes.
  const isLibraryOnlyModule = gradleModule?.isLibrary === true && gradleModule?.isApplication !== true;

  // --- manifest debuggable ---
  if (manifestEvidence.debuggable.state === "explicit-true") {
    if (isLibraryOnlyModule) {
      candidates.push(
        makeCandidateEvidence({
          ruleId: "android-release-debuggable",
          category: "android-release-configuration",
          confidence: "low",
          modulePath,
          location: loc(targetRoot, manifestAbsolutePath, manifestEvidence.applicationLocation),
          summary: 'android:debuggable="true" declared in a library module manifest (not an installable application)',
          rawValue: manifestEvidence.debuggable.raw,
          resolutionState: "not-applicable",
        })
      );
    } else {
      findings.push(
        makeAndroidFinding({
          ruleId: "android-release-debuggable",
          title: 'Manifest explicitly enables debuggable (android:debuggable="true")',
          severity: "major",
          confidence: "high",
          description:
            'The manifest\'s <application> element sets android:debuggable="true". This is high-confidence static evidence of a risky configuration if shipped in a release build; it does not prove the published/installed APK is actually debuggable — Gradle build-type configuration and manifest merging are not evaluated here.',
          manifestPath: entry.manifestPath,
          location: manifestEvidence.applicationLocation,
          evidenceDetails: ["source=manifest-attribute"],
          recommendation: 'Set android:debuggable="false" (or omit it) for release builds; confirm no debug manifest overlay reaches production.',
        })
      );
    }
  } else if (manifestEvidence.debuggable.state === "malformed") {
    candidates.push(
      makeCandidateEvidence({
        ruleId: "android-release-debuggable",
        category: "android-release-configuration",
        confidence: "low",
        modulePath,
        location: loc(targetRoot, manifestAbsolutePath, manifestEvidence.applicationLocation),
        summary: "android:debuggable has an unresolved or malformed value",
        rawValue: manifestEvidence.debuggable.raw,
        resolutionState: "malformed",
      })
    );
  } else if (manifestEvidence.debuggable.state === "explicit-false") {
    evidenceText.push(`${entry.manifestPath}: manifest debuggable is explicitly false (safe)`);
  }

  // --- manifest testOnly ---
  if (manifestEvidence.testOnly.state === "explicit-true") {
    if (isLibraryOnlyModule) {
      candidates.push(
        makeCandidateEvidence({
          ruleId: "android-release-test-only",
          category: "android-release-configuration",
          confidence: "low",
          modulePath,
          location: loc(targetRoot, manifestAbsolutePath, manifestEvidence.applicationLocation),
          summary: 'android:testOnly="true" declared in a library module manifest',
          rawValue: manifestEvidence.testOnly.raw,
          resolutionState: "not-applicable",
        })
      );
    } else {
      findings.push(
        makeAndroidFinding({
          ruleId: "android-release-test-only",
          title: 'Manifest explicitly marks the application test-only (android:testOnly="true")',
          severity: "major",
          confidence: "high",
          description:
            'The manifest\'s <application> element sets android:testOnly="true", which the platform install mechanism (and Play Store) treats as release-blocking. This does not prove the package was ever installed or published.',
          manifestPath: entry.manifestPath,
          location: manifestEvidence.applicationLocation,
          evidenceDetails: ["source=manifest-attribute"],
          recommendation: 'Remove android:testOnly="true" before release; confirm no test/debug manifest overlay reaches production.',
        })
      );
    }
  } else if (manifestEvidence.testOnly.state === "malformed") {
    candidates.push(
      makeCandidateEvidence({
        ruleId: "android-release-test-only",
        category: "android-release-configuration",
        confidence: "low",
        modulePath,
        location: loc(targetRoot, manifestAbsolutePath, manifestEvidence.applicationLocation),
        summary: "android:testOnly has an unresolved or malformed value",
        rawValue: manifestEvidence.testOnly.raw,
        resolutionState: "malformed",
      })
    );
  }

  // --- Gradle release build-type ---
  const releaseBuildTypes = findReleaseLikeBuildTypes(gradleModule);
  const buildFileRelativePath = gradleModule?.buildFilePath;
  const buildFileAbsolutePath = buildFileRelativePath !== undefined ? path.join(targetRoot, buildFileRelativePath) : undefined;
  const fallbackLocation = buildFileAbsolutePath !== undefined ? loc(targetRoot, buildFileAbsolutePath) : loc(targetRoot, manifestAbsolutePath);

  if (releaseBuildTypes.length === 0) {
    candidates.push(
      makeCandidateEvidence({
        ruleId: "android-release-build-type-configuration",
        category: "android-release-configuration",
        confidence: "low",
        modulePath,
        location: fallbackLocation,
        summary: `No "release" build type was statically found for module ${modulePath ?? "(unknown)"}`,
        rawValue: undefined,
        resolutionState: "missing",
        staticAnalysisLimitations: [
          "A missing release build type is not automatically a vulnerability; Gradle default build types, convention plugins, and variant configuration are not evaluated.",
        ],
      })
    );
  }

  let gradleReleaseDebuggableTrue = false;
  let gradleReleaseDebuggableFalse = false;

  for (const buildType of releaseBuildTypes) {
    if (buildType.debuggableState === "literal-true") {
      gradleReleaseDebuggableTrue = true;
      if (!isLibraryOnlyModule) {
        findings.push(
          makeAndroidFinding({
            ruleId: "android-release-debuggable",
            title: `Release build type "${buildType.name}" sets debuggable=true`,
            severity: "major",
            confidence: "high",
            description: `The Gradle release build type "${buildType.name}" sets a literal debuggable=true. This is high-confidence static evidence; it does not prove a built APK is actually debuggable — build-type/flavor/variant selection and Gradle conventions are not evaluated.`,
            manifestPath: buildFileRelativePath ?? entry.manifestPath,
            identity: buildType.name,
            evidenceDetails: [`buildType=${buildType.name}`, "source=gradle-literal"],
            recommendation: "Set debuggable=false (or remove the override) for the release build type.",
          })
        );
      } else {
        candidates.push(
          makeCandidateEvidence({
            ruleId: "android-release-debuggable",
            category: "android-release-configuration",
            confidence: "low",
            modulePath,
            location: fallbackLocation,
            summary: `Library module's "${buildType.name}" build type sets debuggable=true (not an installable application)`,
            rawValue: buildType.debuggableRaw,
            resolutionState: "not-applicable",
          })
        );
      }
    } else if (buildType.debuggableState === "literal-false") {
      gradleReleaseDebuggableFalse = true;
      evidenceText.push(`${modulePath ?? "(unknown module)"}: release build type "${buildType.name}" debuggable is explicitly false (safe)`);
    } else if (buildType.debuggableState === "dynamic") {
      candidates.push(
        makeCandidateEvidence({
          ruleId: "android-release-debuggable",
          category: "android-release-configuration",
          confidence: "medium",
          modulePath,
          location: fallbackLocation,
          summary: `Release build type "${buildType.name}" debuggable value is a dynamic/unresolved expression`,
          rawValue: buildType.debuggableRaw,
          resolutionState: "unresolved",
        })
      );
    }

    // Minification/resource-shrinking/signingConfig — release-hardening
    // metadata only, never a finding (agents.txt Batch 3 sections 9.13/9.16).
    evidenceText.push(
      `${modulePath ?? "(unknown module)"}: release build type "${buildType.name}" minifyEnabled=${buildType.minifyEnabledState}, shrinkResources=${buildType.shrinkResourcesState}`
    );
    if (buildType.signingConfigRef !== undefined) {
      evidenceText.push(`${modulePath ?? "(unknown module)"}: release build type "${buildType.name}" signingConfig=${buildType.signingConfigRef}`);
    }
  }

  // --- manifest/Gradle correlation (never invents a build-time winner) ---
  if (manifestEvidence.debuggable.state === "explicit-true" && gradleReleaseDebuggableTrue) {
    evidenceText.push(`${entry.manifestPath}: manifest debuggable=true aligns with release build type debuggable=true (aligned risky evidence)`);
  } else if (manifestEvidence.debuggable.state === "explicit-true" && gradleReleaseDebuggableFalse) {
    candidates.push(
      makeCandidateEvidence({
        ruleId: "android-release-debuggable",
        category: "android-release-configuration",
        confidence: "medium",
        modulePath,
        location: loc(targetRoot, manifestAbsolutePath, manifestEvidence.applicationLocation),
        summary: "Manifest debuggable=true conflicts with the release build type's literal debuggable=false",
        rawValue: manifestEvidence.debuggable.raw,
        resolutionState: "resolved",
        staticAnalysisLimitations: [
          "Precedence between the manifest attribute and Gradle build-type configuration was not evaluated; this is conflicting static evidence, not a confirmed build-time value.",
        ],
      })
    );
  } else if (manifestEvidence.debuggable.state === "explicit-false" && gradleReleaseDebuggableTrue) {
    candidates.push(
      makeCandidateEvidence({
        ruleId: "android-release-debuggable",
        category: "android-release-configuration",
        confidence: "medium",
        modulePath,
        location: loc(targetRoot, manifestAbsolutePath, manifestEvidence.applicationLocation),
        summary: "Manifest debuggable=false conflicts with the release build type's literal debuggable=true",
        rawValue: manifestEvidence.debuggable.raw,
        resolutionState: "resolved",
        staticAnalysisLimitations: [
          "Precedence between the manifest attribute and Gradle build-type configuration was not evaluated; this is conflicting static evidence, not a confirmed build-time value.",
        ],
      })
    );
  }

  return { manifestEvidence, candidates, findings, evidenceText };
}
