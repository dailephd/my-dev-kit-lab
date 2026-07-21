import { describe, expect, it } from "vitest";
import { parseSupportedMajorOneSchemaVersion } from "../../../src/evaluation/upstreamArtifacts/schemaVersion.js";

const ARTIFACT_KIND = "my-dev-kit-context-capsule-v1" as const;
const SOURCE_PATH = "fixture-source-path.json";

function parse(value: unknown) {
  return parseSupportedMajorOneSchemaVersion(value as never, ARTIFACT_KIND, SOURCE_PATH);
}

describe("parseSupportedMajorOneSchemaVersion", () => {
  it("accepts 1.0.0", () => {
    const result = parse("1.0.0");
    expect("ok" in result).toBe(false);
    expect(result).toEqual({ version: "1.0.0", major: 1, minor: 0, patch: 0 });
  });

  it("accepts 1.1.0", () => {
    const result = parse("1.1.0");
    expect(result).toEqual({ version: "1.1.0", major: 1, minor: 1, patch: 0 });
  });

  it("accepts 1.999.999", () => {
    const result = parse("1.999.999");
    expect(result).toEqual({ version: "1.999.999", major: 1, minor: 999, patch: 999 });
  });

  it("rejects 0.1.0", () => {
    const result = parse("0.1.0");
    expect("ok" in result && result.ok === false).toBe(true);
    expect((result as { code: string }).code).toBe("UNSUPPORTED_SCHEMA_MAJOR");
  });

  it("rejects 2.0.0", () => {
    const result = parse("2.0.0");
    expect((result as { code: string }).code).toBe("UNSUPPORTED_SCHEMA_MAJOR");
  });

  it("rejects 1 (partial version)", () => {
    const result = parse("1");
    expect((result as { code: string }).code).toBe("INVALID_SCHEMA_VERSION");
  });

  it("rejects 1.0 (partial version)", () => {
    const result = parse("1.0");
    expect((result as { code: string }).code).toBe("INVALID_SCHEMA_VERSION");
  });

  it("rejects 1.0.0-beta (prerelease suffix)", () => {
    const result = parse("1.0.0-beta");
    expect((result as { code: string }).code).toBe("INVALID_SCHEMA_VERSION");
  });

  it("rejects 1.0.0+build (build suffix)", () => {
    const result = parse("1.0.0+build");
    expect((result as { code: string }).code).toBe("INVALID_SCHEMA_VERSION");
  });

  it("rejects leading whitespace", () => {
    const result = parse(" 1.0.0");
    expect((result as { code: string }).code).toBe("INVALID_SCHEMA_VERSION");
  });

  it("rejects trailing whitespace", () => {
    const result = parse("1.0.0 ");
    expect((result as { code: string }).code).toBe("INVALID_SCHEMA_VERSION");
  });

  it("rejects a non-string value", () => {
    const result = parse(1);
    expect((result as { code: string }).code).toBe("INVALID_SCHEMA_VERSION");
  });
});
