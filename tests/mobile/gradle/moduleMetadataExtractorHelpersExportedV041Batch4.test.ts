import { describe, expect, it } from "vitest";
import {
  extractBooleanLiteral,
  extractLiteral,
  extractNamedSubBlocks,
  findBlockBody,
  sliceBlockAt,
  stripComments,
} from "../../../src/mobile/android/gradle/moduleMetadataExtractor.js";

// v0.4.1 Batch 4 narrow inherited-contract widening: these Batch 3/4-era
// helper functions were module-private; exporting them (no behavior change)
// lets the new signing-configuration module reuse the exact same bounded
// Groovy/Kotlin-DSL extraction technique instead of a second implementation.
// Regression-tested per agents.txt Batch 4 section 6.
describe("moduleMetadataExtractor helper exports — v0.4.1 Batch 4 widening", () => {
  it("extractLiteral is exported and behaves as before", () => {
    expect(extractLiteral('namespace "com.example"', ["namespace"])).toEqual({ value: "com.example" });
  });

  it("extractBooleanLiteral is exported and behaves as before", () => {
    expect(extractBooleanLiteral("debuggable true", ["debuggable"])).toEqual({ value: true });
  });

  it("findBlockBody is exported and behaves as before", () => {
    expect(findBlockBody("signingConfigs { release { storePassword \"x\" } }", "signingConfigs")).toContain("storePassword");
  });

  it("sliceBlockAt is exported and behaves as before", () => {
    expect(sliceBlockAt("{ inner }", 0)).toBe(" inner ");
  });

  it("extractNamedSubBlocks is exported and behaves as before", () => {
    const result = extractNamedSubBlocks("signingConfigs { release { storePassword \"x\" } }", "signingConfigs");
    expect(result.find((b) => b.name === "release")?.content).toContain("storePassword");
  });

  it("stripComments is exported and behaves as before", () => {
    expect(stripComments("// comment\nreal")).not.toContain("comment");
  });
});
