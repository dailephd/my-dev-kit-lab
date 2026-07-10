import type { LocalProjectTargetMetadata } from "../../core/localProjectTarget.js";
import type { MobileConfidence, MobileProfile } from "../types.js";
import type { AndroidDetectionResult, AndroidProjectKind, AndroidUiToolkit } from "./detection.js";

// ---------------------------------------------------------------------------
// v0.4.0 Batch 1 — Android target metadata contract.
//
// Composes the existing src/core/localProjectTarget.ts model (tool root,
// target root, package identity, git state) rather than re-deriving it, so
// Android validation cannot lose the tool-root/target-root separation that
// the rest of security-validation relies on.
// ---------------------------------------------------------------------------

export type AndroidGradleWrapperMetadataPlaceholder = {
  present: boolean;
  wrapperPropertiesPath?: string;
  versionEvidence?: string;
};

export type AndroidReleaseMetadataPlaceholder = {
  available: boolean;
  note: string;
};

export type AndroidEnvironmentCapabilities = {
  gradleAvailable: MobileConfidence;
  androidSdkAvailable: MobileConfidence;
  notes: string[];
};

export type AndroidTargetMetadata = {
  local: LocalProjectTargetMetadata;
  androidProfile: MobileProfile;
  classification: {
    projectKind: AndroidProjectKind;
    uiToolkit: AndroidUiToolkit;
  };
  modules: string[];
  applicationModules: string[];
  libraryModules: string[];
  manifestPaths: string[];
  gradleWrapper: AndroidGradleWrapperMetadataPlaceholder;
  releaseMetadata: AndroidReleaseMetadataPlaceholder;
  environmentCapabilities: AndroidEnvironmentCapabilities;
  detectionConfidence: MobileConfidence;
  detectionEvidence: string[];
};

export function createAndroidTargetMetadata(partial: {
  local: LocalProjectTargetMetadata;
  androidProfile: MobileProfile;
  detection: AndroidDetectionResult;
  gradleWrapper?: AndroidGradleWrapperMetadataPlaceholder;
  releaseMetadata?: AndroidReleaseMetadataPlaceholder;
  environmentCapabilities?: AndroidEnvironmentCapabilities;
}): AndroidTargetMetadata {
  const { local, androidProfile, detection } = partial;
  return {
    local,
    androidProfile,
    classification: {
      projectKind: detection.projectKind,
      uiToolkit: detection.uiToolkit,
    },
    modules: detection.modules.map((module) => module.path),
    applicationModules: detection.applicationModules,
    libraryModules: detection.libraryModules,
    manifestPaths: detection.manifestPaths,
    gradleWrapper: partial.gradleWrapper ?? { present: detection.hasGradleWrapper },
    releaseMetadata:
      partial.releaseMetadata ?? {
        available: false,
        note: "Release metadata summary is not implemented in this batch.",
      },
    environmentCapabilities:
      partial.environmentCapabilities ?? {
        gradleAvailable: "unknown",
        androidSdkAvailable: "unknown",
        notes: ["Environment capability detection is not implemented in this batch."],
      },
    detectionConfidence: detection.confidence,
    detectionEvidence: detection.evidence,
  };
}
