import {
  BenchmarkSandboxError,
  excerptGitFailure,
  runSandboxGit,
  snapshotProjectTree,
  type BenchmarkSandbox,
  type GitResult
} from "../benchmarkSandbox/index.js";
import {
  CHANGE_SET_SCHEMA_VERSION,
  ChangeSetError,
  type ChangedFileStatus,
  type ChangedFileV1,
  type ChangeSetV1
} from "./types.js";

function compareCodeUnits(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

async function git(sandbox: BenchmarkSandbox, args: readonly string[], label: string): Promise<GitResult> {
  const result = await runSandboxGit(sandbox, args, { label });
  if (!result.ok) {
    throw new ChangeSetError("GIT_FAILED", `git ${args[0] ?? ""} failed: ${excerptGitFailure(result)}`);
  }
  return result;
}

/** Parses `git diff --numstat -z --no-renames`: records of "added<TAB>deleted<TAB>path" separated by NUL. */
function parseNumstat(output: string): Map<string, { additions: number | null; deletions: number | null }> {
  const stats = new Map<string, { additions: number | null; deletions: number | null }>();
  for (const record of output.split("\0")) {
    if (record === "") continue;
    const firstTab = record.indexOf("\t");
    const secondTab = firstTab < 0 ? -1 : record.indexOf("\t", firstTab + 1);
    if (firstTab < 0 || secondTab < 0) {
      throw new ChangeSetError("INCONSISTENT_EVIDENCE", "unrecognized numstat record.");
    }
    const added = record.slice(0, firstTab);
    const deleted = record.slice(firstTab + 1, secondTab);
    stats.set(record.slice(secondTab + 1), {
      additions: added === "-" ? null : Number(added),
      deletions: deleted === "-" ? null : Number(deleted)
    });
  }
  return stats;
}

/**
 * Captures what changed in a sandbox relative to its own baseline commit. File status and hashes come from
 * comparing the baseline manifest with the working tree (independent of Git ignore rules and of anything the
 * agent claimed); line counts and the cumulative diff come from Git against the baseline commit with rename
 * detection disabled. The two views must agree or capture fails rather than reporting doubtful evidence.
 *
 * Call it right after patch application: it stages the working tree (`git add -A --force`) and reflects
 * whatever exists on disk at that moment, including files produced by later verification runs.
 */
export async function captureChangeSet(options: { sandbox: BenchmarkSandbox }): Promise<ChangeSetV1> {
  const { sandbox } = options;

  let working;
  try {
    working = await snapshotProjectTree(sandbox.projectRoot, { excludedNames: [".git"] });
  } catch (error) {
    if (error instanceof BenchmarkSandboxError && (error.code === "SYMLINK_REJECTED" || error.code === "UNSUPPORTED_ENTRY")) {
      throw new ChangeSetError("SYMLINK_IN_SANDBOX", error.message);
    }
    throw error;
  }

  const baselineByPath = new Map(sandbox.baseline.manifest.map((entry) => [entry.path, entry.sha256]));
  const workingByPath = new Map(working.map((entry) => [entry.path, entry.sha256]));
  const records: Array<{ relativePath: string; status: ChangedFileStatus; beforeSha256: string | null; afterSha256: string | null }> = [];
  for (const [relativePath, before] of baselineByPath) {
    const after = workingByPath.get(relativePath);
    if (after === undefined) {
      records.push({ relativePath, status: "deleted", beforeSha256: before, afterSha256: null });
    } else if (after !== before) {
      records.push({ relativePath, status: "modified", beforeSha256: before, afterSha256: after });
    }
  }
  for (const [relativePath, after] of workingByPath) {
    if (!baselineByPath.has(relativePath)) {
      records.push({ relativePath, status: "added", beforeSha256: null, afterSha256: after });
    }
  }
  records.sort((left, right) => compareCodeUnits(left.relativePath, right.relativePath));

  await git(sandbox, ["add", "-A", "--force"], "stage");
  const numstat = parseNumstat(
    (await git(sandbox, ["diff", "--cached", "--numstat", "--no-renames", "-z", sandbox.baseline.commit], "numstat")).stdout
  );
  const diffResult = await git(
    sandbox,
    ["diff", "--cached", "--no-renames", "--no-ext-diff", "--no-color", "--src-prefix=a/", "--dst-prefix=b/", sandbox.baseline.commit],
    "diff"
  );

  const changedFiles: ChangedFileV1[] = records.map((record) => {
    const stats = numstat.get(record.relativePath);
    if (stats === undefined) {
      throw new ChangeSetError("INCONSISTENT_EVIDENCE", `Git reports no change for ${record.relativePath}, which differs from the baseline manifest.`);
    }
    return { ...record, additions: stats.additions, deletions: stats.deletions };
  });

  const count = (status: ChangedFileStatus) => changedFiles.filter((file) => file.status === status).length;
  const sum = (pick: (file: ChangedFileV1) => number | null) => changedFiles.reduce((total, file) => total + (pick(file) ?? 0), 0);
  const diff = diffResult.stdout === "" || diffResult.stdout.endsWith("\n") ? diffResult.stdout : `${diffResult.stdout}\n`;

  return {
    schemaVersion: CHANGE_SET_SCHEMA_VERSION,
    sandboxId: sandbox.sandboxId,
    baselineCommit: sandbox.baseline.commit,
    changedFiles,
    addedCount: count("added"),
    modifiedCount: count("modified"),
    deletedCount: count("deleted"),
    changedCount: changedFiles.length,
    totalAdditions: sum((file) => file.additions),
    totalDeletions: sum((file) => file.deletions),
    diff
  };
}
