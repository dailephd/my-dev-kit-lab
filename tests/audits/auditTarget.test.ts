import { describe, expect, it } from "vitest";
import path from "node:path";
import fs from "node:fs";
import os from "node:os";
import { resolveAuditTarget } from "../../src/audits/core/auditTarget.js";

function makeTempDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "audit-target-test-"));
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
      const target = resolveAuditTarget(tmp, process.cwd());
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
    const relative = path.relative(process.cwd(), tmp);
    const target = resolveAuditTarget(relative, process.cwd());
    expect(path.resolve(target.rootPath)).toBe(path.resolve(tmp));
    cleanup(tmp);
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
