import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { classifyGitIgnoredPaths, readRepositoryIdentity } from "../../../src/evaluation/localRepositorySubject/gitRepository.js";
import { loadLocalRepositorySubject } from "../../../src/evaluation/localRepositorySubject/loadLocalRepositorySubject.js";
import { serializeLocalRepositorySubjectManifest } from "../../../src/evaluation/localRepositorySubject/manifest.js";
import { LocalRepositorySubjectRepositoryError } from "../../../src/evaluation/localRepositorySubject/types.js";
import { commitAll, createCommittedRepository, makeTempDir, minimalConfig, removeTempDir, writeRepositoryFile } from "./fixtureRepository.js";

let root: string;
beforeEach(() => {
  root = makeTempDir();
});
afterEach(() => {
  removeTempDir(root);
});

describe("RSP-018 runtime-only safety exclusions", () => {
  async function loadWithExclusions() {
    createCommittedRepository(root);
    writeRepositoryFile(root, ".gitignore", "src/secret-ignored.ts\nsrc/gen/\n");
    writeRepositoryFile(root, "src/big-private-name.bin", Buffer.alloc(200, 1));
    commitAll(root, "more");
    writeRepositoryFile(root, "src/secret-ignored.ts", "x\n");
    writeRepositoryFile(root, "src/gen/out.ts", "x\n");
    return loadLocalRepositorySubject({ config: minimalConfig(), repositoryPath: root, maxFileBytes: 100 });
  }

  it("exposes exact sorted ignored and oversized paths on the runtime subject only", async () => {
    const subject = await loadWithExclusions();
    expect(subject.runtimeSafetyExclusions).toEqual({
      gitIgnoredFiles: ["src/gen/out.ts", "src/secret-ignored.ts"],
      oversizedFiles: ["src/big-private-name.bin"],
    });
    expect(subject.eligibleFiles).toEqual(["src/main.ts", "src/util/helper.ts"]);
  });

  it("does not change the privacy-safe manifest contract or leak any excluded path into it", async () => {
    const subject = await loadWithExclusions();
    const serialized = serializeLocalRepositorySubjectManifest(subject.manifest);
    const manifest = JSON.parse(serialized) as Record<string, unknown>;
    expect(Object.keys(manifest)).toEqual([
      "schemaId", "schemaVersion", "subjectId", "logicalTargetRoot", "repository", "safetyPolicy", "sourceRoots", "caseCount", "caseIds", "inventory",
    ]);
    for (const forbidden of ["runtimeSafetyExclusions", "secret-ignored", "big-private-name", "src/gen", root, root.replace(/\\/g, "/")]) {
      expect(serialized, forbidden).not.toContain(forbidden);
    }
    expect(subject.manifest.inventory).toMatchObject({ gitIgnoredCount: 2, oversizedCount: 1, eligibleFileCount: 2 });
  });

  it("returns the same exclusions for repeated loads", async () => {
    const first = await loadWithExclusions();
    const second = await loadLocalRepositorySubject({ config: minimalConfig(), repositoryPath: root, maxFileBytes: 100 });
    expect(second.runtimeSafetyExclusions).toEqual(first.runtimeSafetyExclusions);
  });
});

describe("RSP-020 inherited Batch 1 Git error paths are typed and deterministic", () => {
  async function code(action: () => Promise<unknown>): Promise<string> {
    try {
      await action();
    } catch (error) {
      expect(error).toBeInstanceOf(LocalRepositorySubjectRepositoryError);
      return (error as LocalRepositorySubjectRepositoryError).code;
    }
    throw new Error("expected a LocalRepositorySubjectRepositoryError");
  }

  it("reports GIT_UNAVAILABLE when the git executable cannot be found", async () => {
    createCommittedRepository(root);
    const savedPath = process.env.PATH;
    const savedPathCased = process.env.Path;
    try {
      process.env.PATH = path.join(root, "no-such-directory");
      process.env.Path = process.env.PATH;
      expect(await code(() => readRepositoryIdentity(root))).toBe("GIT_UNAVAILABLE");
      expect(await code(() => classifyGitIgnoredPaths(root, ["src/main.ts"]))).toBe("GIT_UNAVAILABLE");
    } finally {
      if (savedPath === undefined) delete process.env.PATH;
      else process.env.PATH = savedPath;
      if (savedPathCased === undefined) delete process.env.Path;
      else process.env.Path = savedPathCased;
    }
    // The environment is restored, so the same call now succeeds.
    expect((await readRepositoryIdentity(root)).identity.branch).toBe("main");
  });

  it("reports GIT_CHECK_IGNORE_FAILED when git cannot classify a path", async () => {
    createCommittedRepository(root);
    expect(await code(() => classifyGitIgnoredPaths(root, ["../outside.ts"]))).toBe("GIT_CHECK_IGNORE_FAILED");
  });

  it("treats no ignored paths as an empty set, not as a failure", async () => {
    createCommittedRepository(root);
    expect((await classifyGitIgnoredPaths(root, ["src/main.ts"])).size).toBe(0);
  });
});
