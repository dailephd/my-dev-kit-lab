import { describe, expect, it } from "vitest";
import {
  classifyModule,
  classifyModuleUiToolkit,
  combineProjectConfidence,
  combineProjectKind,
  combineProjectUiToolkit,
} from "../../../src/mobile/android/detect/classify.js";

function baseModuleInput(overrides: Partial<Parameters<typeof classifyModule>[0]> = {}) {
  return {
    hasAndroidApplicationPlugin: false,
    hasAndroidLibraryPlugin: false,
    hasCatalogAndroidPluginAliasEvidence: false,
    hasManifest: false,
    hasSrcRoots: false,
    hasResDir: false,
    hasGenericBuildFile: false,
    ...overrides,
  };
}

// ANDROID-B2-11: Module plugin evidence correctly distinguishes
// com.android.application and com.android.library; directory naming never
// overrides plugin evidence.
describe("classifyModule — application vs library classification — ANDROID-B2-11", () => {
  it("classifies a module with the application plugin as application regardless of directory name", () => {
    const result = classifyModule(baseModuleInput({ hasAndroidApplicationPlugin: true, hasManifest: true }));
    expect(result.kind).toBe("application");
  });

  it("classifies a module named 'app' with the library plugin as library, not application", () => {
    // The classifier never receives a directory name — this test documents
    // that plugin evidence alone drives classification.
    const result = classifyModule(baseModuleInput({ hasAndroidLibraryPlugin: true, namespace: "com.example.app" }));
    expect(result.kind).toBe("library");
  });

  it("leaves plugin state unknown rather than guessing when no plugin evidence exists", () => {
    const result = classifyModule(baseModuleInput());
    expect(result.kind).not.toBe("application");
    expect(result.kind).not.toBe("library");
  });

  it("classifies a module with only generic Gradle evidence as non-android, not unknown", () => {
    const result = classifyModule(baseModuleInput({ hasGenericBuildFile: true, hasSrcRoots: true }));
    expect(result.kind).toBe("non-android");
  });

  it("assigns high confidence when plugin evidence is combined with a manifest or namespace", () => {
    const withManifest = classifyModule(baseModuleInput({ hasAndroidApplicationPlugin: true, hasManifest: true }));
    expect(withManifest.confidence).toBe("high");
  });

  it("assigns medium confidence when only plugin evidence exists without manifest/namespace/applicationId", () => {
    const pluginOnly = classifyModule(baseModuleInput({ hasAndroidLibraryPlugin: true }));
    expect(pluginOnly.confidence).toBe("medium");
  });
});

// ANDROID-B2-13: Strong Compose evidence produces Compose classification;
// Kotlin alone does not.
describe("classifyModuleUiToolkit — Compose evidence strength — ANDROID-B2-13", () => {
  const noEvidence = {
    composeBuildFeatureEvidence: false,
    composeDependencyEvidence: false,
    composePluginEvidence: false,
    composeSourceEvidence: false,
    hasResLayout: false,
    viewSourceEvidence: false,
  };

  it("classifies as compose when buildFeatures { compose = true } is present", () => {
    expect(classifyModuleUiToolkit({ ...noEvidence, composeBuildFeatureEvidence: true }).uiToolkit).toBe("compose");
  });

  it("classifies as compose from Compose dependency evidence alone", () => {
    expect(classifyModuleUiToolkit({ ...noEvidence, composeDependencyEvidence: true }).uiToolkit).toBe("compose");
  });

  it("classifies as compose from @Composable/import source evidence alone", () => {
    expect(classifyModuleUiToolkit({ ...noEvidence, composeSourceEvidence: true }).uiToolkit).toBe("compose");
  });

  it("does not classify as compose from Kotlin usage alone (negative control — no compose-specific evidence)", () => {
    expect(classifyModuleUiToolkit(noEvidence).uiToolkit).toBe("uncertain");
  });

  it("does not classify as compose from a supporting-only Compose plugin signal without strong evidence", () => {
    expect(classifyModuleUiToolkit({ ...noEvidence, composePluginEvidence: true }).uiToolkit).toBe("uncertain");
  });
});

// ANDROID-B2-14: Strong Compose evidence + layout resources → mixed.
describe("classifyModuleUiToolkit — mixed classification — ANDROID-B2-14", () => {
  it("classifies as mixed when strong Compose evidence and layout resources both exist", () => {
    const result = classifyModuleUiToolkit({
      composeBuildFeatureEvidence: true,
      composeDependencyEvidence: false,
      composePluginEvidence: false,
      composeSourceEvidence: false,
      hasResLayout: true,
      viewSourceEvidence: false,
    });
    expect(result.uiToolkit).toBe("mixed");
  });
});

// ANDROID-B2-15: Insufficient evidence produces uncertain rather than a guess.
describe("classifyModuleUiToolkit — uncertain classification — ANDROID-B2-15", () => {
  it("classifies as uncertain when no UI evidence is present at all", () => {
    const result = classifyModuleUiToolkit({
      composeBuildFeatureEvidence: false,
      composeDependencyEvidence: false,
      composePluginEvidence: false,
      composeSourceEvidence: false,
      hasResLayout: false,
      viewSourceEvidence: false,
    });
    expect(result.uiToolkit).toBe("uncertain");
  });

  it("missing Compose evidence does not automatically prove XML/View", () => {
    const result = classifyModuleUiToolkit({
      composeBuildFeatureEvidence: false,
      composeDependencyEvidence: false,
      composePluginEvidence: false,
      composeSourceEvidence: false,
      hasResLayout: false,
      viewSourceEvidence: true,
    });
    // Weak/supporting-only View evidence without a concrete layout resource
    // stays uncertain rather than confirming XML/View.
    expect(result.uiToolkit).toBe("uncertain");
  });
});

describe("combineProjectKind / combineProjectUiToolkit / combineProjectConfidence", () => {
  it("combines one application and one library module into 'mixed'", () => {
    expect(
      combineProjectKind(
        [
          { kind: "application", uiToolkit: "uncertain" },
          { kind: "library", uiToolkit: "uncertain" },
        ],
        false
      )
    ).toBe("mixed");
  });

  it("combines two library modules into 'multi-module'", () => {
    expect(
      combineProjectKind(
        [
          { kind: "library", uiToolkit: "uncertain" },
          { kind: "library", uiToolkit: "uncertain" },
        ],
        false
      )
    ).toBe("multi-module");
  });

  it("falls back to 'non-android' with no modules and no unresolved evidence", () => {
    expect(combineProjectKind([], false)).toBe("non-android");
  });

  it("falls back to 'partial' when unresolved Android evidence exists but no module was confirmed", () => {
    expect(combineProjectKind([], true)).toBe("partial");
  });

  it("combines compose and xml-view modules into 'mixed'", () => {
    expect(
      combineProjectUiToolkit([
        { kind: "application", uiToolkit: "compose" },
        { kind: "library", uiToolkit: "xml-view" },
      ])
    ).toBe("mixed");
  });

  it("caps confidence at medium for a partial project even with high-confidence module evidence", () => {
    expect(combineProjectConfidence("partial", ["high"], false)).toBe("medium");
  });

  it("reports high confidence for a confidently non-android project", () => {
    expect(combineProjectConfidence("non-android", [], true)).toBe("high");
  });
});
