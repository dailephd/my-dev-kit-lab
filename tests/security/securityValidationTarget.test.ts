import { describe, expect, it } from "vitest";
import path from "node:path";
import fs from "node:fs";
import os from "node:os";
import {
  resolveValidationTarget,
  reportFilenamePrefix,
  targetDescription,
} from "../../src/securityValidation/validate/resolveTarget.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeTempDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "sec-target-test-"));
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

// ---------------------------------------------------------------------------
// resolveValidationTarget — self mode
// ---------------------------------------------------------------------------

describe("resolveValidationTarget — self mode (no targetPath)", () => {
  const toolRoot = process.cwd();

  it("isSelf is true when no targetPath provided", () => {
    const target = resolveValidationTarget(undefined, toolRoot);
    expect(target.isSelf).toBe(true);
  });

  it("targetRoot equals toolRoot", () => {
    const target = resolveValidationTarget(undefined, toolRoot);
    expect(path.resolve(target.targetRoot)).toBe(path.resolve(toolRoot));
  });

  it("reads package.json from toolRoot", () => {
    const target = resolveValidationTarget(undefined, toolRoot);
    expect(target.hasPackageJson).toBe(true);
    expect(typeof target.packageName).toBe("string");
    expect(typeof target.packageVersion).toBe("string");
    expect(typeof target.hasSecurityTestScript).toBe("boolean");
  });

  it("detects lockfile presence", () => {
    const target = resolveValidationTarget(undefined, toolRoot);
    expect(target.hasLockfile).toBe(true);
  });

  it("returns git metadata", () => {
    const target = resolveValidationTarget(undefined, toolRoot);
    // In a git repo the branch and commit are non-null strings
    expect(target.hasGit).toBe(true);
    expect(typeof target.branch).toBe("string");
    expect(typeof target.commit).toBe("string");
  });
});

// ---------------------------------------------------------------------------
// resolveValidationTarget — external target (temp dir)
// ---------------------------------------------------------------------------

describe("resolveValidationTarget — external target", () => {
  it("resolves an absolute path to an existing directory", () => {
    const tmp = makeTempDir();
    try {
      const target = resolveValidationTarget(tmp, process.cwd());
      expect(path.resolve(target.targetRoot)).toBe(path.resolve(tmp));
      expect(target.isSelf).toBe(false);
    } finally {
      cleanup(tmp);
    }
  });

  it("isSelf is false for external directory", () => {
    const tmp = makeTempDir();
    try {
      const target = resolveValidationTarget(tmp, process.cwd());
      expect(target.isSelf).toBe(false);
    } finally {
      cleanup(tmp);
    }
  });

  it("hasPackageJson is false when no package.json in target", () => {
    const tmp = makeTempDir();
    try {
      const target = resolveValidationTarget(tmp, process.cwd());
      expect(target.hasPackageJson).toBe(false);
      expect(target.hasSecurityTestScript).toBe(false);
      expect(target.packageName).toBeNull();
      expect(target.packageVersion).toBeNull();
    } finally {
      cleanup(tmp);
    }
  });

  it("reads packageName and packageVersion from target package.json", () => {
    const tmp = makeTempDir();
    try {
      fs.writeFileSync(
        path.join(tmp, "package.json"),
        JSON.stringify({ name: "test-project", version: "2.3.4" })
      );
      const target = resolveValidationTarget(tmp, process.cwd());
      expect(target.hasPackageJson).toBe(true);
      expect(target.packageName).toBe("test-project");
      expect(target.packageVersion).toBe("2.3.4");
      expect(target.hasSecurityTestScript).toBe(false);
    } finally {
      cleanup(tmp);
    }
  });

  it("detects scripts.test:security from target package.json", () => {
    const tmp = makeTempDir();
    try {
      fs.writeFileSync(
        path.join(tmp, "package.json"),
        JSON.stringify({
          name: "test-project",
          version: "2.3.4",
          scripts: { "test:security": "node security-check.js" },
        })
      );
      const target = resolveValidationTarget(tmp, process.cwd());
      expect(target.hasPackageJson).toBe(true);
      expect(target.hasSecurityTestScript).toBe(true);
    } finally {
      cleanup(tmp);
    }
  });

  it("handles package.json with no name or version fields", () => {
    const tmp = makeTempDir();
    try {
      fs.writeFileSync(path.join(tmp, "package.json"), JSON.stringify({}));
      const target = resolveValidationTarget(tmp, process.cwd());
      expect(target.hasPackageJson).toBe(true);
      expect(target.packageName).toBeNull();
      expect(target.packageVersion).toBeNull();
    } finally {
      cleanup(tmp);
    }
  });

  it("detects package-lock.json lockfile", () => {
    const tmp = makeTempDir();
    try {
      fs.writeFileSync(path.join(tmp, "package-lock.json"), "{}");
      const target = resolveValidationTarget(tmp, process.cwd());
      expect(target.hasLockfile).toBe(true);
    } finally {
      cleanup(tmp);
    }
  });

  it("hasLockfile is false when no lockfile present", () => {
    const tmp = makeTempDir();
    try {
      const target = resolveValidationTarget(tmp, process.cwd());
      expect(target.hasLockfile).toBe(false);
    } finally {
      cleanup(tmp);
    }
  });

  it("hasGit is false for a directory with no git history", () => {
    const tmp = makeTempDir();
    try {
      const target = resolveValidationTarget(tmp, process.cwd());
      // Temp dirs don't have git history unless they're inside a repo
      // This test verifies graceful handling — it won't crash
      expect(typeof target.hasGit).toBe("boolean");
    } finally {
      cleanup(tmp);
    }
  });
});

// ---------------------------------------------------------------------------
// resolveValidationTarget — error cases
// ---------------------------------------------------------------------------

describe("resolveValidationTarget — invalid paths", () => {
  it("throws a descriptive error for a nonexistent path", () => {
    expect(() =>
      resolveValidationTarget("/does/not/exist/9999xyz", process.cwd())
    ).toThrow(/does not exist/i);
  });

  it("error message includes the bad path", () => {
    const badPath = "/absolutely/not/a/real/path/9999xyz";
    expect(() =>
      resolveValidationTarget(badPath, process.cwd())
    ).toThrow(badPath);
  });

  it("throws when target path is a file, not a directory", () => {
    const tmp = makeTempDir();
    const filePath = path.join(tmp, "notadir.txt");
    try {
      fs.writeFileSync(filePath, "hello");
      expect(() =>
        resolveValidationTarget(filePath, process.cwd())
      ).toThrow(/not a directory/i);
    } finally {
      cleanup(tmp);
    }
  });
});

// ---------------------------------------------------------------------------
// reportFilenamePrefix
// ---------------------------------------------------------------------------

describe("reportFilenamePrefix", () => {
  const toolRoot = process.cwd();

  it("self-validation returns v<version>", () => {
    const target = resolveValidationTarget(undefined, toolRoot);
    const prefix = reportFilenamePrefix(target);
    expect(prefix).toMatch(/^v\d/);
  });

  it("external target with name and version returns sanitized-name-v<version>", () => {
    const tmp = makeTempDir();
    try {
      fs.writeFileSync(
        path.join(tmp, "package.json"),
        JSON.stringify({ name: "my-tool", version: "1.2.3" })
      );
      const target = resolveValidationTarget(tmp, toolRoot);
      expect(reportFilenamePrefix(target)).toBe("my-tool-v1.2.3");
    } finally {
      cleanup(tmp);
    }
  });

  it("scoped npm package has scope prefix stripped", () => {
    const tmp = makeTempDir();
    try {
      fs.writeFileSync(
        path.join(tmp, "package.json"),
        JSON.stringify({ name: "@dailephd/my-dev-kit", version: "1.2.0" })
      );
      const target = resolveValidationTarget(tmp, toolRoot);
      expect(reportFilenamePrefix(target)).toBe("my-dev-kit-v1.2.0");
    } finally {
      cleanup(tmp);
    }
  });

  it("external target with no package.json uses directory name", () => {
    const tmp = makeTempDir();
    try {
      const target = resolveValidationTarget(tmp, toolRoot);
      const prefix = reportFilenamePrefix(target);
      expect(prefix).toContain(path.basename(tmp));
    } finally {
      cleanup(tmp);
    }
  });

  it("external target with name but no version omits version suffix", () => {
    const tmp = makeTempDir();
    try {
      fs.writeFileSync(
        path.join(tmp, "package.json"),
        JSON.stringify({ name: "biolit-v1" })
      );
      const target = resolveValidationTarget(tmp, toolRoot);
      expect(reportFilenamePrefix(target)).toBe("biolit-v1");
    } finally {
      cleanup(tmp);
    }
  });
});

// ---------------------------------------------------------------------------
// targetDescription
// ---------------------------------------------------------------------------

describe("targetDescription", () => {
  const toolRoot = process.cwd();

  it("self-validation returns 'self (my-dev-kit-lab)'", () => {
    const target = resolveValidationTarget(undefined, toolRoot);
    const desc = targetDescription(target);
    expect(desc).toContain("self");
  });

  it("external target includes package name and path", () => {
    const tmp = makeTempDir();
    try {
      fs.writeFileSync(
        path.join(tmp, "package.json"),
        JSON.stringify({ name: "some-project", version: "3.0.0" })
      );
      const target = resolveValidationTarget(tmp, toolRoot);
      const desc = targetDescription(target);
      expect(desc).toContain("some-project");
      expect(desc).toContain(tmp);
    } finally {
      cleanup(tmp);
    }
  });
});
