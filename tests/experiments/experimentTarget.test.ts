import { describe, expect, it } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { resolveExperimentTarget } from "../../src/experiments/index.js";

function makeTempDir(prefix = "experiment-target-test-"): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

function cleanup(...dirs: string[]): void {
  for (const dir of dirs) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

const currentPackageVersion = JSON.parse(
  fs.readFileSync(path.join(process.cwd(), "package.json"), "utf8")
) as { version: string };

describe("resolveExperimentTarget", () => {
  it("resolves the current repository as the self target", () => {
    const target = resolveExperimentTarget(undefined, process.cwd());
    expect(target.kind).toBe("self");
    expect(target.isSelf).toBe(true);
    expect(path.resolve(target.targetRoot)).toBe(path.resolve(process.cwd()));
    expect(target.packageName).toBe("@dailephd/my-dev-kit-lab");
    expect(target.packageVersion).toBe(currentPackageVersion.version);
  });

  it("resolves an external local target fixture", () => {
    const tmp = makeTempDir();
    try {
      fs.writeFileSync(
        path.join(tmp, "package.json"),
        JSON.stringify({ name: "fixture-target", version: "2.0.0" })
      );
      const target = resolveExperimentTarget(tmp, process.cwd());
      expect(target.kind).toBe("external-local");
      expect(target.isSelf).toBe(false);
      expect(target.packageName).toBe("fixture-target");
      expect(target.packageVersion).toBe("2.0.0");
    } finally {
      cleanup(tmp);
    }
  });

  it("handles paths with spaces", () => {
    const root = makeTempDir();
    const spaced = path.join(root, "target with spaces");
    try {
      fs.mkdirSync(spaced);
      const target = resolveExperimentTarget(spaced, process.cwd());
      expect(target.targetRoot).toBe(path.resolve(spaced));
      expect(target.kind).toBe("external-local");
    } finally {
      cleanup(root);
    }
  });

  it("handles targets without package.json", () => {
    const tmp = makeTempDir();
    try {
      const target = resolveExperimentTarget(tmp, process.cwd());
      expect(target.hasPackageJson).toBe(false);
      expect(target.packageName).toBeNull();
      expect(target.packageVersion).toBeNull();
    } finally {
      cleanup(tmp);
    }
  });

  it("handles targets without git metadata", () => {
    const tmp = makeTempDir();
    try {
      const target = resolveExperimentTarget(tmp, process.cwd());
      expect(target.hasGit).toBe(false);
      expect(target.branch).toBeNull();
      expect(target.commit).toBeNull();
    } finally {
      cleanup(tmp);
    }
  });

  it("throws a clear error for nonexistent paths", () => {
    const missing = path.join(os.tmpdir(), "experiment-target-missing-999999");
    expect(() => resolveExperimentTarget(missing, process.cwd())).toThrow(
      /Target path does not exist/
    );
  });

  it("throws a clear error for file paths", () => {
    const tmp = makeTempDir();
    const filePath = path.join(tmp, "not-a-directory.txt");
    try {
      fs.writeFileSync(filePath, "hello");
      expect(() => resolveExperimentTarget(filePath, process.cwd())).toThrow(
        /Target path is not a directory/
      );
    } finally {
      cleanup(tmp);
    }
  });
});
