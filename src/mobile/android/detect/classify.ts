import type { MobileConfidence } from "../../types.js";
import type { AndroidProjectKind, AndroidUiToolkit } from "../detection.js";

// ---------------------------------------------------------------------------
// v0.4.0 Batch 2 — deterministic, evidence-based classification policy.
//
// Pure functions only (no filesystem access) so the confidence/classification
// policy can be unit tested independently of traversal. See agents.txt Batch
// 2 section 7.4 for the evidence-strength tiers this implements:
//   - Strong: an Android plugin id, or namespace/applicationId combined with
//     an Android plugin, or a manifest inside an Android-style source set.
//   - Supporting: source roots, res/, androidTest, wrapper, settings files,
//     catalog aliases, Compose dependencies.
//   - Weak: generic Gradle/Kotlin/Java files or directory names alone.
// A project must never be confirmed Android from weak evidence alone.
// ---------------------------------------------------------------------------

const CONFIDENCE_RANK: Record<MobileConfidence, number> = { unknown: 0, low: 1, medium: 2, high: 3 };

export function maxConfidence(a: MobileConfidence, b: MobileConfidence): MobileConfidence {
  return CONFIDENCE_RANK[a] >= CONFIDENCE_RANK[b] ? a : b;
}

function capConfidence(confidence: MobileConfidence, cap: MobileConfidence): MobileConfidence {
  return CONFIDENCE_RANK[confidence] <= CONFIDENCE_RANK[cap] ? confidence : cap;
}

export type ModuleClassificationInput = {
  hasAndroidApplicationPlugin: boolean;
  hasAndroidLibraryPlugin: boolean;
  hasCatalogAndroidPluginAliasEvidence: boolean;
  namespace?: string;
  applicationId?: string;
  hasManifest: boolean;
  hasSrcRoots: boolean;
  hasResDir: boolean;
  hasGenericBuildFile: boolean;
};

export type ModuleClassificationOutput = {
  kind: AndroidProjectKind;
  confidence: MobileConfidence;
  evidence: string[];
};

// Classifies a single Gradle module from its collected static evidence.
// Directory naming (e.g. a module literally called "app") is never used as a
// signal — only plugin declarations, manifest presence, and Android-specific
// identifiers.
export function classifyModule(input: ModuleClassificationInput): ModuleClassificationOutput {
  const evidence: string[] = [];

  if (input.hasAndroidApplicationPlugin) {
    evidence.push("com.android.application plugin declared");
    const strongCombo = input.hasManifest || Boolean(input.namespace) || Boolean(input.applicationId);
    if (input.hasManifest) evidence.push("AndroidManifest.xml present in module source set");
    if (input.namespace) evidence.push(`namespace = "${input.namespace}"`);
    if (input.applicationId) evidence.push(`applicationId = "${input.applicationId}"`);
    return { kind: "application", confidence: strongCombo ? "high" : "medium", evidence };
  }

  if (input.hasAndroidLibraryPlugin) {
    evidence.push("com.android.library plugin declared");
    const strongCombo = input.hasManifest || Boolean(input.namespace);
    if (input.hasManifest) evidence.push("AndroidManifest.xml present in module source set");
    if (input.namespace) evidence.push(`namespace = "${input.namespace}"`);
    return { kind: "library", confidence: strongCombo ? "high" : "medium", evidence };
  }

  if (input.hasCatalogAndroidPluginAliasEvidence) {
    evidence.push("version-catalog plugin alias referencing an Android Gradle Plugin entry");
    return { kind: "unknown", confidence: "medium", evidence };
  }

  // Generic Java/Kotlin source roots are deliberately excluded from this
  // list: they exist in any JVM project and are not Android-specific, so
  // they must never by themselves push a module toward Android detection
  // (agents.txt Batch 2 section 12.4 — generic Gradle/Kotlin/Java evidence
  // must not trigger Android detection without Android-specific evidence).
  const weakSignals: string[] = [];
  if (input.hasManifest) weakSignals.push("AndroidManifest.xml present without a resolved Android plugin");
  if (input.namespace) weakSignals.push(`namespace = "${input.namespace}" without a resolved Android plugin`);
  if (input.applicationId) weakSignals.push(`applicationId = "${input.applicationId}" without a resolved Android plugin`);
  if (input.hasResDir) weakSignals.push("res/ directory present");

  if (weakSignals.length > 0) {
    evidence.push(...weakSignals);
    return { kind: "unknown", confidence: "low", evidence };
  }

  if (input.hasGenericBuildFile) {
    evidence.push("Gradle build file present with no Android-specific evidence");
    return { kind: "non-android", confidence: "medium", evidence };
  }

  return { kind: "unknown", confidence: "unknown", evidence: [] };
}

export type UiToolkitClassificationInput = {
  composeBuildFeatureEvidence: boolean;
  composeDependencyEvidence: boolean;
  composePluginEvidence: boolean;
  composeSourceEvidence: boolean;
  hasResLayout: boolean;
  viewSourceEvidence: boolean;
};

export type UiToolkitClassificationOutput = {
  uiToolkit: AndroidUiToolkit;
  evidence: string[];
};

// Classifies UI toolkit usage for a single module. Conservative by design:
// Kotlin usage alone never implies Compose, and res/ alone never implies
// XML/View classification beyond what's asserted here (a literal layout
// resource file, not merely a res/ directory).
export function classifyModuleUiToolkit(input: UiToolkitClassificationInput): UiToolkitClassificationOutput {
  const evidence: string[] = [];
  const strongCompose = input.composeBuildFeatureEvidence || input.composeDependencyEvidence || input.composeSourceEvidence;
  const strongView = input.hasResLayout;

  if (input.composeBuildFeatureEvidence) evidence.push("buildFeatures { compose = true }");
  if (input.composeDependencyEvidence) evidence.push("Compose dependency evidence in build file");
  if (input.composeSourceEvidence) evidence.push("@Composable/androidx.compose import evidence in source");
  if (input.composePluginEvidence) evidence.push("Compose compiler plugin evidence");
  if (input.hasResLayout) evidence.push("res/layout XML resource present");
  if (input.viewSourceEvidence) evidence.push("traditional Android View usage evidence in source");

  if (strongCompose && strongView) {
    return { uiToolkit: "mixed", evidence };
  }
  if (strongCompose) {
    return { uiToolkit: "compose", evidence };
  }
  if (strongView) {
    return { uiToolkit: "xml-view", evidence };
  }
  return { uiToolkit: "uncertain", evidence };
}

export type ProjectModuleSummary = {
  kind: AndroidProjectKind;
  uiToolkit: AndroidUiToolkit;
};

// Combines per-module kinds into the overall project-level classification.
// Uses the widened ANDROID_PROJECT_KINDS vocabulary (see detection.ts) — a
// project with both application and library modules is "mixed"; more than
// one Android module of the same kind is "multi-module"; a single confirmed
// module keeps its own kind; Android-ish-but-unresolved evidence with no
// confirmed module is "partial"; nothing at all is "non-android".
export function combineProjectKind(modules: ProjectModuleSummary[], hasUnresolvedAndroidEvidence: boolean): AndroidProjectKind {
  const applicationCount = modules.filter((module) => module.kind === "application").length;
  const libraryCount = modules.filter((module) => module.kind === "library").length;
  const unknownCount = modules.filter((module) => module.kind === "unknown").length;

  if (applicationCount >= 1 && libraryCount >= 1) return "mixed";
  if (applicationCount + libraryCount > 1) return "multi-module";
  if (applicationCount === 1) return "application";
  if (libraryCount === 1) return "library";
  if (unknownCount > 0 || hasUnresolvedAndroidEvidence) return "partial";
  return "non-android";
}

export function combineProjectUiToolkit(modules: ProjectModuleSummary[]): AndroidUiToolkit {
  const androidModules = modules.filter((module) => module.kind === "application" || module.kind === "library");
  const composeCount = androidModules.filter((module) => module.uiToolkit === "compose").length;
  const viewCount = androidModules.filter((module) => module.uiToolkit === "xml-view").length;
  const mixedCount = androidModules.filter((module) => module.uiToolkit === "mixed").length;

  if (mixedCount > 0 || (composeCount > 0 && viewCount > 0)) return "mixed";
  if (composeCount > 0) return "compose";
  if (viewCount > 0) return "xml-view";
  return "uncertain";
}

export function combineProjectConfidence(
  projectKind: AndroidProjectKind,
  moduleConfidences: MobileConfidence[],
  hasNonAndroidEvidenceOnly: boolean
): MobileConfidence {
  if (projectKind === "non-android") {
    return hasNonAndroidEvidenceOnly ? "high" : "unknown";
  }

  const strongest = moduleConfidences.reduce<MobileConfidence>((acc, confidence) => maxConfidence(acc, confidence), "unknown");
  if (projectKind === "partial") {
    return capConfidence(strongest, "medium");
  }
  return strongest;
}
