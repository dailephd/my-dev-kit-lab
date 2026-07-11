import type { MobileConfidence } from "../types.js";

// ---------------------------------------------------------------------------
// v0.4.0 Batch 1 — Android detection result contract.
// v0.4.0 Batch 2 — narrow inherited-contract correction: ANDROID_PROJECT_KINDS
// widened (additive) from {application, library, unknown} to also cover
// project-level outcomes ("multi-module", "mixed", "partial", "non-android")
// required by Batch 2 classification (see agents.txt Batch 2 section 7.8).
// The original three values are preserved unchanged and remain the only
// values a single AndroidModuleDetection.kind can take in practice, so no
// existing consumer or test is broken by the widening. AndroidModuleDetection
// also gained optional confidence/evidence fields so per-module
// classification results (Batch 2 section 7.7) can be evidence-backed
// without a second module-result type.
//
// This is the normalized shape a future detection batch will populate. This
// batch defines the contract only; no detection algorithm exists yet.
// "uncertain"/"unknown" outcomes must never be normalized into a positive
// detection — callers must check `detected` explicitly.
// ---------------------------------------------------------------------------

export const ANDROID_PROJECT_KINDS = [
  "application",
  "library",
  "unknown",
  "multi-module",
  "mixed",
  "partial",
  "non-android",
] as const;
export type AndroidProjectKind = (typeof ANDROID_PROJECT_KINDS)[number];

export const ANDROID_UI_TOOLKITS = ["compose", "xml-view", "mixed", "uncertain"] as const;
export type AndroidUiToolkit = (typeof ANDROID_UI_TOOLKITS)[number];

export type AndroidModuleDetection = {
  path: string;
  kind: AndroidProjectKind;
  manifestPaths: string[];
  namespaceEvidence?: string;
  applicationIdEvidence?: string;
  confidence?: MobileConfidence;
  evidence?: string[];
  uiToolkit?: AndroidUiToolkit;
};

export type AndroidDetectionResult = {
  detected: boolean;
  confidence: MobileConfidence;
  evidence: string[];
  projectKind: AndroidProjectKind;
  uiToolkit: AndroidUiToolkit;
  hasGradleWrapper: boolean;
  gradleSettingsFiles: string[];
  rootBuildFiles: string[];
  versionCatalogFiles: string[];
  modules: AndroidModuleDetection[];
  applicationModules: string[];
  libraryModules: string[];
  manifestPaths: string[];
  javaSourceRoots: string[];
  kotlinSourceRoots: string[];
  unitTestSourceRoots: string[];
  instrumentedTestSourceRoots: string[];
  androidGradlePluginEvidence?: string;
  kotlinAndroidPluginEvidence?: string;
  namespaceEvidence?: string;
  applicationIdEvidence?: string;
  partialOrUnsupportedStructure: boolean;
  warnings: string[];
  skippedReason?: string;
};
