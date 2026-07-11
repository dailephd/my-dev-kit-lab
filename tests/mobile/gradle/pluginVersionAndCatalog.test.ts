import { describe, expect, it } from "vitest";
import { parseVersionCatalog, resolveCatalogVersion, accessorSuffixToCatalogAlias } from "../../../src/mobile/android/gradle/versionCatalogMetadata.js";
import { resolvePluginVersion } from "../../../src/mobile/android/gradle/pluginVersionExtractor.js";

const CATALOG_TEXT = `
[versions]
agp = "8.2.0"
kotlin = "1.9.22"

[plugins]
android-application = { id = "com.android.application", version.ref = "agp" }
android-library = { id = "com.android.library", version.ref = "agp" }
kotlin-android = { id = "org.jetbrains.kotlin.android", version.ref = "kotlin" }
compose-compiler = { id = "org.jetbrains.kotlin.plugin.compose", version = "1.5.8" }

[libraries]
compose-bom = { module = "androidx.compose:compose-bom", version.ref = "kotlin" }
`;

// ANDROID-B4-08: Version-catalog plugin resolution.
describe("parseVersionCatalog / resolveCatalogVersion — ANDROID-B4-08", () => {
  it("resolves a plugin alias's version via version.ref indirection", () => {
    const catalog = parseVersionCatalog(CATALOG_TEXT);
    const entry = catalog.plugins["android-application"];
    expect(entry.id).toBe("com.android.application");
    expect(resolveCatalogVersion(catalog, entry)).toBe("8.2.0");
  });

  it("resolves a plugin alias's version from a direct inline version", () => {
    const catalog = parseVersionCatalog(CATALOG_TEXT);
    const entry = catalog.plugins["compose-compiler"];
    expect(resolveCatalogVersion(catalog, entry)).toBe("1.5.8");
  });

  it("returns undefined for a version.ref that does not exist in [versions]", () => {
    const catalog = parseVersionCatalog(CATALOG_TEXT);
    expect(resolveCatalogVersion(catalog, { versionRef: "doesNotExist" })).toBeUndefined();
  });

  it("converts a dotted accessor suffix back to its kebab-case alias", () => {
    expect(accessorSuffixToCatalogAlias("android.application")).toBe("android-application");
  });
});

// ANDROID-B4-09: Android Gradle Plugin version resolution — direct, classpath, and catalog forms.
describe("resolvePluginVersion — ANDROID-B4-09", () => {
  const catalog = parseVersionCatalog(CATALOG_TEXT);

  it("resolves a direct Kotlin-DSL `id(...) version \"X\"` declaration", () => {
    const text = `id("com.android.application") version "8.3.0" apply false`;
    expect(resolvePluginVersion(text, "com.android.application", catalog).version).toBe("8.3.0");
  });

  it("resolves a direct Groovy `id '...' version '...'` declaration", () => {
    const text = `id 'com.android.application' version '8.3.1' apply false`;
    expect(resolvePluginVersion(text, "com.android.application", catalog).version).toBe("8.3.1");
  });

  it("resolves the legacy buildscript classpath form", () => {
    const text = `classpath 'com.android.tools.build:gradle:7.4.2'`;
    expect(resolvePluginVersion(text, "com.android.application", catalog, "com.android.tools.build:gradle").version).toBe("7.4.2");
  });

  it("resolves via a version-catalog alias when no direct declaration exists", () => {
    const text = `plugins {\n    alias(libs.plugins.android.application) apply false\n}`;
    expect(resolvePluginVersion(text, "com.android.application", catalog).version).toBe("8.2.0");
  });

  it("returns no version (not a fabricated one) when nothing resolves", () => {
    const text = `plugins {\n    id("com.android.application")\n}`;
    expect(resolvePluginVersion(text, "com.android.application", undefined).version).toBeUndefined();
  });

  it("never claims plugin compatibility or currentness in its return shape", () => {
    const text = `id("com.android.application") version "8.3.0"`;
    const result = resolvePluginVersion(text, "com.android.application", catalog);
    expect(result).not.toHaveProperty("compatible");
    expect(result).not.toHaveProperty("current");
  });
});
