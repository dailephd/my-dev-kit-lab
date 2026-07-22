import { describe, expect, it } from "vitest";
import { compareTargetSnapshots } from "../../../src/evaluation/targetImmutability/compareTargetSnapshots.js";
import type { V043TargetSnapshotV1 } from "../../../src/evaluation/targetImmutability/types.js";

function baseSnapshot(overrides: Partial<V043TargetSnapshotV1> = {}): V043TargetSnapshotV1 {
  return {
    targetRootPath: "Z:/fixture/target",
    resolvedTargetRootPath: "Z:/fixture/target",
    configuredFiles: [
      { relativePath: "src/a.ts", resolvedPath: "Z:/fixture/target/src/a.ts", state: "file", sha256: "hash-a", symbolicLinkTarget: null }
    ],
    git: {
      availability: "available",
      branch: "main",
      head: "abc123",
      statusEntries: ["M existing.ts"],
      worktreeDiffSha256: "worktree-hash",
      stagedDiffSha256: "staged-hash",
      untrackedFiles: [{ path: "untracked.txt", state: "file", sha256: "untracked-hash", symbolicLinkTarget: null }]
    },
    ...overrides
  };
}

describe("compareTargetSnapshots", () => {
  it("IMM-054 identical snapshots return unchanged", () => {
    const snapshot = baseSnapshot();
    const result = compareTargetSnapshots(snapshot, structuredClone(snapshot));
    expect(result.status).toBe("unchanged");
    expect(result.mutations).toEqual([]);
  });

  it("IMM-055 identical pre-existing Git status entries create no mutation", () => {
    const before = baseSnapshot({ git: { ...baseSnapshot().git, statusEntries: ["M existing.ts", "?? other.ts"] } });
    const after = structuredClone(before);
    const result = compareTargetSnapshots(before, after);
    expect(result.status).toBe("unchanged");
    expect(result.preExistingGitStatusEntryCount).toBe(2);
  });

  it("IMM-056 Git availability change is detected", () => {
    const before = baseSnapshot();
    const after = structuredClone(before);
    after.git.availability = "not-repository";
    const result = compareTargetSnapshots(before, after);
    expect(result.mutations.some((m) => m.id === "git.availability")).toBe(true);
  });

  it("IMM-057 branch change is detected", () => {
    const before = baseSnapshot();
    const after = structuredClone(before);
    after.git.branch = "feature/other";
    const result = compareTargetSnapshots(before, after);
    expect(result.mutations.some((m) => m.id === "git.branch")).toBe(true);
  });

  it("IMM-058 HEAD change is detected", () => {
    const before = baseSnapshot();
    const after = structuredClone(before);
    after.git.head = "def456";
    const result = compareTargetSnapshots(before, after);
    expect(result.mutations.some((m) => m.id === "git.head")).toBe(true);
  });

  it("IMM-059 status-entry change is detected", () => {
    const before = baseSnapshot();
    const after = structuredClone(before);
    after.git.statusEntries = ["M existing.ts", "M new-change.ts"];
    const result = compareTargetSnapshots(before, after);
    expect(result.mutations.some((m) => m.id === "git.status")).toBe(true);
  });

  it("IMM-060 worktree diff change is detected", () => {
    const before = baseSnapshot();
    const after = structuredClone(before);
    after.git.worktreeDiffSha256 = "different-hash";
    const result = compareTargetSnapshots(before, after);
    expect(result.mutations.some((m) => m.id === "git.worktree-diff")).toBe(true);
  });

  it("IMM-061 staged diff change is detected", () => {
    const before = baseSnapshot();
    const after = structuredClone(before);
    after.git.stagedDiffSha256 = "different-hash";
    const result = compareTargetSnapshots(before, after);
    expect(result.mutations.some((m) => m.id === "git.staged-diff")).toBe(true);
  });

  it("IMM-062 an added untracked file is detected", () => {
    const before = baseSnapshot();
    const after = structuredClone(before);
    after.git.untrackedFiles.push({ path: "new-untracked.txt", state: "file", sha256: "new-hash", symbolicLinkTarget: null });
    const result = compareTargetSnapshots(before, after);
    expect(result.mutations.some((m) => m.id === "git.untracked:new-untracked.txt")).toBe(true);
  });

  it("IMM-063 a removed untracked file is detected", () => {
    const before = baseSnapshot();
    const after = structuredClone(before);
    after.git.untrackedFiles = [];
    const result = compareTargetSnapshots(before, after);
    expect(result.mutations.some((m) => m.id === "git.untracked:untracked.txt")).toBe(true);
  });

  it("IMM-064 a changed untracked-file hash is detected", () => {
    const before = baseSnapshot();
    const after = structuredClone(before);
    after.git.untrackedFiles[0].sha256 = "changed-hash";
    const result = compareTargetSnapshots(before, after);
    expect(result.mutations.some((m) => m.id === "git.untracked:untracked.txt")).toBe(true);
  });

  it("IMM-065 a configured file becoming missing is detected", () => {
    const before = baseSnapshot();
    const after = structuredClone(before);
    after.configuredFiles[0] = { ...after.configuredFiles[0], state: "missing", sha256: null };
    const result = compareTargetSnapshots(before, after);
    expect(result.mutations.some((m) => m.id === "file:src/a.ts")).toBe(true);
  });

  it("IMM-066 a missing configured file becoming present is detected", () => {
    const before = baseSnapshot({
      configuredFiles: [{ relativePath: "src/a.ts", resolvedPath: "Z:/fixture/target/src/a.ts", state: "missing", sha256: null, symbolicLinkTarget: null }]
    });
    const after = structuredClone(before);
    after.configuredFiles[0] = { ...after.configuredFiles[0], state: "file", sha256: "new-hash" };
    const result = compareTargetSnapshots(before, after);
    expect(result.mutations.some((m) => m.id === "file:src/a.ts")).toBe(true);
  });

  it("IMM-067 a configured-file hash change is detected", () => {
    const before = baseSnapshot();
    const after = structuredClone(before);
    after.configuredFiles[0].sha256 = "different-hash";
    const result = compareTargetSnapshots(before, after);
    expect(result.mutations.some((m) => m.id === "file:src/a.ts")).toBe(true);
  });

  it("IMM-068 a symbolic-link target change is detected", () => {
    const before = baseSnapshot({
      configuredFiles: [
        { relativePath: "src/link.ts", resolvedPath: "Z:/fixture/target/src/link.ts", state: "symbolic-link", sha256: null, symbolicLinkTarget: "/old/target" }
      ]
    });
    const after = structuredClone(before);
    after.configuredFiles[0].symbolicLinkTarget = "/new/target";
    const result = compareTargetSnapshots(before, after);
    expect(result.mutations.some((m) => m.id === "file:src/link.ts")).toBe(true);
  });

  it("IMM-069 mutation order follows Section 22", () => {
    const before = baseSnapshot();
    const after = structuredClone(before);
    after.git.availability = "not-repository";
    after.git.branch = "other";
    after.git.head = "other-head";
    after.git.statusEntries = ["changed"];
    after.git.worktreeDiffSha256 = "changed";
    after.git.stagedDiffSha256 = "changed";
    after.git.untrackedFiles = [];
    after.configuredFiles[0].sha256 = "changed";
    const result = compareTargetSnapshots(before, after);
    expect(result.mutations.map((m) => m.kind)).toEqual([
      "git-availability",
      "git-branch",
      "git-head",
      "git-status",
      "git-worktree-diff",
      "git-staged-diff",
      "git-untracked-file",
      "configured-file"
    ]);
  });

  it("IMM-070 untracked before-order is preserved", () => {
    const before = baseSnapshot({
      git: {
        ...baseSnapshot().git,
        untrackedFiles: [
          { path: "b.txt", state: "file", sha256: "hb", symbolicLinkTarget: null },
          { path: "a.txt", state: "file", sha256: "ha", symbolicLinkTarget: null }
        ]
      }
    });
    const after = structuredClone(before);
    after.git.untrackedFiles[0].sha256 = "hb-changed";
    after.git.untrackedFiles[1].sha256 = "ha-changed";
    const result = compareTargetSnapshots(before, after);
    const untrackedMutations = result.mutations.filter((m) => m.kind === "git-untracked-file");
    expect(untrackedMutations.map((m) => m.id)).toEqual(["git.untracked:b.txt", "git.untracked:a.txt"]);
  });

  it("IMM-071 new untracked after-only order is preserved", () => {
    const before = baseSnapshot({ git: { ...baseSnapshot().git, untrackedFiles: [] } });
    const after = structuredClone(before);
    after.git.untrackedFiles = [
      { path: "z.txt", state: "file", sha256: "hz", symbolicLinkTarget: null },
      { path: "m.txt", state: "file", sha256: "hm", symbolicLinkTarget: null }
    ];
    const result = compareTargetSnapshots(before, after);
    const untrackedMutations = result.mutations.filter((m) => m.kind === "git-untracked-file");
    expect(untrackedMutations.map((m) => m.id)).toEqual(["git.untracked:z.txt", "git.untracked:m.txt"]);
  });

  it("IMM-072 configured-file order is preserved", () => {
    const before = baseSnapshot({
      configuredFiles: [
        { relativePath: "src/b.ts", resolvedPath: "x", state: "file", sha256: "hb", symbolicLinkTarget: null },
        { relativePath: "src/a.ts", resolvedPath: "y", state: "file", sha256: "ha", symbolicLinkTarget: null }
      ]
    });
    const after = structuredClone(before);
    after.configuredFiles[0].sha256 = "hb-changed";
    after.configuredFiles[1].sha256 = "ha-changed";
    const result = compareTargetSnapshots(before, after);
    const fileMutations = result.mutations.filter((m) => m.kind === "configured-file");
    expect(fileMutations.map((m) => m.id)).toEqual(["file:src/b.ts", "file:src/a.ts"]);
  });

  it("IMM-073 newMutationCount equals mutation length", () => {
    const before = baseSnapshot();
    const after = structuredClone(before);
    after.git.head = "different";
    after.configuredFiles[0].sha256 = "different";
    const result = compareTargetSnapshots(before, after);
    expect(result.newMutationCount).toBe(result.mutations.length);
    expect(result.newMutationCount).toBe(2);
  });

  it("IMM-074 preExistingGitStatusEntryCount uses the before snapshot", () => {
    const before = baseSnapshot({ git: { ...baseSnapshot().git, statusEntries: ["a", "b", "c"] } });
    const after = structuredClone(before);
    after.git.statusEntries = ["a"];
    const result = compareTargetSnapshots(before, after);
    expect(result.preExistingGitStatusEntryCount).toBe(3);
  });

  it("IMM-075 before and after snapshots are not mutated", () => {
    const before = baseSnapshot();
    const after = structuredClone(before);
    after.git.head = "different";
    const beforeSnapshotText = JSON.stringify(before);
    const afterSnapshotText = JSON.stringify(after);
    compareTargetSnapshots(before, after);
    expect(JSON.stringify(before)).toBe(beforeSnapshotText);
    expect(JSON.stringify(after)).toBe(afterSnapshotText);
  });

  it("IMM-076 no mutation values are normalized", () => {
    const before = baseSnapshot();
    const after = structuredClone(before);
    after.git.branch = "Feature/MixedCase";
    const result = compareTargetSnapshots(before, after);
    const branchMutation = result.mutations.find((m) => m.id === "git.branch");
    expect(branchMutation?.after).toBe("Feature/MixedCase");
  });
});
