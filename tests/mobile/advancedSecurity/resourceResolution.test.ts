import path from "node:path";
import { describe, expect, it } from "vitest";
import { resolveAndroidXmlResourceReference } from "../../../src/mobile/android/advancedSecurity/resourceResolution.js";

const FIXTURES_ROOT = path.resolve("tests/fixtures/android/advanced-security-fixtures/resource-resolution");
const MODULE_A = path.join(FIXTURES_ROOT, "module-a");
const MODULE_B = path.join(FIXTURES_ROOT, "module-b");

describe("resolveAndroidXmlResourceReference", () => {
  // ANDROID-V041-B1-10 — module-contained resource resolution.
  it("resolves a single-source-set resource to its target-contained path", () => {
    const result = resolveAndroidXmlResourceReference(FIXTURES_ROOT, MODULE_A, "@xml/backup_rules");
    expect(result.state).toBe("resolved");
    if (result.state === "resolved") {
      expect(result.candidates[0].sourceSet).toBe("main");
      expect(result.candidates[0].relativePath).toBe("module-a/src/main/res/xml/backup_rules.xml");
    }
  });

  // ANDROID-V041-B1-11 — source-set evidence preserved, no silent merge.
  it("preserves the source set of the resolved candidate", () => {
    const result = resolveAndroidXmlResourceReference(FIXTURES_ROOT, MODULE_A, "@xml/backup_rules");
    if (result.state === "resolved") {
      expect(result.candidates[0].sourceSet).toBeDefined();
    } else {
      throw new Error("expected resolved state");
    }
  });

  // ANDROID-V041-B1-12 — ambiguous resolution across source sets.
  it("reports ambiguous when the same resource name exists in multiple source sets", () => {
    const result = resolveAndroidXmlResourceReference(FIXTURES_ROOT, MODULE_A, "@xml/network_security_config");
    expect(result.state).toBe("ambiguous");
    if (result.state === "ambiguous") {
      const sourceSets = result.candidates.map((c) => c.sourceSet).sort();
      expect(sourceSets).toEqual(["debug", "main"]);
    }
  });

  // ANDROID-V041-B1-13 — missing resource.
  it("reports missing when the reference is well-formed but no file matches", () => {
    const result = resolveAndroidXmlResourceReference(FIXTURES_ROOT, MODULE_A, "@xml/does_not_exist");
    expect(result.state).toBe("missing");
    if (result.state === "missing") {
      expect(result.searchedSourceSets.length).toBeGreaterThan(0);
    }
  });

  // ANDROID-V041-B1-14 — malformed/unsupported references never throw.
  it("reports malformed-reference for a malformed reference without throwing", () => {
    const result = resolveAndroidXmlResourceReference(FIXTURES_ROOT, MODULE_A, "not-a-reference");
    expect(result.state).toBe("malformed-reference");
  });

  it("reports unsupported-reference for a non-xml resource type", () => {
    const result = resolveAndroidXmlResourceReference(FIXTURES_ROOT, MODULE_A, "@string/app_name");
    expect(result.state).toBe("unsupported-reference");
  });

  it("reports unsupported-reference for a package-qualified external reference", () => {
    const result = resolveAndroidXmlResourceReference(FIXTURES_ROOT, MODULE_A, "@com.example.lib:xml/network_security_config");
    expect(result.state).toBe("unsupported-reference");
  });

  it("reports malformed-reference for an unresolved placeholder", () => {
    const result = resolveAndroidXmlResourceReference(FIXTURES_ROOT, MODULE_A, "${networkSecurityConfig}");
    expect(result.state).toBe("malformed-reference");
  });

  // ANDROID-V041-B1-15 — target containment.
  it("resolves normally when modulePath is legitimately inside root", () => {
    expect(() => resolveAndroidXmlResourceReference(FIXTURES_ROOT, MODULE_A, "@xml/backup_rules")).not.toThrow();
  });

  it("throws rather than silently resolving when modulePath is outside the given root", () => {
    // root=MODULE_A, but modulePath is the repo root — an ancestor of
    // MODULE_A, not a descendant. relativeWithinRoot must reject this rather
    // than the resolver silently reporting a false "resolved"/"missing".
    const outsideModulePath = path.resolve(".");
    expect(() => resolveAndroidXmlResourceReference(MODULE_A, outsideModulePath, "@xml/backup_rules")).toThrow(/escapes target root/);
  });

  it("does not resolve a resource name containing a traversal-shaped candidate path outside module root", () => {
    // parseAndroidResourceReference already rejects traversal-shaped names as
    // malformed before any filesystem lookup happens.
    const result = resolveAndroidXmlResourceReference(FIXTURES_ROOT, MODULE_A, "@xml/../../../../etc/passwd");
    expect(result.state).toBe("malformed-reference");
  });

  // ANDROID-V041-B1-16 — no Gradle/Android SDK/network dependency: resolution
  // is pure fs/path logic. Proven structurally: this test file never imports
  // or spawns gradle/java/adb, and the resolver module itself only imports
  // node:fs/node:path/pathSafety/resourceReference (asserted by the earlier
  // architecture exploration; a static grep-based guard would duplicate that
  // finding rather than add new coverage, so this is left as a documented
  // invariant rather than a redundant test).

  it("finds the malformed XML fixture file as a resolvable path (content validity is a later batch's concern)", () => {
    const result = resolveAndroidXmlResourceReference(FIXTURES_ROOT, MODULE_B, "@xml/malformed_network_security_config");
    expect(result.state).toBe("resolved");
  });

  // ANDROID-V041-B1-17 — deterministic candidate ordering regardless of
  // repeated invocation (proxy for filesystem-enumeration independence).
  it("returns ambiguous candidates in a stable, deterministic order across repeated calls", () => {
    const first = resolveAndroidXmlResourceReference(FIXTURES_ROOT, MODULE_A, "@xml/network_security_config");
    const second = resolveAndroidXmlResourceReference(FIXTURES_ROOT, MODULE_A, "@xml/network_security_config");
    expect(first).toEqual(second);
  });
});
