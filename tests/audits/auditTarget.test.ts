import { describe, expect, it } from "vitest";
import path from "node:path";
import fs from "node:fs";
import os from "node:os";
import { resolveAuditTarget } from "../../src/audits/core/auditTarget.js";

function makeTempDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "audit-target-test-"));
}

/**
 * TEMP may live inside a checkout, where Git discovery would resolve a plain directory into the ancestor worktree. Bound
 * discovery at the directory's parent (Git searches the directory itself but not the ceiling) and restore the variable.
 */
function withGitCeiling<T>(dir: string, action: () => T): T {
  const previous = process.env.GIT_CEILING_DIRECTORIES;
  process.env.GIT_CEILING_DIRECTORIES = fs.realpathSync.native(path.dirname(dir));
  try {
    return action();
  } finally {
    if (previous === undefined) delete process.env.GIT_CEILING_DIRECTORIES;
    else process.env.GIT_CEILING_DIRECTORIES = previous;
  }
}

function cleanup(...dirs: string[]): void {
  for (const d of dirs) {
    try {
      fs.rmSync(d, { recursive: true, force: true });
    } catch {
      // best-effort
    }
  }
}

describe("resolveAuditTarget — self mode (default target)", () => {
  const toolRoot = process.cwd();

  it("resolves to the tool root and isSelf is true", () => {
    const target = resolveAuditTarget(undefined, toolRoot);
    expect(target.isSelf).toBe(true);
    expect(path.resolve(target.rootPath)).toBe(path.resolve(toolRoot));
  });

  it("exists and isDirectory are true", () => {
    const target = resolveAuditTarget(undefined, toolRoot);
    expect(target.exists).toBe(true);
    expect(target.isDirectory).toBe(true);
  });

  it("packageJsonPath points at the tool root's package.json", () => {
    const target = resolveAuditTarget(undefined, toolRoot);
    expect(target.packageJsonPath).toBe(path.join(path.resolve(toolRoot), "package.json"));
  });

  it("gitRoot is set (this repo is a git repo)", () => {
    const target = resolveAuditTarget(undefined, toolRoot);
    expect(target.gitRoot).toBe(path.resolve(toolRoot));
  });

  it("safeReportOutputRoot is under the tool root's reports/audits, not the target", () => {
    const target = resolveAuditTarget(undefined, toolRoot);
    expect(target.safeReportOutputRoot).toBe(path.join(path.resolve(toolRoot), "reports", "audits"));
  });
});

describe("resolveAuditTarget — external target", () => {
  it("resolves an absolute path to an existing directory", () => {
    const tmp = makeTempDir();
    try {
      const target = resolveAuditTarget(tmp, process.cwd());
      expect(path.resolve(target.rootPath)).toBe(path.resolve(tmp));
      expect(target.isSelf).toBe(false);
    } finally {
      cleanup(tmp);
    }
  });

  it("packageJsonPath is null when the target has no package.json", () => {
    const tmp = makeTempDir();
    try {
      const target = resolveAuditTarget(tmp, process.cwd());
      expect(target.packageJsonPath).toBeNull();
    } finally {
      cleanup(tmp);
    }
  });

  it("gitRoot is null when the target is not a git repo", () => {
    const tmp = makeTempDir();
    try {
      const target = withGitCeiling(tmp, () => resolveAuditTarget(tmp, process.cwd()));
      expect(target.gitRoot).toBeNull();
    } finally {
      cleanup(tmp);
    }
  });

  it("safeReportOutputRoot always stays under the tool root, never under an external target", () => {
    const tmp = makeTempDir();
    try {
      const target = resolveAuditTarget(tmp, process.cwd());
      expect(target.safeReportOutputRoot).toBe(path.join(path.resolve(process.cwd()), "reports", "audits"));
      expect(target.safeReportOutputRoot.startsWith(path.resolve(tmp))).toBe(false);
    } finally {
      cleanup(tmp);
    }
  });

  it("resolves a relative path against process.cwd()", () => {
    const tmp = makeTempDir();
    try {
      const relative = path.relative(process.cwd(), tmp);
      const target = resolveAuditTarget(relative, process.cwd());
      // Windows cwd and TEMP can spell the same existing directory with different case.
      if (process.platform === "win32") {
        expect(fs.realpathSync.native(target.rootPath)).toBe(fs.realpathSync.native(tmp));
      } else {
        expect(path.resolve(target.rootPath)).toBe(path.resolve(tmp));
      }
    } finally {
      cleanup(tmp);
    }
  });

  it("compares existing fixture identities without conflating distinct directories", () => {
    const parent = makeTempDir();
    const expected = path.join(parent, "Case Target With Spaces");
    const distinct = path.join(parent, "Different Target With Spaces");
    fs.mkdirSync(expected);
    fs.mkdirSync(distinct);
    try {
      const spelling = process.platform === "win32"
        ? path.join(parent, "cASE tARGET wITH sPACES")
        : expected;
      const target = resolveAuditTarget(path.relative(process.cwd(), spelling), process.cwd());
      if (process.platform === "win32") {
        const expectedStat = fs.statSync(expected, { bigint: true });
        const actualStat = fs.statSync(target.rootPath, { bigint: true });
        expect(actualStat.dev).toBe(expectedStat.dev);
        expect(actualStat.ino).toBe(expectedStat.ino);
        expect(fs.realpathSync.native(target.rootPath)).toBe(fs.realpathSync.native(expected));
        expect(fs.realpathSync.native(target.rootPath)).not.toBe(fs.realpathSync.native(distinct));
      } else {
        expect(path.resolve(target.rootPath)).toBe(path.resolve(expected));
        expect(path.resolve(target.rootPath)).not.toBe(path.resolve(distinct));
        expect(path.resolve(expected)).not.toBe(path.resolve(parent, "cASE tARGET wITH sPACES"));
      }
      expect(target.safeReportOutputRoot).toBe(path.join(path.resolve(process.cwd()), "reports", "audits"));
    } finally {
      cleanup(parent);
    }
  });

  it("handles a Windows-style path with spaces", () => {
    const parent = makeTempDir();
    const withSpaces = path.join(parent, "dir with spaces");
    fs.mkdirSync(withSpaces);
    try {
      const target = resolveAuditTarget(withSpaces, process.cwd());
      expect(path.resolve(target.rootPath)).toBe(path.resolve(withSpaces));
    } finally {
      cleanup(parent);
    }
  });

  it("does not write any files during resolution", () => {
    const tmp = makeTempDir();
    try {
      const before = fs.readdirSync(tmp);
      resolveAuditTarget(tmp, process.cwd());
      const after = fs.readdirSync(tmp);
      expect(after).toEqual(before);
    } finally {
      cleanup(tmp);
    }
  });
});

describe("resolveAuditTarget — invalid paths", () => {
  it("fails cleanly for a missing path", () => {
    const missing = path.join(os.tmpdir(), "audit-target-does-not-exist-" + Date.now());
    expect(() => resolveAuditTarget(missing, process.cwd())).toThrow(/does not exist/);
  });

  it("fails cleanly for a file target (not a directory)", () => {
    const tmp = makeTempDir();
    const filePath = path.join(tmp, "some-file.txt");
    fs.writeFileSync(filePath, "content", "utf8");
    try {
      expect(() => resolveAuditTarget(filePath, process.cwd())).toThrow(/not a directory/);
    } finally {
      cleanup(tmp);
    }
  });
});
