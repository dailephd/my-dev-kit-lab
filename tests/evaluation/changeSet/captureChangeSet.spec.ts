import { createHash } from "node:crypto";
import { mkdirSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { symlink } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { runSandboxGit, type BenchmarkSandbox } from "../../../src/evaluation/benchmarkSandbox/index.js";
import { applyPatchToSandbox } from "../../../src/evaluation/agentSuccess/index.js";
import { ChangeSetError, captureChangeSet } from "../../../src/evaluation/changeSet/index.js";
import { FIX_PATCH, FIXTURE_FILES, makeCanonicalFixture, makeSandbox, makeTempDir, newFilePatch, useSandboxTestCleanup } from "../benchmarkSandbox/sandboxTestHelpers.js";

useSandboxTestCleanup();

const sha = (value: string | Buffer) => createHash("sha256").update(value).digest("hex");

function write(sandbox: BenchmarkSandbox, relativePath: string, content: string | Buffer): void {
  const target = path.join(sandbox.projectRoot, ...relativePath.split("/"));
  mkdirSync(path.dirname(target), { recursive: true });
  writeFileSync(target, content);
}

async function sandboxFor(id: string): Promise<BenchmarkSandbox> {
  return makeSandbox(makeCanonicalFixture(), id);
}

describe("change-set evidence", () => {
  it("returns an empty, valid change set for an unchanged sandbox", async () => {
    const sandbox = await sandboxFor("empty");
    const changeSet = await captureChangeSet({ sandbox });
    expect(changeSet).toMatchObject({
      schemaVersion: "my-dev-kit-lab-change-set-v1",
      sandboxId: "empty",
      baselineCommit: sandbox.baseline.commit,
      changedFiles: [],
      addedCount: 0,
      modifiedCount: 0,
      deletedCount: 0,
      changedCount: 0,
      totalAdditions: 0,
      totalDeletions: 0,
      diff: ""
    });
  });

  it("RSP-024 reports a modified file with both hashes and line counts", async () => {
    const sandbox = await sandboxFor("modified");
    write(sandbox, "src/math.cjs", "module.exports.add = (a, b) => a + b;\n");
    const changeSet = await captureChangeSet({ sandbox });
    expect(changeSet.changedFiles).toEqual([
      {
        relativePath: "src/math.cjs",
        status: "modified",
        beforeSha256: sha(FIXTURE_FILES["src/math.cjs"]!),
        afterSha256: sha("module.exports.add = (a, b) => a + b;\n"),
        additions: 1,
        deletions: 1
      }
    ]);
    expect(changeSet).toMatchObject({ modifiedCount: 1, addedCount: 0, deletedCount: 0, changedCount: 1 });
  });

  it("RSP-025 reports an added file with a null before-hash", async () => {
    const sandbox = await sandboxFor("added");
    write(sandbox, "docs/new.md", "one\ntwo\nthree\n");
    const changeSet = await captureChangeSet({ sandbox });
    expect(changeSet.changedFiles).toEqual([
      { relativePath: "docs/new.md", status: "added", beforeSha256: null, afterSha256: sha("one\ntwo\nthree\n"), additions: 3, deletions: 0 }
    ]);
    expect(changeSet.addedCount).toBe(1);
  });

  it("RSP-026 reports a deleted file with a null after-hash", async () => {
    const sandbox = await sandboxFor("deleted");
    rmSync(path.join(sandbox.projectRoot, "src", "other.cjs"));
    const changeSet = await captureChangeSet({ sandbox });
    expect(changeSet.changedFiles).toEqual([
      { relativePath: "src/other.cjs", status: "deleted", beforeSha256: sha(FIXTURE_FILES["src/other.cjs"]!), afterSha256: null, additions: 0, deletions: 1 }
    ]);
    expect(changeSet.deletedCount).toBe(1);
  });

  it("RSP-027 represents a rename as one deleted and one added record", async () => {
    const sandbox = await sandboxFor("renamed");
    renameSync(path.join(sandbox.projectRoot, "src", "other.cjs"), path.join(sandbox.projectRoot, "src", "renamed.cjs"));
    const changeSet = await captureChangeSet({ sandbox });
    expect(changeSet.changedFiles.map((file) => [file.relativePath, file.status])).toEqual([
      ["src/other.cjs", "deleted"],
      ["src/renamed.cjs", "added"]
    ]);
    expect(changeSet.changedFiles.some((file) => (file.status as string) === "renamed")).toBe(false);
    expect(changeSet.diff).not.toMatch(/^rename (from|to) /m);
    expect(changeSet.diff).not.toMatch(/^similarity index /m);
  });

  it("RSP-028 reports POSIX relative paths for nested files", async () => {
    const sandbox = await sandboxFor("nested");
    write(sandbox, "deep/er/still/file.txt", "x\n");
    const changeSet = await captureChangeSet({ sandbox });
    const [file] = changeSet.changedFiles;
    expect(file?.relativePath).toBe("deep/er/still/file.txt");
    for (const entry of changeSet.changedFiles) {
      expect(entry.relativePath).not.toContain("\\");
      expect(entry.relativePath.startsWith("./")).toBe(false);
      expect(entry.relativePath).not.toMatch(/^[A-Za-z]:/);
    }
  });

  it("RSP-029 reports hashes equal to independently computed sha256 values", async () => {
    const sandbox = await sandboxFor("hashes");
    const content = "line one\r\nline two\r\n";
    write(sandbox, "docs/readme.md", content);
    write(sandbox, "docs/blob.dat", Buffer.from([0, 1, 2, 3, 255]));
    const changeSet = await captureChangeSet({ sandbox });
    const readme = changeSet.changedFiles.find((file) => file.relativePath === "docs/readme.md");
    expect(readme?.beforeSha256).toBe(sha(FIXTURE_FILES["docs/readme.md"]!));
    expect(readme?.afterSha256).toBe(sha(content));
    expect(changeSet.changedFiles.find((file) => file.relativePath === "docs/blob.dat")?.afterSha256).toBe(sha(Buffer.from([0, 1, 2, 3, 255])));
  });

  it("RSP-030 reports additions, deletions, totals, null counts for binary files, and an applicable cumulative diff", async () => {
    const sandbox = await sandboxFor("counts");
    write(sandbox, "src/math.cjs", "module.exports.add = (a, b) => a + b;\n// extra\n");
    write(sandbox, "docs/new.md", "a\nb\n");
    rmSync(path.join(sandbox.projectRoot, "src", "other.cjs"));
    write(sandbox, "docs/blob.dat", Buffer.from([0, 1, 2, 3, 255, 0]));
    const changeSet = await captureChangeSet({ sandbox });

    const byPath = Object.fromEntries(changeSet.changedFiles.map((file) => [file.relativePath, file]));
    expect(byPath["src/math.cjs"]).toMatchObject({ additions: 2, deletions: 1 });
    expect(byPath["docs/new.md"]).toMatchObject({ additions: 2, deletions: 0 });
    expect(byPath["src/other.cjs"]).toMatchObject({ additions: 0, deletions: 1 });
    expect(byPath["docs/blob.dat"]).toMatchObject({ status: "added", additions: null, deletions: null });
    expect(changeSet).toMatchObject({ addedCount: 2, modifiedCount: 1, deletedCount: 1, changedCount: 4, totalAdditions: 4, totalDeletions: 2 });

    // The cumulative diff text patches a fresh baseline copy into the same text state (text files only).
    const textOnly = changeSet.diff.split(/^(?=diff --git )/m).filter((section) => !section.includes("blob.dat")).join("");
    const fresh = await sandboxFor("counts-fresh");
    const check = await runSandboxGit(fresh, ["apply", "--check", "-"], { stdin: textOnly, label: "t-check" });
    expect(check.ok, check.stderr).toBe(true);
    expect(changeSet.diff.endsWith("\n")).toBe(true);
  });

  it("RSP-031 is deterministic and sorted regardless of the order edits were made", async () => {
    const first = await sandboxFor("order-a");
    const second = await sandboxFor("order-b");
    write(first, "zzz/last.txt", "z\n");
    write(first, "aaa/first.txt", "a\n");
    write(first, "src/math.cjs", "changed\n");
    write(second, "src/math.cjs", "changed\n");
    write(second, "aaa/first.txt", "a\n");
    write(second, "zzz/last.txt", "z\n");
    const [one, two] = [await captureChangeSet({ sandbox: first }), await captureChangeSet({ sandbox: second })];
    expect({ ...one, sandboxId: "x" }).toEqual({ ...two, sandboxId: "x" });
    expect(one.changedFiles.map((file) => file.relativePath)).toEqual(["aaa/first.txt", "src/math.cjs", "zzz/last.txt"]);
    expect(await captureChangeSet({ sandbox: first })).toEqual(one);
  });

  it("reports changes applied through the patch pipeline and tolerates being captured repeatedly", async () => {
    const sandbox = await sandboxFor("patched");
    const applied = await applyPatchToSandbox({ sandbox, rawProposal: FIX_PATCH + newFilePatch("docs/added.md", "hi\n"), protectedFiles: [] });
    expect(applied.outcome).toBe("success");
    const changeSet = await captureChangeSet({ sandbox });
    expect(changeSet.changedFiles.map((file) => `${file.status}:${file.relativePath}`)).toEqual(["added:docs/added.md", "modified:src/math.cjs"]);
    expect(await captureChangeSet({ sandbox })).toEqual(changeSet);
  });

  it("includes files in directories that are ignored by the project's own .gitignore", async () => {
    const canonical = makeCanonicalFixture({ ".gitignore": "ignored/\n" });
    const sandbox = await makeSandbox(canonical, "ignored");
    write(sandbox, "ignored/secret.txt", "still evidence\n");
    const changeSet = await captureChangeSet({ sandbox });
    expect(changeSet.changedFiles.map((file) => file.relativePath)).toEqual(["ignored/secret.txt"]);
    expect(changeSet.diff).toContain("ignored/secret.txt");
  });

  it("rejects a symbolic link created inside the sandbox", async () => {
    const sandbox = await sandboxFor("linked");
    await symlink(makeTempDir("lab-link-target-"), path.join(sandbox.projectRoot, "sneaky"), process.platform === "win32" ? "junction" : "dir");
    await expect(captureChangeSet({ sandbox })).rejects.toBeInstanceOf(ChangeSetError);
  });
});
