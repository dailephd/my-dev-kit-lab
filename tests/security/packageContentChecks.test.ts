import { describe, expect, it } from "vitest";
import { parseNpmPackDryRun } from "../../src/securityValidation/packageChecks/parseNpmPackDryRun.js";
import { detectForbiddenContents } from "../../src/securityValidation/packageChecks/forbiddenPackageContents.js";
import { DEFAULT_SECURITY_CONFIG } from "../../src/securityValidation/config.js";

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
