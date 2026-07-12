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

  // v0.4.2 Batch 3 -- --android is a closed, presence-only boolean flag: no
  // value is consumed after it, unlike every other flag above.
  it("parses --android as a presence-only boolean flag, consuming no following argument", () => {
    expect(parseAuditArgs(["--android"])).toEqual({ android: true });
    expect(parseAuditArgs(["--types", "security", "--android"])).toEqual({ types: "security", android: true });
    // The token immediately after --android is parsed as its own flag, not
    // consumed as a value -- proven by --target still working right after it.
    expect(parseAuditArgs(["--android", "--target", "some/path"])).toEqual({ android: true, target: "some/path" });
  });

  it("omits android from the parsed result when --android is not passed", () => {
    expect(parseAuditArgs(["--types", "security"])).toEqual({ types: "security" });
  });

  it("is idempotent when --android is passed more than once", () => {
    expect(parseAuditArgs(["--android", "--android"])).toEqual({ android: true });
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
  function expectPlannedTypeMessage(value: string): void {
    expect(() => normalizeAuditConfig({ types: value }, toolRoot)).toThrow(/planned but not implemented/i);
    expect(() => normalizeAuditConfig({ types: value }, toolRoot)).toThrow(/Implemented audit types: code-rot, security/i);
    expect(() => normalizeAuditConfig({ types: value }, toolRoot)).not.toThrow(/Only "code-rot" is implemented/i);
  }

  it("accepts code-rot", () => {
    const config = normalizeAuditConfig({ types: "code-rot" }, toolRoot);
    expect(config.types).toEqual(["code-rot"]);
    expect(config.typesWereDefault).toBe(false);
  });

  it("rejects quality as planned but not implemented and lists all implemented audit types", () => {
    expectPlannedTypeMessage("quality");
  });

  it("rejects project and all as planned but not implemented and lists all implemented audit types", () => {
    expectPlannedTypeMessage("project");
    expectPlannedTypeMessage("all");
  });

  // v0.3.2 Batch 4 -- security-validation audit adapter makes "security" a
  // real, selectable --types value (still never part of the *default*
  // no-flag run -- see DEFAULT_AUDIT_TYPES's own comment in auditTypes.ts).
  it("accepts security as an implemented type, alone or combined with code-rot", () => {
    expect(normalizeAuditConfig({ types: "security" }, toolRoot).types).toEqual(["security"]);
    expect(normalizeAuditConfig({ types: "code-rot,security" }, toolRoot).types).toEqual(["code-rot", "security"]);
    expect(normalizeAuditConfig({ types: "security,code-rot" }, toolRoot).types).toEqual(["code-rot", "security"]);
  });

  it("does not change the default (no --types flag) run away from code-rot only", () => {
    const config = normalizeAuditConfig({}, toolRoot);
    expect(config.types).toEqual(["code-rot"]);
  });

  it("rejects a genuinely unknown value distinctly from a planned one", () => {
    expect(() => normalizeAuditConfig({ types: "not-a-real-type" }, toolRoot)).toThrow(/Invalid --types value/);
    expect(() => normalizeAuditConfig({ types: "not-a-real-type" }, toolRoot)).not.toThrow(/planned but not implemented/i);
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

  // v0.4.2 Batch 3 -- --android alone (with no other flag) must also
  // disqualify isDefaultRun, matching every other flag above.
  it("isDefaultRun is false when only --android is supplied", () => {
    expect(normalizeAuditConfig({ types: "security", android: true }, toolRoot).isDefaultRun).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// v0.4.2 Batch 3 -- --android CLI opt-in. Defaults to false; requires
// --types to include "security"; rejects before any execution when it does
// not (normalizeAuditConfig throws synchronously, before runAudit() is ever
// called -- see scripts/audits/runAudit.ts's parse/normalize try/catch).
// ---------------------------------------------------------------------------

describe("normalizeAuditConfig — --android", () => {
  it("defaults to false when --android is not supplied", () => {
    expect(normalizeAuditConfig({}, toolRoot).android).toBe(false);
    expect(normalizeAuditConfig({ types: "security" }, toolRoot).android).toBe(false);
  });

  it("is true when --android is supplied together with --types security", () => {
    expect(normalizeAuditConfig({ types: "security", android: true }, toolRoot).android).toBe(true);
  });

  it("is true when --android is supplied together with --types code-rot,security", () => {
    expect(normalizeAuditConfig({ types: "code-rot,security", android: true }, toolRoot).android).toBe(true);
  });

  it("rejects --android without --types including security", () => {
    expect(() => normalizeAuditConfig({ android: true }, toolRoot)).toThrow(/--android requires --types to include "security"/);
    expect(() => normalizeAuditConfig({ types: "code-rot", android: true }, toolRoot)).toThrow(
      /--android requires --types to include "security"/
    );
  });

  it("does not require --android when --types already includes security", () => {
    // The inverse composition (security without --android) remains valid --
    // Batch 3 does not make Android integration mandatory for security runs.
    expect(() => normalizeAuditConfig({ types: "security" }, toolRoot)).not.toThrow();
  });
});
