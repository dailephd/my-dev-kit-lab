import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import { runLabCli } from "../../src/cli/index.js";

// ---------------------------------------------------------------------------
// v0.4.6 Batch 4 -- installed-style `security validate` output separation
// (packageRoot vs workspaceRoot vs targetRoot), target immutability, and
// exit-code parity. Mirrors tests/cli/auditRoute.spec.ts's structure and
// fixture conventions.
// ---------------------------------------------------------------------------

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");

const tempDirs: string[] = [];
afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

function boundedFixture(): string {
  const root = mkdtempSync(path.join(os.tmpdir(), "security-route-fixture-"));
  tempDirs.push(root);
  writeFileSync(
    path.join(root, "package.json"),
    JSON.stringify({ name: "security-route-fixture", version: "1.0.0", scripts: {} }, null, 2),
    "utf8"
  );
  return root;
}

function snapshotDir(root: string): Record<string, string> {
  const snapshot: Record<string, string> = {};
  for (const entry of readdirSync(root)) {
    snapshot[entry] = readFileSync(path.join(root, entry), "utf8");
  }
  return snapshot;
}

describe("security validate route -- workspace/target/output separation", () => {
  it("A: reaches the shared security command owner (real bounded execution)", async () => {
    const workspaceRoot = mkdtempSync(path.join(os.tmpdir(), "security-route-a-"));
    tempDirs.push(workspaceRoot);
    const target = boundedFixture();

    const code = await runLabCli([
      "--workspace",
      workspaceRoot,
      "security",
      "validate",
      "--target",
      target,
      "--checks",
      "boundary",
      "--format",
      "json"
    ]);
    expect(code).toBe(0);
    expect(existsSync(path.join(workspaceRoot, "reports", "security"))).toBe(true);
  });

  it("B: writes default (implicit) output under workspaceRoot, never packageRoot or targetRoot", async () => {
    const workspaceRoot = mkdtempSync(path.join(os.tmpdir(), "security-route-b-"));
    tempDirs.push(workspaceRoot);
    const target = boundedFixture();
    expect(workspaceRoot).not.toBe(REPO_ROOT);
    expect(workspaceRoot).not.toBe(target);

    const packageRootReportsDir = path.join(REPO_ROOT, "reports", "security");
    const beforeMtime = existsSync(packageRootReportsDir) ? statSync(packageRootReportsDir).mtimeMs : undefined;

    const code = await runLabCli([
      "--workspace",
      workspaceRoot,
      "security",
      "validate",
      "--target",
      target,
      "--checks",
      "boundary",
      "--format",
      "json"
    ]);
    expect(code).toBe(0);

    expect(existsSync(path.join(workspaceRoot, "reports", "security"))).toBe(true);
    expect(existsSync(path.join(target, "reports"))).toBe(false);

    // Never (newly) written under the package root -- either it still
    // doesn't exist, or, if some earlier unrelated run left one there, this
    // run did not touch it (same mtime as before).
    const afterMtime = existsSync(packageRootReportsDir) ? statSync(packageRootReportsDir).mtimeMs : undefined;
    expect(afterMtime).toBe(beforeMtime);
  });

  it("preserves explicit --out semantics (not redirected under workspaceRoot)", async () => {
    const workspaceRoot = mkdtempSync(path.join(os.tmpdir(), "security-route-explicit-out-"));
    tempDirs.push(workspaceRoot);
    const explicitOut = mkdtempSync(path.join(os.tmpdir(), "security-route-explicit-out-dir-"));
    tempDirs.push(explicitOut);
    const target = boundedFixture();

    const code = await runLabCli([
      "--workspace",
      workspaceRoot,
      "security",
      "validate",
      "--target",
      target,
      "--checks",
      "boundary",
      "--format",
      "json",
      "--out",
      explicitOut
    ]);
    expect(code).toBe(0);
    const written = readdirSync(explicitOut);
    expect(written.length).toBeGreaterThan(0);
    expect(existsSync(path.join(workspaceRoot, "reports"))).toBe(false);
  });

  it("C: resolves a relative --target against invocationCwd, not workspaceRoot", async () => {
    const workspaceRoot = mkdtempSync(path.join(os.tmpdir(), "security-route-target-workspace-"));
    tempDirs.push(workspaceRoot);
    const callerDir = mkdtempSync(path.join(os.tmpdir(), "security-route-caller-"));
    tempDirs.push(callerDir);
    const outDir = mkdtempSync(path.join(os.tmpdir(), "security-route-target-out-"));
    tempDirs.push(outDir);
    const targetDirName = "my-target";

    mkdirSync(path.join(callerDir, targetDirName));
    writeFileSync(
      path.join(callerDir, targetDirName, "package.json"),
      JSON.stringify({ name: "security-relative-target-fixture", version: "1.0.0", scripts: {} }, null, 2),
      "utf8"
    );

    const originalCwd = process.cwd();
    try {
      process.chdir(callerDir);
      const code = await runLabCli([
        "--workspace",
        workspaceRoot,
        "security",
        "validate",
        "--target",
        targetDirName,
        "--checks",
        "boundary",
        "--format",
        "json",
        "--out",
        outDir
      ]);
      expect(code).toBe(0);
    } finally {
      process.chdir(originalCwd);
    }

    const written = readdirSync(outDir);
    expect(written.length).toBeGreaterThan(0);
    const jsonFile = written.find((entry) => entry.endsWith(".json"));
    expect(jsonFile).toBeDefined();
    const rawReport = readFileSync(path.join(outDir, jsonFile as string), "utf8");
    // The resolved target's package name flows into the report; its
    // presence proves the relative --target resolved to callerDir/my-target
    // (invocationCwd-relative), not to a workspaceRoot-relative path (which
    // does not contain this directory).
    expect(rawReport).toContain("security-relative-target-fixture");
  });

  it("D: leaves the security target byte-for-byte unmodified (target immutability)", async () => {
    const workspaceRoot = mkdtempSync(path.join(os.tmpdir(), "security-route-immutability-"));
    tempDirs.push(workspaceRoot);
    const target = boundedFixture();

    const before = snapshotDir(target);

    const code = await runLabCli([
      "--workspace",
      workspaceRoot,
      "security",
      "validate",
      "--target",
      target,
      "--checks",
      "boundary",
      "--format",
      "json"
    ]);
    expect(code).toBe(0);

    const after = snapshotDir(target);
    expect(after).toEqual(before);
  });

  it("F: preserves existing exit-code mapping (invalid config still exits 2)", async () => {
    const workspaceRoot = mkdtempSync(path.join(os.tmpdir(), "security-route-exitcode-"));
    tempDirs.push(workspaceRoot);

    const code = await runLabCli(["--workspace", workspaceRoot, "security", "validate", "--fail-on", "not-a-real-threshold"]);
    expect(code).toBe(2);
  });
});
