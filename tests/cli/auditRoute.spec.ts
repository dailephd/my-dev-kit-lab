import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { runLabCli } from "../../src/cli/index.js";
import type { LabCliWriters } from "../../src/cli/index.js";

// ---------------------------------------------------------------------------
// v0.4.6 Batch 3 -- global --workspace option and installed-style audit
// output separation (packageRoot vs workspaceRoot vs targetRoot).
//
// Fixture construction mirrors tests/audits/auditFailOnIntegration.test.ts's
// bounded, hand-built temp-package.json fixtures (real detector triggers,
// no subprocess needed since we call the router in-process here).
// ---------------------------------------------------------------------------

const CODE_ROT_JSON_REPORT = "code-rot-audit.json";

const tempDirs: string[] = [];
const installedPackage = vi.hoisted(() => ({ root: "" }));

// The public test lane puts TEMP inside the source checkout. Give the
// in-process router a sibling package fixture to model an installation.
vi.mock("../../src/runtime/packageRoot.js", () => ({
  discoverPackageRoot: () => installedPackage.root,
}));

beforeEach(() => {
  installedPackage.root = mkdtempSync(path.join(os.tmpdir(), "audit-route-package-"));
  tempDirs.push(installedPackage.root);
  writeFileSync(path.join(installedPackage.root, "package.json"),
    JSON.stringify({ name: "@dailephd/my-dev-kit-lab", version: "0.10.0" }));
});

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

function createWriters(): { writers: LabCliWriters; stdout: string[]; stderr: string[] } {
  const stdout: string[] = [];
  const stderr: string[] = [];
  return {
    writers: {
      stdout: (message) => {
        stdout.push(message);
      },
      stderr: (message) => {
        stderr.push(message);
      }
    },
    stdout,
    stderr
  };
}

function noIssuesFixture(): string {
  const root = mkdtempSync(path.join(os.tmpdir(), "audit-route-clean-"));
  tempDirs.push(root);
  writeFileSync(
    path.join(root, "package.json"),
    JSON.stringify({ name: "fixture-clean", version: "1.0.0", scripts: {} }, null, 2),
    "utf8"
  );
  return root;
}

function blockerFixture(): string {
  const root = mkdtempSync(path.join(os.tmpdir(), "audit-route-blocker-"));
  tempDirs.push(root);
  writeFileSync(
    path.join(root, "package.json"),
    JSON.stringify({ name: "fixture", version: "2.0.0", scripts: {} }, null, 2),
    "utf8"
  );
  writeFileSync(
    path.join(root, "package-lock.json"),
    JSON.stringify({ name: "fixture", version: "1.0.0", lockfileVersion: 3 }, null, 2),
    "utf8"
  );
  return root;
}

async function withHomeOverride<T>(tempHome: string, fn: () => Promise<T>): Promise<T> {
  const originalHome = process.env.HOME;
  const originalUserProfile = process.env.USERPROFILE;
  process.env.HOME = tempHome;
  process.env.USERPROFILE = tempHome;
  try {
    return await fn();
  } finally {
    if (originalHome === undefined) delete process.env.HOME;
    else process.env.HOME = originalHome;
    if (originalUserProfile === undefined) delete process.env.USERPROFILE;
    else process.env.USERPROFILE = originalUserProfile;
  }
}

function snapshotDir(root: string): Record<string, string> {
  const snapshot: Record<string, string> = {};
  for (const entry of readdirSync(root)) {
    snapshot[entry] = readFileSync(path.join(root, entry), "utf8");
  }
  return snapshot;
}

describe("global --workspace option", () => {
  it("A: defaults workspaceRoot to <home>/.my-dev-kit-lab when --workspace is omitted", async () => {
    const tempHome = mkdtempSync(path.join(os.tmpdir(), "cli-workspace-home-"));
    const caller = mkdtempSync(path.join(os.tmpdir(), "cli-workspace-caller-"));
    tempDirs.push(tempHome, caller);
    const target = noIssuesFixture();

    const originalCwd = process.cwd();
    let code: number;
    try {
      process.chdir(caller);
      code = await withHomeOverride(tempHome, () =>
        runLabCli(["audit", "--target", target, "--types", "code-rot", "--fail-on", "none"])
      );
    } finally {
      process.chdir(originalCwd);
    }
    expect(code).toBe(0);

    const expectedOut = path.join(tempHome, ".my-dev-kit-lab", "reports", "audits", "code-rot");
    expect(existsSync(path.join(expectedOut, CODE_ROT_JSON_REPORT))).toBe(true);
    const evidence = path.join(caller, "lab-output", "evidence");
    const [receipt] = readdirSync(evidence);
    expect(existsSync(path.join(evidence, receipt!, "reports"))).toBe(false);
  });

  it("B: an absolute --workspace is used directly", async () => {
    const workspaceRoot = mkdtempSync(path.join(os.tmpdir(), "cli-workspace-abs-"));
    tempDirs.push(workspaceRoot);
    const target = noIssuesFixture();

    const code = await runLabCli([
      "--workspace",
      workspaceRoot,
      "audit",
      "--target",
      target,
      "--types",
      "code-rot",
      "--fail-on",
      "none"
    ]);
    expect(code).toBe(0);
    expect(existsSync(path.join(workspaceRoot, "reports", "audits", "code-rot", CODE_ROT_JSON_REPORT))).toBe(true);
  });

  it("C: a relative --workspace resolves against invocationCwd", async () => {
    const callerDir = mkdtempSync(path.join(os.tmpdir(), "cli-workspace-caller-"));
    tempDirs.push(callerDir);
    const target = noIssuesFixture();
    const originalCwd = process.cwd();
    try {
      process.chdir(callerDir);
      const code = await runLabCli([
        "--workspace",
        "state",
        "audit",
        "--target",
        target,
        "--types",
        "code-rot",
        "--fail-on",
        "none"
      ]);
      expect(code).toBe(0);
    } finally {
      process.chdir(originalCwd);
    }
    const expectedOut = path.join(callerDir, "state", "reports", "audits", "code-rot");
    expect(existsSync(path.join(expectedOut, CODE_ROT_JSON_REPORT))).toBe(true);
  });

  it("D: the routed command does not receive --workspace after the router consumes it", async () => {
    const workspaceRoot = mkdtempSync(path.join(os.tmpdir(), "cli-workspace-strip-"));
    tempDirs.push(workspaceRoot);
    const { writers, stdout } = createWriters();
    // If --workspace leaked through, remaining[0] would be "--workspace" (not
    // a recognized top-level command), and this would return exit 2 instead
    // of showing final-demo help with exit 0.
    const code = await runLabCli(["--workspace", workspaceRoot, "demo", "final", "--help"], { writers });
    expect(code).toBe(0);
    expect(stdout.join("\n")).toContain("Usage:");
  });

  it("E: a missing value after --workspace returns usage exit code 2", async () => {
    const { writers, stderr } = createWriters();
    const code = await runLabCli(["--workspace"], { writers });
    expect(code).toBe(2);
    expect(stderr.join("\n")).toContain("--workspace");
  });
});

describe("audit route -- workspace/target/output separation", () => {
  it("writes default (implicit) output under workspaceRoot, and never under packageRoot or targetRoot", async () => {
    const workspaceRoot = mkdtempSync(path.join(os.tmpdir(), "audit-route-workspace-"));
    tempDirs.push(workspaceRoot);
    const target = noIssuesFixture();
    expect(workspaceRoot).not.toBe(installedPackage.root);
    expect(workspaceRoot).not.toBe(target);

    const packageRootReport = path.join(installedPackage.root, "reports", "audits", "code-rot", CODE_ROT_JSON_REPORT);
    const beforeMtime = existsSync(packageRootReport) ? statSync(packageRootReport).mtimeMs : undefined;

    const code = await runLabCli([
      "--workspace",
      workspaceRoot,
      "audit",
      "--target",
      target,
      "--types",
      "code-rot",
      "--fail-on",
      "none"
    ]);
    expect(code).toBe(0);

    const workspaceReport = path.join(workspaceRoot, "reports", "audits", "code-rot", CODE_ROT_JSON_REPORT);
    expect(existsSync(workspaceReport)).toBe(true);

    // Never written under the target.
    expect(existsSync(path.join(target, "reports"))).toBe(false);

    // Never (newly) written under the package root -- either it still
    // doesn't exist, or, if some earlier unrelated run left one there, this
    // run did not touch it (same mtime as before).
    const afterMtime = existsSync(packageRootReport) ? statSync(packageRootReport).mtimeMs : undefined;
    expect(afterMtime).toBe(beforeMtime);
  });

  it("preserves explicit --out semantics (not redirected under workspaceRoot)", async () => {
    const workspaceRoot = mkdtempSync(path.join(os.tmpdir(), "audit-route-workspace-explicit-"));
    tempDirs.push(workspaceRoot);
    const explicitOut = mkdtempSync(path.join(os.tmpdir(), "audit-route-explicit-out-"));
    tempDirs.push(explicitOut);
    const target = noIssuesFixture();

    const args = [
      "--workspace",
      workspaceRoot,
      "audit",
      "--target",
      target,
      "--types",
      "code-rot",
      "--fail-on",
      "none",
      "--out",
      explicitOut
    ];
    expect(await runLabCli(args)).toBe(0);
    const report = path.join(explicitOut, CODE_ROT_JSON_REPORT);
    const original = readFileSync(report, "utf8");
    expect(await runLabCli(args)).toBe(2);
    expect(readFileSync(report, "utf8")).toBe(original);
    expect(existsSync(path.join(workspaceRoot, "reports"))).toBe(false);
  });

  it("resolves a relative --target against invocationCwd, not workspaceRoot", async () => {
    const workspaceRoot = mkdtempSync(path.join(os.tmpdir(), "audit-route-workspace-target-"));
    tempDirs.push(workspaceRoot);
    const callerDir = mkdtempSync(path.join(os.tmpdir(), "audit-route-caller-"));
    tempDirs.push(callerDir);
    const targetDirName = "my-target";
    const outDir = mkdtempSync(path.join(os.tmpdir(), "audit-route-target-out-"));
    tempDirs.push(outDir);

    mkdirSync(path.join(callerDir, targetDirName));
    writeFileSync(
      path.join(callerDir, targetDirName, "package.json"),
      JSON.stringify({ name: "relative-target-fixture", version: "1.0.0", scripts: {} }, null, 2),
      "utf8"
    );

    const originalCwd = process.cwd();
    try {
      process.chdir(callerDir);
      const code = await runLabCli([
        "--workspace",
        workspaceRoot,
        "audit",
        "--target",
        targetDirName,
        "--types",
        "code-rot",
        "--fail-on",
        "none",
        "--format",
        "json",
        "--out",
        outDir
      ]);
      expect(code).toBe(0);
    } finally {
      process.chdir(originalCwd);
    }

    const reportPath = path.join(outDir, CODE_ROT_JSON_REPORT);
    expect(existsSync(reportPath)).toBe(true);
    const parsed = JSON.parse(readFileSync(reportPath, "utf8")) as {
      sourceOfTruth: { packageName: string | null };
    };
    expect(parsed.sourceOfTruth.packageName).toBe("relative-target-fixture");
  });

  it("keeps reports and receipts outside the target when invoked from it", async () => {
    const tempHome = mkdtempSync(path.join(os.tmpdir(), "audit-route-target-home-"));
    tempDirs.push(tempHome);
    const target = noIssuesFixture();
    const originalCwd = process.cwd();
    try {
      process.chdir(target);
      expect(await withHomeOverride(tempHome, () => runLabCli([
        "audit", "--target", ".", "--types", "code-rot", "--fail-on", "none",
      ]))).toBe(0);
    } finally {
      process.chdir(originalCwd);
    }
    expect(readdirSync(target)).toEqual(["package.json"]);
    const workspaceRoot = path.join(tempHome, ".my-dev-kit-lab");
    expect(existsSync(path.join(workspaceRoot, "reports", "audits", "code-rot", CODE_ROT_JSON_REPORT))).toBe(true);
    expect(readdirSync(path.join(workspaceRoot, "lab-output", "evidence"))).toHaveLength(1);
  });

  it.each([false, true])("writes exit 1 reports with explicit output set to %s", async (explicit) => {
    const workspaceRoot = mkdtempSync(path.join(os.tmpdir(), "audit-route-workspace-failon-"));
    tempDirs.push(workspaceRoot);
    const outDir = mkdtempSync(path.join(os.tmpdir(), "audit-route-failon-out-"));
    tempDirs.push(outDir);
    const target = blockerFixture();

    const code = await runLabCli([
      "--workspace",
      workspaceRoot,
      "audit",
      "--target",
      target,
      "--types",
      "code-rot",
      "--fail-on",
      "blocker",
      ...(explicit ? ["--out", outDir] : []),
    ]);
    expect(code).toBe(1);
    const reportRoot = explicit ? outDir : path.join(workspaceRoot, "reports", "audits", "code-rot");
    const report = JSON.parse(readFileSync(path.join(reportRoot, CODE_ROT_JSON_REPORT), "utf8"));
    expect(report.exit.code).toBe(1);
  });

  it("writes an incomplete audit with its retained finding at the default report location", async () => {
    const workspaceRoot = mkdtempSync(path.join(os.tmpdir(), "audit-route-partial-"));
    tempDirs.push(workspaceRoot);
    const target = noIssuesFixture();
    mkdirSync(path.join(target, "tests"));
    writeFileSync(path.join(target, "tests", "sample.test.mjs"),
      'const title = String(1);\nit.skip(title, () => {});\n');

    const code = await runLabCli(["--workspace", workspaceRoot, "audit", "--target", target,
      "--types", "code-rot", "--include", "tests", "--fail-on", "none"]);
    expect(code).toBe(2);
    const reportRoot = path.join(workspaceRoot, "reports", "audits", "code-rot");
    const report = JSON.parse(readFileSync(path.join(reportRoot, CODE_ROT_JSON_REPORT), "utf8"));
    expect(report.schemaVersion).toBe("1.0");
    expect(report.exit.code).toBe(2);
    expect(report.detectorErrors).toContainEqual(expect.objectContaining({ id: "test-rot",
      message: expect.stringContaining("executable test modifiers; file=tests/sample.test.mjs") }));
    expect(report.issues).toContainEqual(expect.objectContaining({ id: "test-rot:tests/sample.test.mjs:skip-usage:2" }));
    expect(readFileSync(path.join(reportRoot, "code-rot-audit.txt"), "utf8")).toContain("INCOMPLETE");
  });

  it("leaves the audit target byte-for-byte unmodified (target immutability)", async () => {
    const workspaceRoot = mkdtempSync(path.join(os.tmpdir(), "audit-route-workspace-immutability-"));
    tempDirs.push(workspaceRoot);
    const target = noIssuesFixture();

    const before = snapshotDir(target);

    const code = await runLabCli([
      "--workspace",
      workspaceRoot,
      "audit",
      "--target",
      target,
      "--types",
      "code-rot",
      "--fail-on",
      "none"
    ]);
    expect(code).toBe(0);

    const after = snapshotDir(target);
    expect(after).toEqual(before);
  });
});
