import { describe, expect, it } from "vitest";
import { parseNpmPackDryRun } from "../../src/securityValidation/packageChecks/parseNpmPackDryRun.js";
import { detectForbiddenContents } from "../../src/securityValidation/packageChecks/forbiddenPackageContents.js";
import {
  detectMissingRequiredContents,
  REQUIRED_PACKAGE_CONTENTS,
} from "../../src/securityValidation/packageChecks/requiredPackageContents.js";
import { DEFAULT_SECURITY_CONFIG } from "../../src/securityValidation/config.js";
import {
  resolveNpmCommand,
  runSecurityCommand,
} from "../../src/securityValidation/commandRunner.js";

// ---------------------------------------------------------------------------
// parseNpmPackDryRun
// ---------------------------------------------------------------------------

describe("parseNpmPackDryRun — file list extraction", () => {
  it("returns an error for empty output", () => {
    const result = parseNpmPackDryRun("");
    expect(result.files).toHaveLength(0);
    expect(result.parseError).toBeTruthy();
  });

  it("parses a typical npm pack --dry-run text output", () => {
    const packOutput = [
      "npm notice ",
      "npm notice 📦  my-dev-kit-lab@0.1.0",
      "npm notice === Tarball Contents ===",
      "npm notice 1.2kB  README.md",
      "npm notice 4.5kB  dist/scripts/run-final-demo.js",
      "npm notice 2.1kB  docs/ARCHITECTURE.md",
      "npm notice === Tarball Details ===",
      "npm notice name:          my-dev-kit-lab",
      "npm notice version:       0.1.0",
      "npm notice total files:   3",
    ].join("\n");

    const result = parseNpmPackDryRun(packOutput);
    expect(result.parseError).toBeUndefined();
    expect(result.files).toContain("README.md");
    expect(result.files).toContain("dist/scripts/run-final-demo.js");
    expect(result.files).toContain("docs/ARCHITECTURE.md");
    expect(result.files).toHaveLength(3);
  });

  it("parses npm pack --dry-run output from newer npm notice formatting", () => {
    const packOutput = [
      "npm notice",
      "npm notice package: my-dev-kit-lab@0.1.2",
      "npm notice Tarball Contents",
      "npm notice 1.2kB README.md",
      "npm notice 4.5kB dist/scripts/run-final-demo.js",
      "npm notice Tarball Details",
      "npm notice name: my-dev-kit-lab",
      "npm notice version: 0.1.2",
    ].join("\n");

    const result = parseNpmPackDryRun(packOutput);
    expect(result.parseError).toBeUndefined();
    expect(result.files).toContain("README.md");
    expect(result.files).toContain("dist/scripts/run-final-demo.js");
    expect(result.files).toHaveLength(2);
  });

  it("strips 'package/' prefix from tarball paths", () => {
    // Some npm versions prefix paths with 'package/'
    const packOutput = [
      "npm notice === Tarball Contents ===",
      "npm notice 1.0kB  package/README.md",
      "npm notice 2.0kB  package/dist/index.js",
      "npm notice === Tarball Details ===",
    ].join("\n");

    // parseNpmPackDryRun returns raw paths; normalization is done in detectForbiddenContents
    const result = parseNpmPackDryRun(packOutput);
    expect(result.files.length).toBeGreaterThan(0);
  });

  it("returns a parseError when no files section is found", () => {
    const packOutput = "npm notice 📦  my-dev-kit-lab@0.1.0\nnpm notice total files: 0";
    const result = parseNpmPackDryRun(packOutput);
    expect(result.files).toHaveLength(0);
    expect(result.parseError).toBeTruthy();
  });
});

// ---------------------------------------------------------------------------
// detectForbiddenContents
// ---------------------------------------------------------------------------

describe("detectForbiddenContents — forbidden pattern matching", () => {
  const defaultPatterns = DEFAULT_SECURITY_CONFIG.forbiddenPackagePatterns;
  const noExceptions: string[] = [];

  it("returns no findings for a clean file list", () => {
    const files = [
      "README.md",
      "dist/scripts/run-final-demo.js",
      "docs/ARCHITECTURE.md",
      "docs/ROADMAP.md",
      "examples/token-savings-cases.json",
    ];
    const result = detectForbiddenContents({ files, forbiddenPatterns: defaultPatterns, allowedExceptions: noExceptions, checkId: "test" });
    expect(result.findings).toHaveLength(0);
    expect(result.matches).toHaveLength(0);
  });

  it("detects lab-output/ as a forbidden blocker", () => {
    const files = ["lab-output/final-demo/experiment-summary.json"];
    const result = detectForbiddenContents({ files, forbiddenPatterns: defaultPatterns, allowedExceptions: noExceptions, checkId: "test" });
    expect(result.matches.length).toBeGreaterThan(0);
    expect(result.findings.some((f) => f.severity === "blocker")).toBe(true);
  });

  it("detects .my-dev-kit/ as a forbidden blocker", () => {
    const files = [".my-dev-kit/manifest.json"];
    const result = detectForbiddenContents({ files, forbiddenPatterns: defaultPatterns, allowedExceptions: noExceptions, checkId: "test" });
    expect(result.matches.length).toBeGreaterThan(0);
    expect(result.findings.some((f) => f.severity === "blocker")).toBe(true);
  });

  it("detects .env files as a forbidden blocker", () => {
    const files = [".env", ".env.local", ".env.production"];
    const result = detectForbiddenContents({ files, forbiddenPatterns: defaultPatterns, allowedExceptions: noExceptions, checkId: "test" });
    expect(result.matches.length).toBeGreaterThan(0);
    expect(result.findings.some((f) => f.severity === "blocker")).toBe(true);
  });

  it("detects node_modules/ as a forbidden file", () => {
    const files = ["node_modules/typescript/package.json"];
    const result = detectForbiddenContents({ files, forbiddenPatterns: defaultPatterns, allowedExceptions: noExceptions, checkId: "test" });
    expect(result.matches.length).toBeGreaterThan(0);
  });

  it("detects Python bytecode caches as forbidden package content", () => {
    const files = [
      "benchmarks/projects/todo-python/src/__pycache__/task_service.cpython-314.pyc",
      "benchmarks/projects/todo-python/src/__pycache__/task_store.cpython-314.pyc",
    ];
    const result = detectForbiddenContents({ files, forbiddenPatterns: defaultPatterns, allowedExceptions: noExceptions, checkId: "test" });
    expect(result.matches.length).toBeGreaterThan(0);
    expect(result.findings.some((f) => f.severity === "major")).toBe(true);
  });

  it("detects private docs as a forbidden major finding", () => {
    const files = ["docs/FINAL_BATCH_HANDOFF.txt", "docs/coding_generation_guideline.md"];
    const result = detectForbiddenContents({ files, forbiddenPatterns: defaultPatterns, allowedExceptions: noExceptions, checkId: "test" });
    expect(result.matches.length).toBeGreaterThan(0);
  });

  it("respects allowed exceptions", () => {
    const files = ["reports/security/raw/npm-audit.stdout.txt"];
    const exceptions = ["reports/security/raw/"];
    const result = detectForbiddenContents({ files, forbiddenPatterns: defaultPatterns, allowedExceptions: exceptions, checkId: "test" });
    expect(result.matches).toHaveLength(0);
  });

  it("handles Windows backslash paths in tarball file list", () => {
    const files = ["lab-output\\final-demo\\report.html"];
    const result = detectForbiddenContents({ files, forbiddenPatterns: defaultPatterns, allowedExceptions: noExceptions, checkId: "test" });
    // After normalization, backslashes become forward slashes
    expect(result.matches.length).toBeGreaterThan(0);
  });

  it("strips package/ prefix before matching", () => {
    const files = ["package/lab-output/final-demo/experiment-summary.json"];
    const result = detectForbiddenContents({ files, forbiddenPatterns: defaultPatterns, allowedExceptions: noExceptions, checkId: "test" });
    expect(result.matches.length).toBeGreaterThan(0);
  });

  it("generates unique finding ids for multiple forbidden files", () => {
    const files = ["lab-output/a.json", ".my-dev-kit/manifest.json", ".env"];
    const result = detectForbiddenContents({ files, forbiddenPatterns: defaultPatterns, allowedExceptions: noExceptions, checkId: "test" });
    const ids = result.findings.map((f) => f.id);
    const uniqueIds = new Set(ids);
    expect(uniqueIds.size).toBe(ids.length);
  });
});

describe("required npm package contents", () => {
  it("reports missing required paths in deterministic order", () => {
    const result = detectMissingRequiredContents({
      files: ["package/package.json", "package/README.md"],
      requiredFiles: ["README.md", "CHANGELOG.md", "package.json"],
      checkId: "test",
    });

    expect(result.missing).toEqual(["CHANGELOG.md"]);
    expect(result.findings[0]?.title).toBe(
      "Required file missing from npm tarball: package/CHANGELOG.md",
    );
  });

  it("validates the actual npm dry-run inventory", async () => {
    const command = await runSecurityCommand({
      command: resolveNpmCommand(),
      args: ["pack", "--json", "--dry-run"],
      cwd: process.cwd(),
      timeoutMs: 30_000,
    });

    expect(command.exitCode, command.stderr).toBe(0);
    // The production parser understands the npm 11 array and the npm 12 keyed-object shapes; an
    // unrecognized shape is a parse error here instead of an empty (vacuously passing) file list.
    const parsed = parseNpmPackDryRun(command.stdout);
    expect(parsed.parseError).toBeUndefined();
    expect(parsed.files.length).toBeGreaterThan(0);
    const files = parsed.files.map((file) => file.slice("package/".length));
    const required = detectMissingRequiredContents({
      files,
      requiredFiles: REQUIRED_PACKAGE_CONTENTS,
      checkId: "actual-npm-pack",
    });
    const forbidden = detectForbiddenContents({
      files,
      forbiddenPatterns: DEFAULT_SECURITY_CONFIG.forbiddenPackagePatterns,
      allowedExceptions: DEFAULT_SECURITY_CONFIG.allowedPackageExceptions,
      checkId: "actual-npm-pack",
    });

    expect(
      required.missing,
      `Missing required npm package files: ${required.missing.map((file) => `package/${file}`).join(", ")}`,
    ).toEqual([]);
    expect(forbidden.matches).toEqual([]);
  });

  // v0.4.6 Batch 6 -- package-content reconciliation. These paths were
  // developer/test-only (no supported installed command reads them; see
  // package.json's "files" allowlist and its accompanying comment history)
  // and were removed from the npm files allowlist in this batch. This
  // guards against a future change accidentally re-broadening the
  // allowlist back to shipping them.
  it("does not re-include developer/test-only content removed from the package surface", async () => {
    const command = await runSecurityCommand({
      command: resolveNpmCommand(),
      args: ["pack", "--json", "--dry-run"],
      cwd: process.cwd(),
      timeoutMs: 30_000,
    });

    expect(command.exitCode, command.stderr).toBe(0);
    // The production parser understands the npm 11 array and the npm 12 keyed-object shapes; an
    // unrecognized shape is a parse error here instead of an empty (vacuously passing) file list.
    const parsed = parseNpmPackDryRun(command.stdout);
    expect(parsed.parseError).toBeUndefined();
    expect(parsed.files.length).toBeGreaterThan(0);
    const files = parsed.files.map((file) => file.slice("package/".length));

    const stillPresent = files.filter((file) =>
      [
        "tests/fixtures/",
        "dist/scripts/audits/",
        "dist/scripts/experiments/",
        "dist/scripts/security/",
        "dist/scripts/verify-packed-package",
        "dist/scripts/verifyPackedPackageHelpers",
        "examples/demo-report-input.json",
        "examples/lab-demo-cases.json",
        "examples/real-agent-campaign-cases.json",
      ].some((prefix) => file.startsWith(prefix)),
    );

    expect(stillPresent).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// parseNpmPackDryRun -- npm 11 and npm 12 JSON inventories (v0.9.4)
//
// `npm pack --dry-run --json` prints an array with one package object on npm 11 and earlier, and
// one object keyed by package identity on npm 12. REAL_PACKAGE is the package body npm printed for the
// my-dev-kit 1.14.0 candidate (identical under both versions; the files list is trimmed to six real
// entries). The two wrappers below are exactly the two shapes captured from npm 11.19.0 and 12.2.0.
// ---------------------------------------------------------------------------
const REAL_PACKAGE = {
  id: "@dailephd/my-dev-kit@1.13.0",
  name: "@dailephd/my-dev-kit",
  version: "1.13.0",
  size: 818375,
  unpackedSize: 4554589,
  shasum: "29169e6a862ccfddb0a1e0faca3a1a91093e78ae",
  integrity: "sha512-rJywT/5C64vdrJOQXkk4cqz+OZq8yjy+AZieiMutbpgCwZF5ywaJArZZncEJ6ZGRe7ZI4KwYnVBAtux1WQFECQ==",
  filename: "dailephd-my-dev-kit-1.13.0.tgz",
  files: [
    { path: "LICENSE", size: 1069, mode: 420 },
    { path: "README.md", size: 47697, mode: 420 },
    { path: "dist/assets/tree-sitter-rust-orchard.wasm", size: 2014566, mode: 420 },
    { path: "dist/cli.js", size: 1485271, mode: 420 },
    { path: "examples/basic-rust-workspace/crates/core/tests/worker_tests.rs", size: 129, mode: 420 },
    { path: "package.json", size: 3270, mode: 420 },
  ],
  entryCount: 60,
  bundled: [],
};
const EXPECTED_PACKAGE_FILES = REAL_PACKAGE.files.map((file) => `package/${file.path}`);
const NPM11_SHAPE = JSON.stringify([REAL_PACKAGE], null, 2);
const NPM12_SHAPE = JSON.stringify({ "@dailephd/my-dev-kit": REAL_PACKAGE }, null, 2);
const withFiles = (files: unknown) => ({ ...REAL_PACKAGE, files });

describe("parseNpmPackDryRun -- npm 11 and npm 12 JSON inventories", () => {
  it.each([
    ["npm 11 (array of one package)", NPM11_SHAPE],
    ["npm 12 (object keyed by package identity)", NPM12_SHAPE],
  ])("reads the real %s shape with archive-root paths", (_label, output) => {
    expect(parseNpmPackDryRun(output)).toEqual({ files: EXPECTED_PACKAGE_FILES });
  });

  it("gives identical results for both shapes, so detection cannot depend on the npm version", () => {
    const forbidden = (output: string) =>
      detectForbiddenContents({
        files: parseNpmPackDryRun(output).files,
        forbiddenPatterns: DEFAULT_SECURITY_CONFIG.forbiddenPackagePatterns,
        allowedExceptions: DEFAULT_SECURITY_CONFIG.allowedPackageExceptions,
        checkId: "shape",
      });
    expect(parseNpmPackDryRun(NPM11_SHAPE)).toEqual(parseNpmPackDryRun(NPM12_SHAPE));
    expect(forbidden(NPM11_SHAPE)).toEqual(forbidden(NPM12_SHAPE));
    expect(forbidden(NPM12_SHAPE).matches).toEqual([]);
  });

  it("does not broaden the private-content policy: the same forbidden files are found in either shape", () => {
    const poisoned = withFiles([...REAL_PACKAGE.files, { path: "lab-output/run/report.json", size: 1, mode: 420 }, { path: ".env", size: 1, mode: 420 }]);
    for (const output of [JSON.stringify([poisoned]), JSON.stringify({ "@dailephd/my-dev-kit": poisoned })]) {
      const parsed = parseNpmPackDryRun(output);
      const result = detectForbiddenContents({
        files: parsed.files,
        forbiddenPatterns: DEFAULT_SECURITY_CONFIG.forbiddenPackagePatterns,
        allowedExceptions: DEFAULT_SECURITY_CONFIG.allowedPackageExceptions,
        checkId: "shape",
      });
      expect(result.matches.map((match) => match.file)).toEqual(["lab-output/run/report.json", ".env"]);
    }
    expect(DEFAULT_SECURITY_CONFIG.allowedPackageExceptions).toEqual([]);
  });

  it("normalizes package-relative paths and adds the archive root exactly once", () => {
    const output = JSON.stringify({ "pkg": withFiles([{ path: "./README.md" }, { path: "dist\\cli.js" }, { path: "package/index.js" }, { path: "././lib/a.js" }]) });
    expect(parseNpmPackDryRun(output).files).toEqual(["package/README.md", "package/dist/cli.js", "package/package/index.js", "package/lib/a.js"]);
  });

  const MALFORMED = "npm pack JSON must contain exactly one nonempty package inventory";
  it.each([
    ["an empty array", "[]"],
    ["an empty object", "{}"],
    ["two packages in an array", JSON.stringify([REAL_PACKAGE, REAL_PACKAGE])],
    ["two packages in a keyed object", JSON.stringify({ a: REAL_PACKAGE, b: REAL_PACKAGE })],
    ["a bare package object that is not wrapped", JSON.stringify(REAL_PACKAGE)],
    ["a keyed object holding a non-object", JSON.stringify({ a: 1 })],
    ["a keyed object holding an array", JSON.stringify({ a: [REAL_PACKAGE] })],
    ["a keyed object mixing a package with a scalar", JSON.stringify({ a: REAL_PACKAGE, b: "x" })],
    ["an array of a scalar", "[1]"],
    ["an array of null", "[null]"],
    ["an empty files list", JSON.stringify({ a: withFiles([]) })],
    ["a missing files list", JSON.stringify([{ ...REAL_PACKAGE, files: undefined }])],
    ["a non-array files value", JSON.stringify({ a: withFiles({ path: "README.md" }) })],
    ["a null package", JSON.stringify({ a: null })],
  ])("rejects %s without treating it as an empty successful package", (_label, output) => {
    expect(parseNpmPackDryRun(output)).toEqual({ files: [], parseError: MALFORMED });
  });

  it.each([
    ["truncated JSON", NPM12_SHAPE.slice(0, 80)],
    ["trailing text after the JSON", `${NPM12_SHAPE}\nnpm notice done`],
    ["unterminated string", '{"a":{"files":[{"path":"x}]}}'],
  ])("reports %s as unparseable", (_label, output) => {
    expect(parseNpmPackDryRun(output)).toEqual({ files: [], parseError: "npm pack JSON is unparseable" });
  });

  it.each([
    ["traversal", "../outside.js"],
    ["embedded traversal", "dist/../../outside.js"],
    ["an absolute POSIX path", "/etc/passwd"],
    ["a Windows drive path", "C:\\Windows\\system.ini"],
    ["a UNC-style path", "\\\\server\\share\\x"],
    ["an empty segment", "dist//cli.js"],
    ["a dot segment", "dist/./cli.js"],
    ["a control character", "dist/cli\u0000.js"],
    ["a newline", "dist/cli\n.js"],
    ["an empty path", ""],
    ["only a dot", "."],
  ])("rejects an unsafe path (%s) in either shape", (_label, unsafe) => {
    const hostile = withFiles([...REAL_PACKAGE.files, { path: unsafe }]);
    for (const output of [JSON.stringify([hostile]), JSON.stringify({ "@dailephd/my-dev-kit": hostile })]) {
      expect(parseNpmPackDryRun(output)).toEqual({ files: [], parseError: "npm pack JSON contains a malformed or unsafe file path" });
    }
  });

  it.each([
    ["a missing path", { size: 1 }],
    ["a numeric path", { path: 7 }],
    ["a null path", { path: null }],
    ["a null entry", null],
    ["a scalar entry", "README.md"],
  ])("rejects a malformed file entry (%s)", (_label, entry) => {
    for (const hostile of [[withFiles([...REAL_PACKAGE.files, entry])], { x: withFiles([...REAL_PACKAGE.files, entry]) }]) {
      expect(parseNpmPackDryRun(JSON.stringify(hostile))).toEqual({
        files: [],
        parseError: "npm pack JSON contains a malformed or unsafe file path",
      });
    }
  });

  it("does not let a hostile key pollute prototypes or change the result", () => {
    const hostile = '{"__proto__":{"polluted":true,"files":[{"path":"README.md"}]}}';
    const parsed = parseNpmPackDryRun(hostile);
    expect(({} as Record<string, unknown>).polluted).toBeUndefined();
    expect(parsed).toEqual({ files: ["package/README.md"] });
  });

  it("still parses the human-readable text form and the empty-output error", () => {
    expect(parseNpmPackDryRun("npm notice === Tarball Contents ===\nnpm notice 1.2kB README.md\nnpm notice === Tarball Details ===\n").files).toEqual(["README.md"]);
    expect(parseNpmPackDryRun("")).toEqual({ files: [], parseError: "npm pack --dry-run produced no output" });
  });
});
