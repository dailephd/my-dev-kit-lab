import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  parseAuditArgs,
  normalizeAuditConfig,
} from "../../src/audits/core/auditConfig.js";
import {
  DEFAULT_AUDIT_TYPES,
  DEFAULT_AUDIT_INCLUDE_AREAS,
  DEFAULT_AUDIT_OUTPUT_FORMATS,
  DEFAULT_AUDIT_FAIL_ON_THRESHOLD,
} from "../../src/audits/core/auditTypes.js";

const toolRoot = path.resolve("/tmp/audit-tool-root");

describe("parseAuditArgs", () => {
  it("returns empty object when no flags are provided", () => {
    expect(parseAuditArgs([])).toEqual({});
  });

  it("parses --target, --types, --include, --format, --fail-on, --out together", () => {
    const result = parseAuditArgs([
      "--target",
      "../other",
      "--types",
      "code-rot",
      "--include",
      "docs,tests",
      "--format",
      "json",
      "--fail-on",
      "high",
      "--out",
      "some dir with spaces",
    ]);
    expect(result).toEqual({
      target: "../other",
      types: "code-rot",
      include: "docs,tests",
      format: "json",
      failOn: "high",
      out: "some dir with spaces",
    });
  });

  it("fails cleanly when a flag is missing its value", () => {
    expect(() => parseAuditArgs(["--types"])).toThrow(/Missing value/);
    expect(() => parseAuditArgs(["--target"])).toThrow(/Missing value/);
    expect(() => parseAuditArgs(["--include"])).toThrow(/Missing value/);
    expect(() => parseAuditArgs(["--format"])).toThrow(/Missing value/);
    expect(() => parseAuditArgs(["--fail-on"])).toThrow(/Missing value/);
    expect(() => parseAuditArgs(["--out"])).toThrow(/Missing value/);
  });
});

describe("normalizeAuditConfig — defaults (npm run audit with no flags)", () => {
  it("defaults types, include, formats, and fail-on", () => {
    const config = normalizeAuditConfig({}, toolRoot);
    expect(config.types).toEqual([...DEFAULT_AUDIT_TYPES]);
    expect(config.typesWereDefault).toBe(true);
    expect(config.include).toEqual([...DEFAULT_AUDIT_INCLUDE_AREAS]);
    expect(config.includeWereDefault).toBe(true);
    expect(config.formats).toEqual([...DEFAULT_AUDIT_OUTPUT_FORMATS]);
    expect(config.formatsWereDefault).toBe(true);
    expect(config.failOn).toBe(DEFAULT_AUDIT_FAIL_ON_THRESHOLD);
    expect(config.failOnWasDefault).toBe(true);
  });

  it("defaults targetMode to self and marks isDefaultRun true", () => {
    const config = normalizeAuditConfig({}, toolRoot);
    expect(config.targetMode).toBe("self");
    expect(config.isDefaultRun).toBe(true);
  });

  it("defaults --out under reports/audits/<type>", () => {
    const config = normalizeAuditConfig({}, toolRoot);
    expect(config.out).toBe(path.join(toolRoot, "reports", "audits", "code-rot"));
    expect(config.outWasDefault).toBe(true);
  });
});

describe("normalizeAuditConfig — --types", () => {
  it("accepts code-rot", () => {
    const config = normalizeAuditConfig({ types: "code-rot" }, toolRoot);
    expect(config.types).toEqual(["code-rot"]);
    expect(config.typesWereDefault).toBe(false);
  });

  it("rejects quality as planned but not implemented", () => {
    expect(() => normalizeAuditConfig({ types: "quality" }, toolRoot)).toThrow(/planned but not implemented/i);
  });

  it("rejects security as planned but not implemented", () => {
    expect(() => normalizeAuditConfig({ types: "security" }, toolRoot)).toThrow(/planned but not implemented/i);
  });

  it("rejects project and all as planned but not implemented", () => {
    expect(() => normalizeAuditConfig({ types: "project" }, toolRoot)).toThrow(/planned but not implemented/i);
    expect(() => normalizeAuditConfig({ types: "all" }, toolRoot)).toThrow(/planned but not implemented/i);
  });

  it("rejects a genuinely unknown value distinctly from a planned one", () => {
    expect(() => normalizeAuditConfig({ types: "not-a-real-type" }, toolRoot)).toThrow(/Invalid --types value/);
  });

  it("rejects an empty --types value", () => {
    expect(() => normalizeAuditConfig({ types: "" }, toolRoot)).toThrow(/empty entries/);
    expect(() => normalizeAuditConfig({ types: "code-rot,," }, toolRoot)).toThrow(/empty entries/);
  });
});

describe("normalizeAuditConfig — --include", () => {
  it("accepts a single value: docs", () => {
    const config = normalizeAuditConfig({ include: "docs" }, toolRoot);
    expect(config.include).toEqual(["docs"]);
  });

  it("accepts all five values", () => {
    const config = normalizeAuditConfig({ include: "docs,tests,package,architecture,cli" }, toolRoot);
    expect(config.include).toEqual(["docs", "tests", "package", "architecture", "cli"]);
  });

  it("rejects unknown values", () => {
    expect(() => normalizeAuditConfig({ include: "not-a-real-area" }, toolRoot)).toThrow(/Invalid --include value/);
  });

  it("deduplicates and orders deterministically regardless of input order", () => {
    const config = normalizeAuditConfig({ include: "cli,docs,cli,tests" }, toolRoot);
    expect(config.include).toEqual(["docs", "tests", "cli"]);
  });
});

describe("normalizeAuditConfig — --format", () => {
  it("accepts text", () => {
    expect(normalizeAuditConfig({ format: "text" }, toolRoot).formats).toEqual(["text"]);
  });

  it("accepts json", () => {
    expect(normalizeAuditConfig({ format: "json" }, toolRoot).formats).toEqual(["json"]);
  });

  it("accepts text,json in either order", () => {
    expect(normalizeAuditConfig({ format: "text,json" }, toolRoot).formats).toEqual(["text", "json"]);
    expect(normalizeAuditConfig({ format: "json,text" }, toolRoot).formats).toEqual(["text", "json"]);
  });

  it("rejects unknown values", () => {
    expect(() => normalizeAuditConfig({ format: "yaml" }, toolRoot)).toThrow(/Invalid --format value/);
  });
});

describe("normalizeAuditConfig — --fail-on", () => {
  it("accepts blocker, high, medium, low, and none", () => {
    for (const value of ["blocker", "high", "medium", "low", "none"]) {
      expect(normalizeAuditConfig({ failOn: value }, toolRoot).failOn).toBe(value);
    }
  });

  it("rejects unknown values", () => {
    expect(() => normalizeAuditConfig({ failOn: "critical" }, toolRoot)).toThrow(/Invalid --fail-on value/);
  });
});

describe("normalizeAuditConfig — --out", () => {
  it("accepts a safe output path with spaces", () => {
    const config = normalizeAuditConfig({ out: "some dir with spaces/out" }, toolRoot);
    expect(config.out).toBe(path.resolve("some dir with spaces/out"));
    expect(config.outWasDefault).toBe(false);
  });

  it("rejects an empty --out value", () => {
    expect(() => normalizeAuditConfig({ out: "" }, toolRoot)).toThrow(/must not be empty/);
  });
});

describe("normalizeAuditConfig — targetMode and isDefaultRun", () => {
  it("targetMode is external when --target is supplied", () => {
    const config = normalizeAuditConfig({ target: "../other" }, toolRoot);
    expect(config.targetMode).toBe("external");
  });

  it("isDefaultRun is false when any flag is supplied", () => {
    expect(normalizeAuditConfig({ types: "code-rot" }, toolRoot).isDefaultRun).toBe(false);
    expect(normalizeAuditConfig({ failOn: "none" }, toolRoot).isDefaultRun).toBe(false);
  });
});
