import { execSync } from "node:child_process";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { TARGET_SANDBOX_SCENARIO } from "../../../src/securityValidation/attackScenarios/scenarios/targetSandboxScenario.js";
import { captureTargetSnapshot, diffTargetSnapshots } from "../../../src/securityValidation/attackScenarios/targetSnapshot.js";
import { DEFAULT_SECURITY_CONFIG } from "../../../src/securityValidation/config.js";
import type { SecurityValidationTarget } from "../../../src/securityValidation/validate/resolveTarget.js";
import type { AttackScenarioContext } from "../../../src/securityValidation/attackScenarios/attackScenario.js";

function git(cwd: string, args: string): void {
  execSync(`git ${args}`, { cwd, stdio: "pipe" });
}

function makeGitRepo(): string {
  const root = mkdtempSync(path.join(os.tmpdir(), "target-sandbox-"));
  git(root, "init -q");
  git(root, 'config user.email "test@example.com"');
  git(root, 'config user.name "Test"');
  writeFileSync(path.join(root, "tracked.txt"), "hello\n", "utf8");
  git(root, "add tracked.txt");
  git(root, 'commit -q -m "init"');
  return root;
}

function fakeTarget(targetRoot: string, hasGit: boolean): SecurityValidationTarget {
  return {
    targetRoot,
    toolRoot: targetRoot,
    packageName: "fake",
    packageVersion: "1.0.0",
    hasPackageJson: false,
    hasSecurityTestScript: false,
    hasLockfile: false,
    branch: "main",
    commit: "abc",
    hasGit,
    isSelf: false,
  };
}

const cleanupDirs: string[] = [];

afterEach(async () => {
  await Promise.all(cleanupDirs.splice(0).map((d) => rm(d, { recursive: true, force: true })));
});

describe("TARGET_SANDBOX_SCENARIO", () => {
  it("skips cleanly for a non-git target without crashing", () => {
    const target = fakeTarget("/tmp/definitely-not-a-git-repo-xyz", false);
    const ctx: AttackScenarioContext = {
      toolRoot: target.targetRoot,
      target,
      profile: "node-cli-package",
      config: DEFAULT_SECURITY_CONFIG,
      targetSnapshotBefore: captureTargetSnapshot(target.targetRoot, false),
    };
    expect(() => TARGET_SANDBOX_SCENARIO.skipCondition?.(ctx)).not.toThrow();
    const reason = TARGET_SANDBOX_SCENARIO.skipCondition?.(ctx);
    expect(reason).toMatch(/not a git repository/i);
  });

  it("clean target remains clean after validation → passed", async () => {
    const root = makeGitRepo();
    cleanupDirs.push(root);
    const target = fakeTarget(root, true);
    const before = captureTargetSnapshot(root, true);
    const ctx: AttackScenarioContext = {
      toolRoot: root,
      target,
      profile: "node-cli-package",
      config: DEFAULT_SECURITY_CONFIG,
      targetSnapshotBefore: before,
    };

    const outcome = await TARGET_SANDBOX_SCENARIO.run(ctx);
    expect(outcome.status).toBe("passed");
    expect(outcome.evidence.length).toBeGreaterThanOrEqual(0);
  });

  it("pre-existing dirty target is reported as pre-existing, not newly caused", async () => {
    const root = makeGitRepo();
    cleanupDirs.push(root);
    // Dirty the repo BEFORE the "before" snapshot is taken.
    writeFileSync(path.join(root, "already-dirty.txt"), "pre-existing\n", "utf8");
    const target = fakeTarget(root, true);
    const before = captureTargetSnapshot(root, true);
    expect(before.entries?.some((e) => e.path === "already-dirty.txt")).toBe(true);

    const ctx: AttackScenarioContext = {
      toolRoot: root,
      target,
      profile: "node-cli-package",
      config: DEFAULT_SECURITY_CONFIG,
      targetSnapshotBefore: before,
    };
    const outcome = await TARGET_SANDBOX_SCENARIO.run(ctx);
    // Nothing NEW happened after "before" was captured, so this must pass —
    // pre-existing dirtiness must not be treated as caused by this run.
    expect(outcome.status).toBe("passed");
  });

  it("detects a new tracked-file modification as a failure", async () => {
    const root = makeGitRepo();
    cleanupDirs.push(root);
    const target = fakeTarget(root, true);
    const before = captureTargetSnapshot(root, true);

    // Simulate a modification happening during "validation".
    writeFileSync(path.join(root, "tracked.txt"), "modified!\n", "utf8");

    const ctx: AttackScenarioContext = {
      toolRoot: root,
      target,
      profile: "node-cli-package",
      config: DEFAULT_SECURITY_CONFIG,
      targetSnapshotBefore: before,
    };
    const outcome = await TARGET_SANDBOX_SCENARIO.run(ctx);
    expect(outcome.status).toBe("failed");
    expect(outcome.evidence.some((e) => e.filePath === "tracked.txt")).toBe(true);
  });

  it("detects a newly-appeared generated-artifact path as a failure with artifact-safety category", async () => {
    const root = makeGitRepo();
    cleanupDirs.push(root);
    const target = fakeTarget(root, true);
    const before = captureTargetSnapshot(root, true);

    mkdirSync(path.join(root, "reports", "security"), { recursive: true });
    writeFileSync(path.join(root, "reports", "security", "v1-security-validation.json"), "{}\n", "utf8");

    const ctx: AttackScenarioContext = {
      toolRoot: root,
      target,
      profile: "node-cli-package",
      config: DEFAULT_SECURITY_CONFIG,
      targetSnapshotBefore: before,
    };
    const outcome = await TARGET_SANDBOX_SCENARIO.run(ctx);
    expect(outcome.status).toBe("failed");
    expect(outcome.category).toBe("artifact-safety");
  });

  it("produces structured, JSON-serializable evidence", async () => {
    const root = makeGitRepo();
    cleanupDirs.push(root);
    const target = fakeTarget(root, true);
    const before = captureTargetSnapshot(root, true);
    const ctx: AttackScenarioContext = {
      toolRoot: root,
      target,
      profile: "node-cli-package",
      config: DEFAULT_SECURITY_CONFIG,
      targetSnapshotBefore: before,
    };
    const outcome = await TARGET_SANDBOX_SCENARIO.run(ctx);
    expect(() => JSON.stringify(outcome.evidence)).not.toThrow();
  });
});

describe("diffTargetSnapshots", () => {
  it("is not comparable when either snapshot lacks git data", () => {
    const before = { targetRoot: "/x", takenAt: "now", hasGit: false as const };
    const after = { targetRoot: "/x", takenAt: "now", hasGit: false as const };
    const diff = diffTargetSnapshots(before, after);
    expect(diff.comparable).toBe(false);
  });
});
