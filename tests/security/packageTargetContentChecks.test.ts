import fs from "node:fs/promises";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { afterEach, describe, expect, it, vi } from "vitest";
import * as commands from "../../src/securityValidation/commandRunner.js";
import { runPackageChecks } from "../../src/securityValidation/packageChecks/runPackageChecks.js";
import { detectMissingRequiredContents, requiredContentsForTarget, REQUIRED_PACKAGE_CONTENTS } from "../../src/securityValidation/packageChecks/requiredPackageContents.js";
import { resolveValidationTarget } from "../../src/securityValidation/validate/resolveTarget.js";
import { DEFAULT_SECURITY_CONFIG } from "../../src/securityValidation/config.js";
import { calculateVerdict } from "../../src/securityValidation/validate/verdict.js";
import type { CommandExecutionResult } from "../../src/securityValidation/types.js";
import { runSecurityValidation } from "../../src/securityValidation/validate/runSecurityValidation.js";
import { buildSecurityReportFromSummary } from "../../src/securityValidation/report/buildSecurityReport.js";
import { renderJsonReport } from "../../src/securityValidation/report/renderSecurityReport.js";

const toolRoot = process.cwd();
async function fixture(metadata: unknown = { name: "external-cli", version: "1.0.0", bin: "./dist/cli.js" }) {
  const tmp = path.join(toolRoot, "tmp", "package-security");
  await fs.mkdir(tmp, { recursive: true });
  const root = await fs.mkdtemp(path.join(tmp, "target-"));
  await fs.writeFile(path.join(root, "package.json"), JSON.stringify(metadata));
  const target = resolveValidationTarget(root, toolRoot);
  const reportDir = path.join(toolRoot, "reports", "package-regressions", path.basename(root));
  const config = { ...DEFAULT_SECURITY_CONFIG, reportDir, rawOutputDir: path.join(reportDir, "raw") };
  return { root, target, config };
}
function inventory(files: string[], overrides: Partial<CommandExecutionResult> = {}) {
  vi.spyOn(commands, "runSecurityCommand").mockResolvedValue({
    command: "npm", args: [], cwd: "", exitCode: 0, durationMs: 1,
    stdout: JSON.stringify([{ files: files.map((file) => ({ path: file })) }]),
    stderr: "", timedOut: false, skipped: false, ...overrides,
  });
}
async function check(f: Awaited<ReturnType<typeof fixture>>) {
  return runPackageChecks({ cwd: f.root, target: f.target, config: f.config });
}
afterEach(() => vi.restoreAllMocks());

describe("resolved target package contract", () => {
  it("LAB-PKG-14 reconciles all nine inherited Lab paths without suppressing external missing entrypoints", async () => {
    const files = ["package.json", "README.md", "LICENSE", "CHANGELOG.md", "dist/cli.js", "dist/index.js"];
    expect(detectMissingRequiredContents({ files, checkId: "inherited" }).missing).toEqual([
      "benchmarks/contracts/benchmark-project-profiles.json", "dist/scripts/cli.js", "dist/scripts/run-final-demo.js",
      "dist/src/cli/runLabCli.js", "dist/src/index.js", "dist/src/runtime/labExecutionContext.js",
      "dist/src/runtime/packageResource.js", "dist/src/runtime/packageRoot.js", "examples/token-savings-cases.json",
    ]);
    const f = await fixture({ bin: { cli: "dist/cli.js" }, main: "dist/index.js" });
    inventory(files);
    expect((await check(f)).findings).toEqual([]);
    vi.restoreAllMocks();
    inventory(files.filter((file) => file !== "dist/cli.js"));
    expect((await check(f)).findings.map((finding) => finding.title)).toEqual(["Required file missing from npm tarball: package/dist/cli.js"]);
  });
  it("LAB-PKG-01/13 retains every self requirement and every missing-file blocker", async () => {
    const f = await fixture();
    f.target = resolveValidationTarget(undefined, f.root);
    const policy = await requiredContentsForTarget(f.target);
    expect([...policy.requiredFiles].sort()).toEqual([...REQUIRED_PACKAGE_CONTENTS].sort());
    inventory(["package.json"]);
    const result = await check(f);
    expect(result.findings.filter((finding) => finding.id.includes("required-missing")).flatMap((finding) => finding.affectedFiles).sort())
      .toEqual(REQUIRED_PACKAGE_CONTENTS.filter((file) => file !== "package.json").sort());
    expect(result.findings.every((finding) => finding.severity === "blocker")).toBe(true);
  });

  it.each([
    { bin: "./dist/cli.js" },
    { bin: { first: "dist/cli.js", second: "./dist/other.js" }, main: "dist/index.js" },
    { name: "@dailephd/my-dev-kit-lab", bin: "dist/cli.js", main: "dist/index.js" },
    { exports: { ".": "./dist/index.js", "./extra": "./dist/other.js", "./private": null } },
    { exports: "./dist/index.js" },
  ])("LAB-PKG-02/05/06/14 accepts external contracts without Lab resources: %j", async (metadata) => {
    const f = await fixture(metadata);
    inventory(["package.json", "dist/cli.js", "dist/index.js", "dist/other.js"]);
    const result = await check(f);
    expect(result.checks[0].status).toBe("passed");
    expect(result.findings).toEqual([]);
    expect(f.target.isSelf).toBe(false);
  });

  it.each([
    [{ bin: "dist/cli.js" }, ["package.json"], ["dist/cli.js"]],
    [{ main: "dist/index.js" }, ["package.json"], ["dist/index.js"]],
    [{ bin: { a: "dist/cli.js", b: "dist/other.js" }, main: "dist/index.js" }, ["package.json"], ["dist/cli.js", "dist/index.js", "dist/other.js"]],
    [{}, ["README.md"], ["package.json"]],
  ] as const)("LAB-PKG-03/04/05 missing explicit files remain blockers: %j", async (metadata, files, missing) => {
    const f = await fixture(metadata);
    inventory([...files]);
    const result = await check(f);
    expect(result.findings.flatMap((finding) => finding.affectedFiles).sort()).toEqual([...missing].sort());
    expect(result.checks[0].status).toBe("failed");
    expect(calculateVerdict(result.checks, result.findings).verdict).toBe("not-ready-security-blocker-remains");
  });

  it("LAB-PKG-07 preserves forbidden-file severities alongside valid external paths", async () => {
    const f = await fixture({});
    inventory(["package.json", ".env", "private.pem", "private.key", "lab-output/a.json", "tmp/local.json"]);
    const result = await check(f);
    expect(result.findings.map((finding) => finding.severity)).toEqual(["blocker", "blocker", "blocker", "blocker", "major"]);
  });

  it.each([
    { bin: 4 }, { bin: ["cli.js"] }, { bin: { cli: null } }, { bin: { "../cli": "cli.js" } }, { main: false }, { main: "lib" },
    { bin: "../cli.js" }, { main: "/index.js" }, { bin: "C:\\cli.js" }, { main: "./dist/../index.js" },
    { bin: "https://example.org/cli.js" }, { bin: "" }, { bin: "./dist/*.js" },
    { exports: { import: "./index.js", require: "./index.cjs" } },
    { exports: { "./*": "./dist/*.js" } }, { exports: { "./../unsafe": "./index.js" } }, { exports: ["./a.js", "./b.js"] },
    { exports: { ".": { import: "./a.js" } } }, { exports: "index.js" },
  ])("LAB-PKG-08 unsupported or unsafe metadata fails closed: %j", async (metadata) => {
    const f = await fixture(metadata);
    inventory(["package.json"]);
    const result = await check(f);
    expect(result.findings.some((finding) => finding.id.startsWith("npm-pack-metadata-") && finding.severity === "blocker")).toBe(true);
    expect(result.checks[0].status).toBe("failed");
  });

  it.each(["malformed", "missing", "unreadable", "null", "array"])("LAB-PKG-08 rejects %s package evidence", async (kind) => {
    const f = await fixture();
    const manifest = path.join(f.root, "package.json");
    if (kind === "missing" || kind === "unreadable") {
      await fs.rename(manifest, path.join(f.root, "saved-manifest.json"));
      if (kind === "unreadable") await fs.mkdir(manifest);
    } else await fs.writeFile(manifest, kind === "null" ? "null" : kind === "array" ? "[]" : "{broken");
    inventory(["package.json"]);
    expect((await check(f)).findings.some((finding) => finding.id.startsWith("npm-pack-metadata-") && finding.severity === "blocker")).toBe(true);
  });

  it.each([
    { exitCode: 1 }, { exitCode: null, stderr: "spawn ENOENT" }, { timedOut: true }, { skipped: true },
    { stdout: "" }, { stdout: "[]" }, { stdout: '[{"files":[]}]' }, { stdout: "not inventory" },
    { stdout: '[{"files":[{"path":"../escape"}]}]' }, { stdout: '[{"files":[{}]}]' },
  ])("LAB-PKG-09 rejects command/inventory failure even with otherwise valid evidence: %j", async (failure) => {
    const f = await fixture({});
    inventory(["package.json"], failure);
    const result = await check(f);
    expect(result.checks[0].status).toBe("failed");
    expect(result.findings.some((finding) => finding.id === "npm-pack-evidence-invalid" && finding.severity === "blocker")).toBe(true);
  });

  it("LAB-PKG-10 normalizes supported relative prefixes and Windows separators", async () => {
    const f = await fixture({ bin: ".\\dist\\cli.js", main: "./dist/index.js" });
    inventory(["./package.json", "dist\\cli.js", "./dist\\index.js"]);
    expect((await check(f)).findings).toEqual([]);
  });

  it("does not confuse nested package/ JSON inventory paths with root entrypoints", async () => {
    const f = await fixture({ bin: "dist/cli.js" });
    inventory(["package/package.json", "package/dist/cli.js"]);
    expect((await check(f)).findings.flatMap((finding) => finding.affectedFiles).sort()).toEqual(["dist/cli.js", "package.json"]);
  });

  it("preserves a literal package/ directory in declared entrypoints", async () => {
    const f = await fixture({ main: "./package/dist/index.js" });
    inventory(["package.json", "package/dist/index.js"]);
    expect((await check(f)).findings).toEqual([]);
    vi.restoreAllMocks();
    inventory(["package.json", "dist/index.js"]);
    expect((await check(f)).findings.flatMap((finding) => finding.affectedFiles)).toEqual(["package/dist/index.js"]);
  });

  it("requires existing npm README and license files without inventing absent documentation", async () => {
    const f = await fixture({});
    await fs.writeFile(path.join(f.root, "README.md"), "readme");
    await fs.writeFile(path.join(f.root, "LICENSE"), "license");
    inventory(["package.json"]);
    expect((await check(f)).findings.flatMap((finding) => finding.affectedFiles).sort()).toEqual(["LICENSE", "README.md"]);
  });

  it("standalone package CLI uses the same external policy", async () => {
    const f = await fixture({ name: "external-cli", version: "1.0.0", bin: "cli.js" });
    await fs.writeFile(path.join(f.root, "cli.js"), "console.log('cli');");
    const before = await snapshot(f.root);
    const result = await commands.runSecurityCommand({ command: process.execPath,
      args: ["--import", "tsx", "scripts/security/runPackageChecks.ts", "--target", f.root],
      cwd: toolRoot, timeoutMs: 30_000 });
    expect(result.exitCode, result.stderr).toBe(0);
    expect(result.stdout).toContain("Findings: 0");
    expect(await snapshot(f.root)).toEqual(before);
  }, 30_000);

  it("LAB-PKG-12 real npm inspection preserves target files and does not run lifecycle scripts", async () => {
    const script = "node -e \"require('fs').writeFileSync('MUTATED','unsafe')\"";
    const f = await fixture({ name: "external-cli", version: "1.0.0", bin: "dist/cli.js", main: "dist/index.js",
      files: ["dist"], scripts: { prepack: script, prepare: script, postpack: script } });
    await fs.mkdir(path.join(f.root, "dist"));
    await fs.writeFile(path.join(f.root, "dist", "cli.js"), "console.log('cli');");
    await fs.writeFile(path.join(f.root, "dist", "index.js"), "export {};");
    const git = (args: string[]) => execFileSync("git", args, { cwd: f.root, encoding: "utf8", windowsHide: true });
    git(["init", "--quiet"]);
    git(["add", "package.json", "dist/cli.js", "dist/index.js"]);
    git(["-c", "user.name=Security fixture", "-c", "user.email=fixture@example.invalid", "commit", "--quiet", "-m", "fixture"]);
    await fs.writeFile(path.join(f.root, "untracked.txt"), "preserve me");
    f.target = resolveValidationTarget(f.root, toolRoot);
    const before = await snapshot(f.root);
    const result = await check(f);
    expect(result.findings).toEqual([]);
    expect(result.checks[0].status).toBe("passed");
    expect(await snapshot(f.root)).toEqual(before);
    expect(result.checks[0].commandCwd).toBe(f.root);
    // LAB-PKG-11: exercise the full target-aware runner and existing report
    // builders with the real package checker, rather than copying metadata.
    const summary = await runSecurityValidation({ cwd: toolRoot, targetPath: f.root, selectedChecks: ["package"], config: f.config });
    expect(summary.checks.find((item) => item.id === "npm-pack-dry-run")?.status).toBe("passed");
    const report = JSON.parse(renderJsonReport(buildSecurityReportFromSummary(summary)));
    expect(report.metadata).toMatchObject({ packageName: "external-cli", targetRoot: f.root, commit: git(["rev-parse", "--short", "HEAD"]).trim(), isSelf: false });
    expect(await snapshot(f.root)).toEqual(before);
  }, 30_000);
});

async function snapshot(root: string): Promise<Record<string, string>> {
  const result: Record<string, string> = {};
  for (const entry of await fs.readdir(root, { recursive: true, withFileTypes: true })) {
    if (entry.isFile()) {
      const file = path.join(entry.parentPath, entry.name);
      result[path.relative(root, file)] = (await fs.readFile(file)).toString("base64");
    }
  }
  return result;
}
