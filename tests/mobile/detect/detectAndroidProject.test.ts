import { describe, expect, it } from "vitest";
import path from "node:path";
import fs from "node:fs";
import os from "node:os";
import { execSync } from "node:child_process";
import { detectAndroidProject } from "../../../src/mobile/android/detect/detectAndroidProject.js";
import { detectAndroidTarget } from "../../../src/mobile/android/detect/androidTargetDetection.js";
import { resolveLocalProjectTarget } from "../../../src/core/localProjectTarget.js";

const FIXTURES_ROOT = path.resolve(__dirname, "..", "..", "fixtures", "android");
const TOOL_ROOT = path.resolve(__dirname, "..", "..", "..");

function fixture(name: string): string {
  return path.join(FIXTURES_ROOT, name);
}

// ANDROID-B2-01: Compose application detection.
describe("detectAndroidProject — compose-app — ANDROID-B2-01", () => {
  it("detects an Android application classified as Compose with evidence", () => {
    const result = detectAndroidProject(fixture("compose-app"));
    expect(result.detected).toBe(true);
    expect(result.projectKind).toBe("application");
    expect(result.applicationModules).toEqual(["app"]);
    expect(result.uiToolkit).toBe("compose");
    expect(result.kotlinSourceRoots.length).toBeGreaterThan(0);
    expect(result.manifestPaths).toEqual(["app/src/main/AndroidManifest.xml"]);
    expect(result.modules[0].evidence).toBeDefined();
    expect(result.modules[0].evidence!.length).toBeGreaterThan(0);
  });
});

// ANDROID-B2-02: XML/View application detection.
describe("detectAndroidProject — xml-view-app — ANDROID-B2-02", () => {
  it("detects an Android application classified as XML/View, not Compose", () => {
    const result = detectAndroidProject(fixture("xml-view-app"));
    expect(result.detected).toBe(true);
    expect(result.applicationModules).toEqual(["app"]);
    expect(result.uiToolkit).toBe("xml-view");
    expect(result.manifestPaths).toEqual(["app/src/main/AndroidManifest.xml"]);
  });
});

// ANDROID-B2-03: Java Android application detection.
describe("detectAndroidProject — java-app — ANDROID-B2-03", () => {
  it("detects a Java Android application using Java source and manifest evidence", () => {
    const result = detectAndroidProject(fixture("java-app"));
    expect(result.detected).toBe(true);
    expect(result.applicationModules).toEqual(["app"]);
    expect(result.javaSourceRoots).toEqual(["app/src/main/java"]);
    expect(result.kotlinSourceRoots).toEqual([]);
  });
});

// ANDROID-B2-04: Android library detection.
describe("detectAndroidProject — library — ANDROID-B2-04", () => {
  it("classifies the fixture as an Android library, not an application", () => {
    const result = detectAndroidProject(fixture("library"));
    expect(result.projectKind).toBe("library");
    expect(result.libraryModules).toEqual(["mylibrary"]);
    expect(result.applicationModules).toEqual([]);
    expect(result.modules[0].evidence!.some((e) => e.includes("com.android.library"))).toBe(true);
  });
});

// ANDROID-B2-05: Multi-module discovery.
describe("detectAndroidProject — multi-module — ANDROID-B2-05", () => {
  it("discovers all modules and separates application from library modules deterministically", () => {
    const result = detectAndroidProject(fixture("multi-module"));
    expect(result.applicationModules).toEqual(["app"]);
    expect(result.libraryModules).toEqual(["core", "feature-login"]);
    expect(result.projectKind).toBe("mixed");
    expect(result.modules.map((m) => m.path)).toEqual(["app", "core", "feature-login"]);
  });

  it("produces identical ordering across repeated runs", () => {
    const first = detectAndroidProject(fixture("multi-module"));
    const second = detectAndroidProject(fixture("multi-module"));
    expect(first.modules.map((m) => m.path)).toEqual(second.modules.map((m) => m.path));
    expect(first.applicationModules).toEqual(second.applicationModules);
    expect(first.libraryModules).toEqual(second.libraryModules);
  });
});

// ANDROID-B2-06: Partial Android detection.
describe("detectAndroidProject — partial — ANDROID-B2-06", () => {
  it("produces a conservative partial classification rather than a confirmed application", () => {
    const result = detectAndroidProject(fixture("partial"));
    expect(result.projectKind).toBe("partial");
    expect(result.confidence).not.toBe("high");
    expect(result.partialOrUnsupportedStructure).toBe(true);
    expect(result.warnings.length).toBeGreaterThan(0);
    expect(result.uiToolkit).toBe("uncertain");
    expect(result.applicationModules).toEqual(["app"]);
  });

  it("does not crash on the incomplete fixture", () => {
    expect(() => detectAndroidProject(fixture("partial"))).not.toThrow();
  });
});

// ANDROID-B2-07: Non-Android Gradle false-positive prevention.
describe("detectAndroidProject — non-android-gradle — ANDROID-B2-07", () => {
  it("does not classify a generic Gradle/Java project as Android", () => {
    const result = detectAndroidProject(fixture("non-android-gradle"));
    expect(result.detected).toBe(false);
    expect(result.projectKind).toBe("non-android");
    expect(result.applicationModules).toEqual([]);
    expect(result.libraryModules).toEqual([]);
    expect(result.uiToolkit).not.toBe("compose");
  });
});

// ANDROID-B2-12: Kotlin, Java, and mixed source discovery.
describe("detectAndroidProject — language discovery — ANDROID-B2-12", () => {
  it("records deterministic, sorted source roots and never includes excluded directories", () => {
    const result = detectAndroidProject(fixture("compose-app"));
    const sorted = [...result.kotlinSourceRoots].sort((a, b) => a.localeCompare(b));
    expect(result.kotlinSourceRoots).toEqual(sorted);
    for (const root of [...result.javaSourceRoots, ...result.kotlinSourceRoots]) {
      expect(root).not.toContain("build/");
      expect(root).not.toContain(".gradle/");
    }
  });

  it("records unit-test and instrumented-test roots separately from production roots", () => {
    const result = detectAndroidProject(fixture("multi-module"));
    expect(result.unitTestSourceRoots).toEqual(["app/src/test"]);
    expect(result.instrumentedTestSourceRoots).toEqual(["app/src/androidTest"]);
    expect(result.unitTestSourceRoots).not.toEqual(result.javaSourceRoots);
    expect(result.instrumentedTestSourceRoots).not.toEqual(result.javaSourceRoots);
  });
});

// ANDROID-B2-16: Manifest path discovery only — no content parsing.
describe("detectAndroidProject — manifest discovery only — ANDROID-B2-16", () => {
  it("discovers manifest paths without exposing any parsed permission/component data", () => {
    const result = detectAndroidProject(fixture("xml-view-app"));
    expect(result.manifestPaths).toEqual(["app/src/main/AndroidManifest.xml"]);
    expect(result).not.toHaveProperty("permissions");
    expect(result).not.toHaveProperty("components");
  });
});

// ANDROID-B2-17: Excluded directory handling.
describe("detectAndroidProject — excluded directory handling — ANDROID-B2-17", () => {
  it("ignores Android-looking evidence planted inside excluded directories", () => {
    const tempRoot = fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()), "android-excl-"));
    try {
      fs.mkdirSync(path.join(tempRoot, "build", "fake-module"), { recursive: true });
      fs.writeFileSync(
        path.join(tempRoot, "build", "fake-module", "build.gradle.kts"),
        `plugins { id("com.android.application") }`
      );
      fs.mkdirSync(path.join(tempRoot, ".gradle", "fake"), { recursive: true });
      fs.writeFileSync(path.join(tempRoot, ".gradle", "fake", "build.gradle.kts"), `plugins { id("com.android.application") }`);
      fs.writeFileSync(path.join(tempRoot, "settings.gradle.kts"), `rootProject.name = "excl-test"`);

      const result = detectAndroidProject(tempRoot);
      expect(result.applicationModules).toEqual([]);
      expect(result.detected).toBe(false);
    } finally {
      fs.rmSync(tempRoot, { recursive: true, force: true });
    }
  });
});

// ANDROID-B2-18: Path normalization.
describe("detectAndroidProject — path normalization — ANDROID-B2-18", () => {
  it("returns POSIX-style forward-slash relative paths regardless of platform", () => {
    const result = detectAndroidProject(fixture("multi-module"));
    for (const p of [...result.manifestPaths, ...result.rootBuildFiles, ...result.gradleSettingsFiles]) {
      expect(p).not.toContain("\\");
    }
    for (const module of result.modules) {
      expect(module.path).not.toContain("\\");
    }
  });
});

// ANDROID-B2-19: Deterministic repeated runs.
describe("detectAndroidProject — deterministic repeated runs — ANDROID-B2-19", () => {
  it("produces equivalent JSON-serialized output across repeated runs", () => {
    const first = JSON.stringify(detectAndroidProject(fixture("compose-app")));
    const second = JSON.stringify(detectAndroidProject(fixture("compose-app")));
    expect(first).toBe(second);
  });
});

// ANDROID-B2-20: Target immutability.
describe("detectAndroidProject — target immutability — ANDROID-B2-20", () => {
  it("does not modify fixture files on disk", () => {
    const target = fixture("multi-module");
    const before = execSync("git status --short", { cwd: TOOL_ROOT, encoding: "utf8" });
    detectAndroidProject(target);
    const after = execSync("git status --short", { cwd: TOOL_ROOT, encoding: "utf8" });
    expect(after).toBe(before);
  });

  it("does not create any new files or directories inside the target", () => {
    const target = fixture("compose-app");
    const before = fs.readdirSync(target, { recursive: true } as any).sort();
    detectAndroidProject(target);
    const after = fs.readdirSync(target, { recursive: true } as any).sort();
    expect(after).toEqual(before);
  });
});

// ANDROID-B2-21: Target metadata composition.
describe("detectAndroidTarget — target metadata composition — ANDROID-B2-21", () => {
  it("composes LocalProjectTargetMetadata with the detection result without confusing tool/target root", () => {
    const local = resolveLocalProjectTarget(fixture("compose-app"), TOOL_ROOT);
    const { detection, target } = detectAndroidTarget(local);

    expect(target.local.toolRoot).toBe(path.resolve(TOOL_ROOT));
    expect(target.local.targetRoot).toBe(path.resolve(fixture("compose-app")));
    expect(target.classification.projectKind).toBe(detection.projectKind);
    expect(target.applicationModules).toEqual(detection.applicationModules);
    expect(target.androidProfile.detectionConfidence).toBe(detection.confidence);
  });
});
