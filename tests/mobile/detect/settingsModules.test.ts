import { describe, expect, it } from "vitest";
import { parseDeclaredModules } from "../../../src/mobile/android/detect/settingsModules.js";

// ANDROID-B2-08: Common Groovy settings syntax is parsed without evaluating Gradle.
describe("parseDeclaredModules — Groovy syntax — ANDROID-B2-08", () => {
  it("parses a single-quoted single include", () => {
    expect(parseDeclaredModules(`include ':app'`).declaredModulePaths).toEqual(["app"]);
  });

  it("parses a comma-separated bare include list", () => {
    expect(parseDeclaredModules(`include ':app', ':core'`).declaredModulePaths).toEqual(["app", "core"]);
  });

  it("parses a parenthesized Groovy include with double quotes", () => {
    expect(parseDeclaredModules(`include(":app")`).declaredModulePaths).toEqual(["app"]);
  });

  it("parses a parenthesized Groovy include with multiple modules", () => {
    expect(parseDeclaredModules(`include(":app", ":core")`).declaredModulePaths).toEqual(["app", "core"]);
  });
});

// ANDROID-B2-09: Common Kotlin DSL settings syntax is parsed deterministically.
describe("parseDeclaredModules — Kotlin DSL syntax — ANDROID-B2-09", () => {
  it("parses a single-line Kotlin DSL include", () => {
    expect(parseDeclaredModules(`include(":app")`).declaredModulePaths).toEqual(["app"]);
  });

  it("parses multiple module arguments", () => {
    expect(parseDeclaredModules(`include(":app", ":feature:home")`).declaredModulePaths).toEqual(["app", "feature/home"]);
  });

  it("parses a simple multiline include call", () => {
    const text = `include(\n    ":app",\n    ":core"\n)`;
    expect(parseDeclaredModules(text).declaredModulePaths).toEqual(["app", "core"]);
  });

  it("normalizes nested module paths from colon-separated Gradle paths", () => {
    expect(parseDeclaredModules(`include(":feature:home")`).declaredModulePaths).toEqual(["feature/home"]);
  });

  it("does not confuse includeBuild with include", () => {
    const result = parseDeclaredModules(`includeBuild("../shared-plugin")\ninclude(":app")`);
    expect(result.declaredModulePaths).toEqual(["app"]);
  });
});

// ANDROID-B2-10: Dynamic or unresolvable settings syntax does not crash or
// fabricate modules.
describe("parseDeclaredModules — unsupported dynamic declarations — ANDROID-B2-10", () => {
  it("records a warning for a string-interpolated module name instead of guessing", () => {
    const result = parseDeclaredModules(`include(":feature-$name")`);
    expect(result.declaredModulePaths).toEqual([]);
    expect(result.unsupportedDeclarations.length).toBeGreaterThan(0);
  });

  it("preserves static modules alongside a dynamic loop-based declaration without crashing", () => {
    const text = `include(":app")\nfor (m in listOf("a", "b")) { include(":\${m}") }`;
    expect(() => parseDeclaredModules(text)).not.toThrow();
    const result = parseDeclaredModules(text);
    expect(result.declaredModulePaths).toContain("app");
  });

  it("does not fabricate a module from an empty include call", () => {
    const result = parseDeclaredModules(`include()`);
    expect(result.declaredModulePaths).toEqual([]);
  });
});
