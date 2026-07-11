import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  parseSecurityValidateArgs,
  normalizeSecurityValidateConfig,
  DEFAULT_SECURITY_CHECKS,
  DEFAULT_SECURITY_PROFILE,
  DEFAULT_SECURITY_OUTPUT_FORMATS,
  DEFAULT_SECURITY_FAIL_ON_THRESHOLD,
} from "../../src/securityValidation/validate/cliOptions.js";

const toolRoot = path.resolve("/tmp/tool-root");

describe("parseSecurityValidateArgs", () => {
  it("returns empty object when no flags are provided", () => {
    expect(parseSecurityValidateArgs([])).toEqual({});
  });

  it("preserves --target and -t behavior", () => {
    expect(parseSecurityValidateArgs(["--target", "../other"])).toEqual({ target: "../other" });
    expect(parseSecurityValidateArgs(["-t", "../other"])).toEqual({ target: "../other" });
  });

  it("parses --checks, --profile, --format, --fail-on, --out together", () => {
    const result = parseSecurityValidateArgs([
      "--checks",
      "deps,package",
      "--profile",
      "local-tool",
      "--format",
      "json",
      "--fail-on",
      "high",
      "--out",
      "some/dir",
    ]);
    expect(result).toEqual({
      checks: "deps,package",
      profile: "local-tool",
      format: "json",
      failOn: "high",
      out: "some/dir",
    });
  });

  it("fails cleanly when a flag is missing its value", () => {
    expect(() => parseSecurityValidateArgs(["--checks"])).toThrow(/Missing value/);
    expect(() => parseSecurityValidateArgs(["--target"])).toThrow(/Missing value/);
  });

  it("rejects unknown top-level options without consuming a following value", () => {
    expect(() => parseSecurityValidateArgs(["--definitely-unknown-option", "value", "--profile", "android"])).toThrow(
      /Unknown option: --definitely-unknown-option/
    );
  });

  it("continues to accept values beginning with a dash for known options", () => {
    expect(parseSecurityValidateArgs(["--out", "-reports"])).toEqual({ out: "-reports" });
  });

  it("keeps a conventional argument separator harmless", () => {
    expect(parseSecurityValidateArgs(["--", "--profile", "android"])).toEqual({ profile: "android" });
  });
});

describe("normalizeSecurityValidateConfig — no flags (backward compatibility)", () => {
  it("defaults checks to all implemented groups", () => {
    const config = normalizeSecurityValidateConfig({}, toolRoot);
    expect(config.checks).toEqual([...DEFAULT_SECURITY_CHECKS]);
    expect(config.checksWereDefault).toBe(true);
    expect(config.plannedChecksRequested).toEqual([]);
  });

  it("defaults profile, format, and fail-on", () => {
    const config = normalizeSecurityValidateConfig({}, toolRoot);
    expect(config.profile).toBe(DEFAULT_SECURITY_PROFILE);
    expect(config.formats).toEqual([...DEFAULT_SECURITY_OUTPUT_FORMATS]);
    expect(config.failOnThreshold).toBe(DEFAULT_SECURITY_FAIL_ON_THRESHOLD);
  });

  it("defaults out to reports/security under toolRoot", () => {
    const config = normalizeSecurityValidateConfig({}, toolRoot);
    expect(config.out).toBe(path.join(toolRoot, "reports", "security"));
    expect(config.outWasDefault).toBe(true);
  });
});

describe("--checks", () => {
  it("accepts a single value", () => {
    const config = normalizeSecurityValidateConfig({ checks: "deps" }, toolRoot);
    expect(config.checks).toEqual(["deps"]);
    expect(config.implementedChecks).toEqual(["deps"]);
  });

  it("accepts multiple comma-separated values and normalizes whitespace", () => {
    const config = normalizeSecurityValidateConfig({ checks: " deps , package ,fuzz" }, toolRoot);
    expect(config.checks).toEqual(["deps", "package", "fuzz"]);
  });

  it("orders checks canonically regardless of input order", () => {
    const config = normalizeSecurityValidateConfig({ checks: "fuzz,deps" }, toolRoot);
    expect(config.checks).toEqual(["deps", "fuzz"]);
  });

  it("separates implemented vs planned-but-unavailable checks", () => {
    const config = normalizeSecurityValidateConfig(
      { checks: "deps,package,static,cli-adversarial,fuzz,boundary,subprocess,secrets,network" },
      toolRoot
    );
    expect(config.implementedChecks).toEqual(["deps", "package", "static", "cli-adversarial", "fuzz"]);
    expect(config.plannedChecksRequested).toEqual(["boundary", "subprocess", "secrets", "network"]);
  });

  it("rejects unknown values", () => {
    expect(() => normalizeSecurityValidateConfig({ checks: "deps,bogus" }, toolRoot)).toThrow(/Invalid --checks/);
  });

  it("rejects empty entries", () => {
    expect(() => normalizeSecurityValidateConfig({ checks: "deps,,package" }, toolRoot)).toThrow(
      /Invalid --checks/
    );
    expect(() => normalizeSecurityValidateConfig({ checks: "" }, toolRoot)).toThrow(/Invalid --checks/);
  });
});

describe("--profile", () => {
  for (const profile of ["node-cli-package", "local-tool", "npm-package"] as const) {
    it(`accepts ${profile}`, () => {
      const config = normalizeSecurityValidateConfig({ profile }, toolRoot);
      expect(config.profile).toBe(profile);
      expect(config.profileWasDefault).toBe(false);
    });
  }

  it("rejects unknown values", () => {
    expect(() => normalizeSecurityValidateConfig({ profile: "web-app" }, toolRoot)).toThrow(/Invalid --profile/);
  });
});

describe("--format", () => {
  it("accepts text", () => {
    const config = normalizeSecurityValidateConfig({ format: "text" }, toolRoot);
    expect(config.formats).toEqual(["text"]);
  });

  it("accepts json", () => {
    const config = normalizeSecurityValidateConfig({ format: "json" }, toolRoot);
    expect(config.formats).toEqual(["json"]);
  });

  it("accepts text,json and json,text identically ordered", () => {
    expect(normalizeSecurityValidateConfig({ format: "text,json" }, toolRoot).formats).toEqual(["text", "json"]);
    expect(normalizeSecurityValidateConfig({ format: "json,text" }, toolRoot).formats).toEqual(["text", "json"]);
  });

  it("rejects unknown values", () => {
    expect(() => normalizeSecurityValidateConfig({ format: "yaml" }, toolRoot)).toThrow(/Invalid --format/);
  });
});

describe("--fail-on", () => {
  for (const failOn of ["blocker", "high", "medium", "low"] as const) {
    it(`accepts ${failOn}`, () => {
      const config = normalizeSecurityValidateConfig({ failOn }, toolRoot);
      expect(config.failOnThreshold).toBe(failOn);
      expect(config.failOnWasDefault).toBe(false);
    });
  }

  it("rejects unknown values", () => {
    expect(() => normalizeSecurityValidateConfig({ failOn: "critical" }, toolRoot)).toThrow(/Invalid --fail-on/);
  });
});

describe("--out", () => {
  it("accepts a relative path and resolves it", () => {
    const config = normalizeSecurityValidateConfig({ out: "custom-reports" }, toolRoot);
    expect(config.out).toBe(path.resolve("custom-reports"));
    expect(config.outWasDefault).toBe(false);
  });

  it("accepts an absolute path", () => {
    const abs = path.resolve(toolRoot, "abs-reports");
    const config = normalizeSecurityValidateConfig({ out: abs }, toolRoot);
    expect(config.out).toBe(abs);
  });

  it("accepts a Windows-style path with spaces", () => {
    const withSpaces = path.join(toolRoot, "report output", "dir with spaces");
    const config = normalizeSecurityValidateConfig({ out: withSpaces }, toolRoot);
    expect(config.out).toBe(path.resolve(withSpaces));
  });

  it("rejects an empty value", () => {
    expect(() => normalizeSecurityValidateConfig({ out: "   " }, toolRoot)).toThrow(/Invalid --out/);
  });
});
