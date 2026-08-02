import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { DEFAULT_SECURITY_CONFIG } from "../../src/securityValidation/config.js";
import {
  buildPackageContentPolicy,
  LAB_SELF_REQUIRED_PACKAGE_CONTENTS,
  type PackagePolicyTarget,
} from "../../src/securityValidation/packageChecks/packageContentPolicy.js";
import { detectMissingRequiredContents } from "../../src/securityValidation/packageChecks/requiredPackageContents.js";
import { runPackageChecks } from "../../src/securityValidation/packageChecks/runPackageChecks.js";

const roots: string[] = [];

afterEach(() => {
  for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true });
});

function fixture(packageJson: Record<string, unknown>, files: Record<string, string>): {
  root: string;
  target: PackagePolicyTarget;
} {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "lab-external-package-policy-"));
  roots.push(root);
  fs.writeFileSync(path.join(root, "package.json"), `${JSON.stringify(packageJson, null, 2)}\n`);
  for (const [relative, contents] of Object.entries(files)) {
    const destination = path.join(root, ...relative.split("/"));
    fs.mkdirSync(path.dirname(destination), { recursive: true });
    fs.writeFileSync(destination, contents);
  }
  return {
    root,
    target: {
      targetRoot: root,
      packageName: typeof packageJson.name === "string" ? packageJson.name : null,
      packageVersion: typeof packageJson.version === "string" ? packageJson.version : null,
      isSelf: false,
    },
  };
}

function evaluate(
  packageJson: Record<string, unknown>,
  packedFiles: string[],
  sourceFiles: Record<string, string> = {},
) {
  const { target } = fixture(packageJson, sourceFiles);
  const policy = buildPackageContentPolicy({ target, packedFiles, checkId: "test" });
  const missing = detectMissingRequiredContents({
    files: packedFiles,
    requirements: policy.requirements,
    checkId: "test",
  });
  return { policy, missing };
}

describe("target-aware package content policy", () => {
  it("keeps the strict lab self-package contract", () => {
    const target: PackagePolicyTarget = {
      targetRoot: process.cwd(),
      packageName: "@dailephd/my-dev-kit-lab",
      packageVersion: "0.4.5",
      isSelf: true,
    };
    const policy = buildPackageContentPolicy({ target, packedFiles: ["package.json"], checkId: "self" });
    const missing = detectMissingRequiredContents({ files: ["package.json"], requirements: policy.requirements, checkId: "self" });

    expect(policy.mode).toBe("self");
    expect(policy.requirements.map((item) => item.expectedPath)).toEqual([...LAB_SELF_REQUIRED_PACKAGE_CONTENTS]);
    expect(missing.missing.map((item) => item.expectedPath)).toContain("dist/scripts/run-final-demo.js");
    expect(missing.missing.map((item) => item.expectedPath)).toContain("dist/src/index.js");
  });

  it("accepts an external CLI contract without lab-specific runtime files", () => {
    const result = evaluate(
      {
        name: "@example/tool",
        version: "1.2.3",
        bin: { "example-tool": "dist/cli.js" },
        files: ["dist", "README.md", "LICENSE"],
      },
      ["package.json", "dist/cli.js", "README.md", "LICENSE"],
      { "dist/cli.js": "#!/usr/bin/env node\n", "README.md": "readme", LICENSE: "license" },
    );

    expect(result.policy.mode).toBe("external");
    expect(result.policy.source).toContain("external target package.json");
    expect(result.policy.requirements.map((item) => item.expectedPath)).toContain("dist/cli.js");
    expect(result.policy.requirements.map((item) => item.expectedPath)).not.toContain("dist/src/index.js");
    expect(result.missing.findings).toEqual([]);
  });

  it.each([
    ["missing bin", { bin: { tool: "dist/cli.js" } }, ["package.json"]],
    ["wrong bin path", { bin: { tool: "dist/wrong.js" } }, ["package.json", "dist/cli.js"]],
    ["bin string", { bin: "dist/cli.js" }, ["package.json"]],
  ])("blocks a declared external entrypoint: %s", (_label, metadata, packedFiles) => {
    const result = evaluate({ name: "example-tool", version: "1.0.0", ...metadata }, packedFiles);
    expect(result.missing.findings).toHaveLength(1);
    expect(result.missing.findings[0]?.severity).toBe("blocker");
  });

  it("supports library entrypoints and nested conditional exports without requiring a CLI", () => {
    const packageJson = {
      name: "@example/library",
      version: "2.0.0",
      main: "dist/index.cjs",
      module: "dist/index.js",
      types: "dist/index.d.ts",
      typings: "dist/compat.d.ts",
      exports: {
        ".": { import: "./dist/index.js", require: "./dist/index.cjs", types: "./dist/index.d.ts" },
        "./feature": { node: { import: "./dist/feature.js" } },
      },
    };
    const files = ["package.json", "dist/index.cjs", "dist/index.js", "dist/index.d.ts", "dist/compat.d.ts", "dist/feature.js"];
    const result = evaluate(packageJson, files);
    expect(result.missing.findings).toEqual([]);

    for (const missingPath of files.slice(1)) {
      const missing = evaluate(packageJson, files.filter((file) => file !== missingPath));
      expect(missing.missing.findings.some((finding) => finding.affectedFiles?.includes(missingPath))).toBe(true);
    }
  });

  it("normalizes Windows separators, deduplicates equivalent paths, and orders requirements deterministically", () => {
    const result = evaluate(
      {
        name: "example-tool",
        version: "1.0.0",
        main: ".\\dist\\index.js",
        exports: { ".": "./dist/index.js" },
      },
      ["package.json", "dist/index.js"],
    );
    expect(result.missing.findings).toEqual([]);
    expect(result.policy.requirements.map((item) => `${item.expectedPath}:${item.declaringMetadataField}`)).toEqual([
      "dist/index.js:package.json#exports..",
      "dist/index.js:package.json#main",
      "package.json:npm universal package metadata",
    ]);
  });

  it.each([
    ["absolute", { main: "C:\\outside\\index.js" }],
    ["escaping", { main: "../outside.js" }],
    ["malformed", { exports: { ".": 42 } }],
  ])("fails closed for %s entrypoint metadata", (_label, metadata) => {
    const result = evaluate({ name: "example", version: "1.0.0", ...metadata }, ["package.json"]);
    expect(result.policy.findings.some((finding) => finding.severity === "blocker")).toBe(true);
  });

  it("treats files entries as inclusion policy for files, directories, globs, and exclusions", () => {
    const result = evaluate(
      {
        name: "example",
        version: "1.0.0",
        files: ["NOTICE", "dist", "docs/*.md", "!docs/private.md"],
      },
      ["package.json", "NOTICE", "dist/index.js", "docs/public.md"],
      { NOTICE: "notice", "dist/index.js": "code", "docs/public.md": "public" },
    );
    expect(result.missing.findings).toEqual([]);
    expect(result.policy.findings).toEqual([
      expect.objectContaining({ severity: "informational", packagePolicy: expect.objectContaining({ declaringMetadataField: "package.json#files[3]" }) }),
    ]);
  });

  it("reports malformed files metadata without guessing", () => {
    const malformed = evaluate({ name: "example", version: "1.0.0", files: "dist" }, ["package.json"]);
    expect(malformed.policy.findings[0]).toEqual(expect.objectContaining({ severity: "major" }));
    const unsupported = evaluate({ name: "example", version: "1.0.0", files: [42] }, ["package.json"]);
    expect(unsupported.policy.findings[0]).toEqual(expect.objectContaining({ severity: "informational" }));
  });

  it("rejects invalid package identity and reports unsupported globs explicitly", () => {
    const result = evaluate(
      { name: "Invalid Package Name", version: "latest", files: ["dist/[a-z].js"] },
      ["package.json", "dist/a.js"],
    );
    expect(result.policy.findings.filter((finding) => finding.severity === "blocker")).toHaveLength(2);
    expect(result.policy.findings).toContainEqual(expect.objectContaining({
      id: "test-external-files-glob-unsupported-0",
      severity: "informational",
    }));
  });

  it("rejects absolute and escaping paths from the generated packed inventory", () => {
    const result = evaluate(
      { name: "example", version: "1.0.0" },
      ["package.json", "package/C:/outside.txt", "package/../../escape.txt"],
    );
    expect(result.policy.findings.filter((finding) => finding.id.includes("packed-path-unsafe"))).toHaveLength(2);
  });

  it("runs external npm inventory read-only and writes reports only outside the target", async () => {
    const { root, target } = fixture(
      { name: "@example/tool", version: "1.2.3", bin: { tool: "dist/cli.js" }, files: ["dist"] },
      { "dist/cli.js": "#!/usr/bin/env node\nconsole.log('ok');\n" },
    );
    const reportRoot = fs.mkdtempSync(path.join(os.tmpdir(), "lab-external-package-reports-"));
    roots.push(reportRoot);
    const beforePackage = fs.readFileSync(path.join(root, "package.json"), "utf8");
    const beforeFiles = fs.readdirSync(root).sort();
    const config = {
      ...DEFAULT_SECURITY_CONFIG,
      reportDir: path.join(reportRoot, "checks"),
      rawOutputDir: path.join(reportRoot, "raw"),
    };

    const output = await runPackageChecks({ cwd: root, config, target });

    expect(output.checks[0]?.status).toBe("passed");
    expect(output.checks[0]?.packagePolicy).toEqual(expect.objectContaining({
      mode: "external",
      source: "external target package.json and npm pack inventory",
      packageName: "@example/tool",
      packageVersion: "1.2.3",
      packedFileCount: 2,
      requiredPaths: expect.arrayContaining([
        { expectedPath: "dist/cli.js", declaringMetadataField: "package.json#bin.tool" },
      ]),
    }));
    expect(output.findings).toEqual([]);
    expect(fs.readFileSync(path.join(root, "package.json"), "utf8")).toBe(beforePackage);
    expect(fs.readdirSync(root).sort()).toEqual(beforeFiles);
    expect(fs.readdirSync(root).some((file) => file.endsWith(".tgz"))).toBe(false);
    expect(fs.existsSync(path.join(reportRoot, "checks", "npm-pack-dry-run.json"))).toBe(true);
  });
});
