import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  LocalRepositorySubjectRepositoryError,
  loadLocalRepositorySubject,
  readRepositoryIdentity,
} from "../../../src/evaluation/localRepositorySubject/index.js";
import {
  commitAll,
  createCommittedRepository,
  git,
  initRepository,
  makeTempDir,
  minimalConfig,
  removeTempDir,
  writeRepositoryFile,
} from "./fixtureRepository.js";

let root: string;
beforeEach(() => {
  root = makeTempDir();
});
afterEach(() => {
  removeTempDir(root);
});

async function repositoryErrorCode(action: () => Promise<unknown>): Promise<string> {
  try {
    await action();
  } catch (error) {
    expect(error).toBeInstanceOf(LocalRepositorySubjectRepositoryError);
    return (error as LocalRepositorySubjectRepositoryError).code;
  }
  throw new Error("expected a LocalRepositorySubjectRepositoryError");
}

describe("RSP-006 Git identity", () => {
  it("records the full commit SHA and branch for an ordinary branch", async () => {
    const expected = createCommittedRepository(root);
    const { identity, repositoryRoot } = await readRepositoryIdentity(root);
    expect(identity.commit).toBe(expected);
    expect(identity.commit).toMatch(/^[0-9a-f]{40}([0-9a-f]{24})?$/);
    expect(identity.branch).toBe("main");
    expect(identity.workingTreeDirty).toBe(false);
    expect(repositoryRoot).toBe(root);
  });

  it("represents detached HEAD as branch null", async () => {
    const commit = createCommittedRepository(root);
    git(root, "checkout", "-q", "--detach", commit);
    const { identity } = await readRepositoryIdentity(root);
    expect(identity.branch).toBeNull();
    expect(identity.commit).toBe(commit);
  });

  it("allows a dirty worktree and reports only a boolean", async () => {
    createCommittedRepository(root);
    writeRepositoryFile(root, "src/main.ts", "export const value = 99;\n");
    writeRepositoryFile(root, "src/private-untracked-name.ts", "x\n");
    const { identity } = await readRepositoryIdentity(root);
    expect(identity.workingTreeDirty).toBe(true);
    expect(Object.keys(identity).sort()).toEqual(["branch", "commit", "workingTreeDirty"]);
    expect(JSON.stringify(identity)).not.toContain("private-untracked-name");
  });

  it("rejects a directory that is not a Git repository", async () => {
    writeFileSync(path.join(root, "file.txt"), "x");
    expect(await repositoryErrorCode(() => readRepositoryIdentity(root))).toBe("NOT_A_GIT_REPOSITORY");
  });

  it("rejects a nested directory instead of treating the parent worktree as the selected root", async () => {
    createCommittedRepository(root);
    expect(await repositoryErrorCode(() => readRepositoryIdentity(path.join(root, "src")))).toBe("NOT_WORKTREE_ROOT");
  });

  it("rejects a repository without a resolvable HEAD commit", async () => {
    initRepository(root);
    expect(await repositoryErrorCode(() => readRepositoryIdentity(root))).toBe("NO_HEAD_COMMIT");
  });

  it("rejects a missing path and a file path", async () => {
    expect(await repositoryErrorCode(() => readRepositoryIdentity(path.join(root, "missing")))).toBe("REPOSITORY_PATH_INVALID");
    writeFileSync(path.join(root, "f.txt"), "x");
    expect(await repositoryErrorCode(() => readRepositoryIdentity(path.join(root, "f.txt")))).toBe("REPOSITORY_PATH_INVALID");
    expect(await repositoryErrorCode(() => readRepositoryIdentity(""))).toBe("REPOSITORY_PATH_INVALID");
  });

  it("supports repository paths containing spaces", async () => {
    const spaced = path.join(root, "my repo with spaces");
    mkdirSync(spaced);
    initRepository(spaced);
    writeRepositoryFile(spaced, "src/main.ts");
    const commit = commitAll(spaced);
    const { identity } = await readRepositoryIdentity(spaced);
    expect(identity.commit).toBe(commit);
  });

  it("does not require a clean tree to load a subject", async () => {
    createCommittedRepository(root);
    writeRepositoryFile(root, "src/main.ts", "export const value = 5;\n");
    const subject = await loadLocalRepositorySubject({ config: minimalConfig(), repositoryPath: root });
    expect(subject.manifest.repository.workingTreeDirty).toBe(true);
  });
});

describe("RSP-015 loading never mutates the subject repository", () => {
  it("leaves HEAD, status, index and the file tree identical", async () => {
    createCommittedRepository(root);
    writeRepositoryFile(root, "src/main.ts", "export const value = 5;\n");
    writeRepositoryFile(root, "src/untracked.ts", "u\n");
    writeRepositoryFile(root, ".gitignore", "ignored.ts\n");
    writeRepositoryFile(root, "src/ignored.ts", "i\n");
    const snapshot = () => ({
      head: git(root, "rev-parse", "HEAD"),
      status: git(root, "status", "--porcelain=v1", "--ignored"),
      index: git(root, "ls-files", "--stage"),
      refs: git(root, "for-each-ref"),
      stash: git(root, "stash", "list"),
    });
    const before = snapshot();
    await loadLocalRepositorySubject({ config: minimalConfig(), repositoryPath: root });
    expect(snapshot()).toEqual(before);
  });
});
